#include "virtual_table.h"

#include <algorithm>
#include <charconv>
#include <cstring>
#include <memory>
#include <new>
#include <system_error>

#include "sqlite_impl.h"
#include "sqlite_value_conversion.h"

namespace photostructure::sqlite {

// Every call below that can run user JavaScript (a function call or a
// property read that may hit a getter) uses the raw napi_* function and checks
// its status. node-addon-api's Function::Call() and Object::Get() would turn a
// throw into a C++ exception built with Napi::Error::New(env), which takes the
// exception out of the engine and aborts the process for the termination
// exception process.exit() leaves in a worker (see TakeProgressErrorMessage in
// sqlite_impl.cpp). A failed raw call leaves the exception pending, which is
// how it reaches the caller of step() with its identity intact, as it does for
// user-defined functions and in node:sqlite.

namespace {

// typeof is "object" or "function", like V8's Value::IsObject().
bool IsObjectOrFunction(napi_env env, napi_value value) {
  napi_valuetype type;
  return napi_typeof(env, value, &type) == napi_ok &&
         (type == napi_object || type == napi_function);
}

bool IsFunction(napi_env env, napi_value value) {
  napi_valuetype type;
  return napi_typeof(env, value, &type) == napi_ok && type == napi_function;
}

} // namespace

VirtualTableModule::VirtualTableModule(Napi::Env env, DatabaseSync *db,
                                       Napi::Function rows_fn,
                                       std::string &&schema_sql,
                                       int num_columns,
                                       std::vector<int> &&hidden_col_indices,
                                       bool use_bigint_args, bool direct_only)
    : env_(env), db_(db), rows_fn_(Napi::Persistent(rows_fn)),
      schema_sql_(std::move(schema_sql)), num_columns_(num_columns),
      hidden_col_indices_(std::move(hidden_col_indices)),
      use_bigint_args_(use_bigint_args), direct_only_(direct_only),
      module_def_{} {
  module_def_.iVersion = 1;
  module_def_.xCreate = VirtualTableModule::xCreate;
  module_def_.xConnect = VirtualTableModule::xCreate;
  module_def_.xBestIndex = VirtualTableModule::xBestIndex;
  module_def_.xDisconnect = VirtualTableModule::xDisconnect;
  module_def_.xDestroy = VirtualTableModule::xDestroy;
  module_def_.xOpen = VirtualTableModule::xOpen;
  module_def_.xClose = VirtualTableModule::xClose;
  module_def_.xFilter = VirtualTableModule::xFilter;
  module_def_.xNext = VirtualTableModule::xNext;
  module_def_.xEof = VirtualTableModule::xEof;
  module_def_.xColumn = VirtualTableModule::xColumn;
  module_def_.xRowid = VirtualTableModule::xRowid;

  // Build mapping from schema column index to row array index.
  // Visible columns are numbered sequentially; hidden columns map to -1.
  col_index_map_.assign(num_columns, 0);
  for (int idx : hidden_col_indices_) {
    col_index_map_[idx] = -1;
  }
  int visible_idx = 0;
  for (int i = 0; i < num_columns; i++) {
    if (col_index_map_[i] < 0) {
      continue;
    }
    col_index_map_[i] = visible_idx++;
  }

  // As for UserDefinedFunction: release references before environment
  // teardown rather than from a destructor that runs during it.
  napi_add_env_cleanup_hook(env_, CleanupHook, this);
}

VirtualTableModule::~VirtualTableModule() {
  napi_remove_env_cleanup_hook(env_, CleanupHook, this);
}

void VirtualTableModule::CleanupHook(void *arg) {
  auto *self = static_cast<VirtualTableModule *>(arg);
  self->rows_fn_.Reset();
  for (NodeVTabCursor *cursor : self->open_cursors_) {
    cursor->iterator.Reset();
    cursor->current_row.Reset();
  }
}

template <typename Body>
int VirtualTableModule::Guarded(sqlite3_vtab *vtab, Body body) {
  try {
    return body();
  } catch (const Napi::Error &e) {
    if (RestorePendingException(e)) {
      return PropagateJSError();
    }
    return ReportError(vtab, e.what());
  } catch (const std::bad_alloc &) {
    return SQLITE_NOMEM;
  } catch (const std::exception &e) {
    return ReportError(vtab, e.what());
  } catch (...) {
    return ReportError(vtab, "Unknown C++ exception in virtual table callback");
  }
}

int VirtualTableModule::PropagateJSError() {
  db_->SetIgnoreNextSQLiteError(true);
  return SQLITE_ERROR;
}

int VirtualTableModule::ReportError(sqlite3_vtab *vtab, const char *message) {
  sqlite3_free(vtab->zErrMsg);
  vtab->zErrMsg = sqlite3_mprintf("%s", message);
  return SQLITE_ERROR;
}

bool VirtualTableModule::RestorePendingException(const Napi::Error &error) {
  try {
    // Fails only if an exception is already pending, which then stands.
    napi_throw(env_, error.Value());
  } catch (...) {
    // Value() failed; whatever is pending now is what the caller gets.
  }
  return IsExceptionPending();
}

bool VirtualTableModule::IsExceptionPending() const {
  bool pending = false;
  napi_is_exception_pending(env_, &pending);
  return pending;
}

bool VirtualTableModule::CanCallIntoJS() const {
  return !db_->IsInDestructor();
}

bool VirtualTableModule::CloseIterator(NodeVTabCursor *cursor) {
  // Skipped in two cases besides a cursor without an iterator:
  //
  // - While the database is being torn down from a destructor, which runs
  //   from a finalizer. An abandoned generator does not run `finally` in
  //   JavaScript either, so skipping matches the language.
  // - When an exception is already pending, because calling into JavaScript
  //   would discard it and the caller would see an empty result instead of the
  //   error. A generator whose own body threw has already run its `finally` as
  //   part of that throw, so this only affects an iterator abandoned while
  //   suspended because something else failed.
  if (cursor->iterator.IsEmpty() || !CanCallIntoJS() || IsExceptionPending()) {
    return false;
  }

  auto callback_guard = db_->EnterCallback();
  Napi::HandleScope scope(env_);

  napi_value iterator = cursor->iterator.Value();
  napi_value return_method;
  // A throwing `return` getter is handled the same way as a throwing
  // return() method.
  if (napi_get_named_property(env_, iterator, "return", &return_method) !=
      napi_ok) {
    return true;
  }
  if (!IsFunction(env_, return_method)) {
    return false;
  }
  napi_value ignored;
  return napi_call_function(env_, iterator, return_method, 0, nullptr,
                            &ignored) != napi_ok;
}

void VirtualTableModule::ReleaseHiddenValues(NodeVTabCursor *cursor) {
  for (sqlite3_value *&value : cursor->hidden_values) {
    if (value != nullptr) {
      sqlite3_value_free(value);
      value = nullptr;
    }
  }
}

int VirtualTableModule::xCreate(sqlite3 *db, void *pAux, int /*argc*/,
                                const char *const * /*argv*/,
                                sqlite3_vtab **ppVTab, char **pzErr) {
  auto *mod = static_cast<VirtualTableModule *>(pAux);

  int rc = sqlite3_declare_vtab(db, mod->schema_sql_.c_str());
  if (rc != SQLITE_OK) {
    *pzErr = sqlite3_mprintf("%s", sqlite3_errmsg(db));
    return rc;
  }

  if (mod->direct_only_) {
    sqlite3_vtab_config(db, SQLITE_VTAB_DIRECTONLY);
  }

  auto *vtab = new (std::nothrow) NodeVTab();
  if (vtab == nullptr) {
    return SQLITE_NOMEM;
  }
  vtab->module = mod;
  *ppVTab = &vtab->base;
  return SQLITE_OK;
}

int VirtualTableModule::xBestIndex(sqlite3_vtab *pVTab,
                                   sqlite3_index_info *pInfo) {
  NodeVTab *vtab = reinterpret_cast<NodeVTab *>(pVTab);
  VirtualTableModule *mod = vtab->module;
  int num_hidden = static_cast<int>(mod->hidden_col_indices_.size());
  int argv_index = 0;
  // Comma-separated list of the hidden column indices that received a
  // constraint, in argv order. Passed to xFilter via idxStr so it can map each
  // argv value back to the right parameter. A bitmask in idxNum would cap the
  // number of parameters at the width of an int.
  std::string idx_str;

  try {
    // For each hidden column (parameter), look for a usable EQ constraint.
    for (int hidden_idx = 0; hidden_idx < num_hidden; hidden_idx++) {
      int col = mod->hidden_col_indices_[hidden_idx];

      for (int i = 0; i < pInfo->nConstraint; i++) {
        if (pInfo->aConstraint[i].iColumn == col &&
            pInfo->aConstraint[i].usable &&
            pInfo->aConstraint[i].op == SQLITE_INDEX_CONSTRAINT_EQ) {
          argv_index++;
          pInfo->aConstraintUsage[i].argvIndex = argv_index;
          pInfo->aConstraintUsage[i].omit = 1;
          if (!idx_str.empty()) {
            idx_str += ',';
          }
          idx_str += std::to_string(hidden_idx);
          break;
        }
      }
    }
  } catch (...) {
    // Only the string can fail, by running out of memory.
    return SQLITE_NOMEM;
  }

  if (!idx_str.empty()) {
    pInfo->idxStr = sqlite3_mprintf("%s", idx_str.c_str());
    if (pInfo->idxStr == nullptr) {
      return SQLITE_NOMEM;
    }
    pInfo->needToFreeIdxStr = 1;
  }

  pInfo->idxNum = argv_index;

  // Each consumed constraint has to make the plan look cheaper, or the planner
  // is free to choose the unconstrained plan and recheck the constraints
  // afterwards. That recheck is what turns an unpicked plan into an empty
  // result for table-valued syntax.
  double estimated_rows = 1000.0;
  for (int i = 0; i < argv_index; i++) {
    estimated_rows /= 10.0;
  }
  estimated_rows = std::max(estimated_rows, 1.0);
  pInfo->estimatedRows = static_cast<sqlite3_int64>(estimated_rows);
  pInfo->estimatedCost = estimated_rows;
  return SQLITE_OK;
}

int VirtualTableModule::xDisconnect(sqlite3_vtab *pVTab) {
  delete reinterpret_cast<NodeVTab *>(pVTab);
  return SQLITE_OK;
}

int VirtualTableModule::xDestroy(sqlite3_vtab *pVTab) {
  return xDisconnect(pVTab);
}

int VirtualTableModule::xOpen(sqlite3_vtab *pVTab,
                              sqlite3_vtab_cursor **ppCursor) {
  VirtualTableModule *mod = reinterpret_cast<NodeVTab *>(pVTab)->module;
  try {
    auto cursor = std::make_unique<NodeVTabCursor>();
    cursor->module = mod;
    cursor->hidden_values.assign(mod->num_columns_, nullptr);
    cursor->rowid = 0;
    cursor->done = true;
    mod->open_cursors_.insert(cursor.get());
    *ppCursor = &cursor.release()->base;
    return SQLITE_OK;
  } catch (...) {
    // Only allocation can fail here.
    return SQLITE_NOMEM;
  }
}

int VirtualTableModule::xClose(sqlite3_vtab_cursor *pCursor) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  VirtualTableModule *mod = cursor->module;

  // Close the iterator so generator `finally` blocks still run when SQLite
  // stops stepping early, as it does for LIMIT or a `break` out of a for...of
  // loop. SQLite discards xClose's return value, so a throwing cleanup is left
  // pending for the caller without suppressing a SQLite error, which would
  // otherwise swallow the next unrelated one.
  try {
    mod->CloseIterator(cursor);
  } catch (const Napi::Error &e) {
    mod->RestorePendingException(e);
  } catch (...) {
    // SQLite cannot receive an error from xClose, and nothing may unwind into
    // it. The cursor is freed below either way.
  }

  ReleaseHiddenValues(cursor);
  mod->open_cursors_.erase(cursor);
  delete cursor;
  return SQLITE_OK;
}

int VirtualTableModule::xFilter(sqlite3_vtab_cursor *pCursor, int /*idxNum*/,
                                const char *idxStr, int argc,
                                sqlite3_value **argv) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  VirtualTableModule *mod = cursor->module;
  if (!mod->CanCallIntoJS()) {
    return SQLITE_ERROR;
  }

  return mod->Guarded(pCursor->pVtab, [&]() -> int {
    Napi::Env env = mod->env_;
    auto callback_guard = mod->db_->EnterCallback();
    Napi::HandleScope scope(env);

    // Re-filtering a cursor occurs when SQLite re-invokes xFilter on a cursor
    // it already used, as it does for the inner table of a correlated subquery
    // or join. The previous iterator is abandoned mid-loop, so close it the
    // same way xClose does; otherwise its generator `finally` blocks never
    // run. A throwing cleanup is surfaced as the error for this query.
    if (mod->CloseIterator(cursor)) {
      return mod->PropagateJSError();
    }

    cursor->rowid = 0;
    cursor->done = false;
    cursor->iterator.Reset();
    cursor->current_row.Reset();
    ReleaseHiddenValues(cursor);

    // Build arguments for rows() from hidden column constraint values.
    // idxStr (set in xBestIndex) lists the hidden column indices that received
    // an EQ constraint, in argv order. Unconstrained parameters stay null.
    int num_hidden = static_cast<int>(mod->hidden_col_indices_.size());
    std::vector<napi_value> js_args(num_hidden, env.Null());

    const char *p = idxStr;
    const char *idx_end = p == nullptr ? nullptr : p + std::strlen(p);
    for (int argv_pos = 0; argv_pos < argc && p != nullptr && p != idx_end;
         argv_pos++) {
      int hidden_idx = 0;
      auto [next, ec] = std::from_chars(p, idx_end, hidden_idx);
      if (ec != std::errc() || hidden_idx >= num_hidden) {
        return SQLITE_ERROR;
      }
      p = (next != idx_end && *next == ',') ? next + 1 : next;

      Napi::Value value =
          SqliteValueToJS(env, argv[argv_pos], mod->use_bigint_args_);
      if (mod->IsExceptionPending()) {
        return mod->PropagateJSError();
      }
      js_args[hidden_idx] = value;

      // Keep a copy so xColumn can report what the column was constrained to.
      // SQLite treats `omit` as a hint, so it may still recheck the constraint
      // against the value xColumn returns.
      int schema_idx = mod->hidden_col_indices_[hidden_idx];
      cursor->hidden_values[schema_idx] = sqlite3_value_dup(argv[argv_pos]);
      if (cursor->hidden_values[schema_idx] == nullptr) {
        return SQLITE_NOMEM;
      }
    }

    // Call the rows() function.
    napi_value result;
    if (napi_call_function(env, env.Undefined(), mod->rows_fn_.Value(),
                           js_args.size(), js_args.data(),
                           &result) != napi_ok) {
      return mod->PropagateJSError();
    }
    if (!IsObjectOrFunction(env, result)) {
      return ReportError(
          pCursor->pVtab,
          "The \"options.rows\" function must return an iterable object");
    }

    // Get an iterator from the result. If the result has Symbol.iterator,
    // call it. Otherwise, assume the result is already an iterator.
    napi_value iterator = result;
    napi_value iterator_method;
    if (napi_get_property(env, result, Napi::Symbol::WellKnown(env, "iterator"),
                          &iterator_method) != napi_ok) {
      return mod->PropagateJSError();
    }
    if (IsFunction(env, iterator_method)) {
      if (napi_call_function(env, result, iterator_method, 0, nullptr,
                             &iterator) != napi_ok) {
        return mod->PropagateJSError();
      }
      if (!IsObjectOrFunction(env, iterator)) {
        return ReportError(pCursor->pVtab,
                           "The \"options.rows\" iterable's Symbol.iterator "
                           "method must return an object");
      }
    }

    cursor->iterator = Napi::Persistent(Napi::Object(env, iterator));

    // Advance to the first row.
    return xNext(pCursor);
  });
}

int VirtualTableModule::xNext(sqlite3_vtab_cursor *pCursor) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  VirtualTableModule *mod = cursor->module;
  if (!mod->CanCallIntoJS()) {
    return SQLITE_ERROR;
  }

  return mod->Guarded(pCursor->pVtab, [&]() -> int {
    Napi::Env env = mod->env_;
    auto callback_guard = mod->db_->EnterCallback();
    Napi::HandleScope scope(env);

    napi_value iterator = cursor->iterator.Value();

    // Call iterator.next().
    napi_value next_method;
    if (napi_get_named_property(env, iterator, "next", &next_method) !=
        napi_ok) {
      return mod->PropagateJSError();
    }
    if (!IsFunction(env, next_method)) {
      return ReportError(
          pCursor->pVtab,
          "The \"options.rows\" iterator must have a next() method");
    }

    napi_value next_result;
    if (napi_call_function(env, iterator, next_method, 0, nullptr,
                           &next_result) != napi_ok) {
      return mod->PropagateJSError();
    }
    if (!IsObjectOrFunction(env, next_result)) {
      return ReportError(pCursor->pVtab,
                         "The \"options.rows\" iterator's next() method must "
                         "return an object");
    }

    // Read "done" property.
    napi_value done_value;
    if (napi_get_named_property(env, next_result, "done", &done_value) !=
        napi_ok) {
      return mod->PropagateJSError();
    }

    if (Napi::Value(env, done_value).ToBoolean().Value()) {
      cursor->done = true;
      cursor->current_row.Reset();
    } else {
      cursor->done = false;
      cursor->rowid++;

      // Read "value" property.
      napi_value row;
      if (napi_get_named_property(env, next_result, "value", &row) !=
          napi_ok) {
        return mod->PropagateJSError();
      }

      if (IsObjectOrFunction(env, row)) {
        cursor->current_row = Napi::Persistent(Napi::Object(env, row));
      } else {
        cursor->current_row.Reset();
      }
    }

    return SQLITE_OK;
  });
}

int VirtualTableModule::xEof(sqlite3_vtab_cursor *pCursor) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  return cursor->done ? 1 : 0;
}

int VirtualTableModule::xColumn(sqlite3_vtab_cursor *pCursor,
                                sqlite3_context *ctx, int i) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  VirtualTableModule *mod = cursor->module;

  if (i < 0 || i >= mod->num_columns_) {
    sqlite3_result_null(ctx);
    return SQLITE_OK;
  }

  // Hidden columns are parameters rather than data, so they are not present in
  // the row array. Report the value the query constrained the column to, so
  // that a recheck of that constraint still matches.
  if (mod->col_index_map_[i] < 0) {
    if (cursor->hidden_values[i] != nullptr) {
      sqlite3_result_value(ctx, cursor->hidden_values[i]);
    } else {
      sqlite3_result_null(ctx);
    }
    return SQLITE_OK;
  }

  if (!mod->CanCallIntoJS()) {
    return SQLITE_ERROR;
  }

  return mod->Guarded(pCursor->pVtab, [&]() -> int {
    Napi::Env env = mod->env_;
    auto callback_guard = mod->db_->EnterCallback();
    Napi::HandleScope scope(env);

    if (cursor->current_row.IsEmpty()) {
      sqlite3_result_null(ctx);
      return SQLITE_OK;
    }

    napi_value column_value;
    if (napi_get_element(env, cursor->current_row.Value(),
                         static_cast<uint32_t>(mod->col_index_map_[i]),
                         &column_value) != napi_ok) {
      sqlite3_result_error(ctx, "", 0);
      return mod->PropagateJSError();
    }

    JSValueToSqliteResult(env, ctx, Napi::Value(env, column_value));
    // A BigInt outside the int64 range leaves ERR_OUT_OF_RANGE pending.
    if (mod->IsExceptionPending()) {
      sqlite3_result_error(ctx, "", 0);
      return mod->PropagateJSError();
    }
    return SQLITE_OK;
  });
}

int VirtualTableModule::xRowid(sqlite3_vtab_cursor *pCursor,
                               sqlite3_int64 *pRowid) {
  NodeVTabCursor *cursor = reinterpret_cast<NodeVTabCursor *>(pCursor);
  *pRowid = cursor->rowid;
  return SQLITE_OK;
}

void VirtualTableModule::xDestroyModule(void *pAux) {
  delete static_cast<VirtualTableModule *>(pAux);
}

} // namespace photostructure::sqlite
