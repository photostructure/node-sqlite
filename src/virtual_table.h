#ifndef SRC_VIRTUAL_TABLE_H_
#define SRC_VIRTUAL_TABLE_H_

#include <napi.h>
#include <sqlite3.h>

#include <string>
#include <unordered_set>
#include <vector>

namespace photostructure {
namespace sqlite {

class DatabaseSync;
class VirtualTableModule;

// Port of node:sqlite's virtual table support (DatabaseSync.createModule()).
// See src/upstream/node_sqlite.{h,cc} for the original, which these names and
// callbacks follow.

struct NodeVTab {
  sqlite3_vtab base;
  VirtualTableModule *module;
};

struct NodeVTabCursor {
  sqlite3_vtab_cursor base;
  VirtualTableModule *module;
  // Both outlive a single SQLite call: JavaScript runs between steps, and
  // SQLite reads the current row in xColumn after xNext returns. xClose
  // releases them, or the module's CleanupHook at environment teardown.
  Napi::ObjectReference iterator;
  // Empty unless the iterator's last value was an object. Node-API 8 cannot
  // reference a primitive, and a non-object row reads as all NULL anyway.
  Napi::ObjectReference current_row;
  // The value each hidden column was constrained to, indexed by schema column
  // index and null for visible columns. These are owned copies, since the
  // values SQLite passes to xFilter are only valid for that call.
  std::vector<sqlite3_value *> hidden_values;
  sqlite3_int64 rowid;
  bool done;
};

// Owned by SQLite once registered: sqlite3_create_module_v2() calls
// xDestroyModule when the module is replaced, when the connection closes, and
// when registration fails.
class VirtualTableModule {
public:
  VirtualTableModule(Napi::Env env, DatabaseSync *db, Napi::Function rows_fn,
                     std::string &&schema_sql, int num_columns,
                     std::vector<int> &&hidden_col_indices,
                     bool use_bigint_args, bool direct_only);
  ~VirtualTableModule();

  const sqlite3_module *module_def() const { return &module_def_; }

  static int xCreate(sqlite3 *db, void *pAux, int argc,
                     const char *const *argv, sqlite3_vtab **ppVTab,
                     char **pzErr);
  static int xBestIndex(sqlite3_vtab *pVTab, sqlite3_index_info *pInfo);
  static int xDisconnect(sqlite3_vtab *pVTab);
  static int xDestroy(sqlite3_vtab *pVTab);
  static int xOpen(sqlite3_vtab *pVTab, sqlite3_vtab_cursor **ppCursor);
  static int xClose(sqlite3_vtab_cursor *pCursor);
  static int xFilter(sqlite3_vtab_cursor *pCursor, int idxNum,
                     const char *idxStr, int argc, sqlite3_value **argv);
  static int xNext(sqlite3_vtab_cursor *pCursor);
  static int xEof(sqlite3_vtab_cursor *pCursor);
  static int xColumn(sqlite3_vtab_cursor *pCursor, sqlite3_context *ctx,
                     int i);
  static int xRowid(sqlite3_vtab_cursor *pCursor, sqlite3_int64 *pRowid);
  static void xDestroyModule(void *pAux);

private:
  // Environment cleanup hook: releases the JavaScript references this module
  // and its open cursors hold before the environment is torn down.
  static void CleanupHook(void *arg);

  // Runs `body`, which returns a SQLite result code, and turns any C++
  // exception it throws into a result code. SQLite's frames are C, so nothing
  // may unwind through them (see AGENTS.md).
  template <typename Body> int Guarded(sqlite3_vtab *vtab, Body body);

  // Leaves the pending JavaScript exception for the caller and suppresses the
  // SQLite error that will accompany it. Always returns SQLITE_ERROR.
  int PropagateJSError();

  // Reports an error that has no JavaScript exception to surface, such as a
  // violation of the iteration protocol by the `rows` function. Always
  // returns SQLITE_ERROR.
  static int ReportError(sqlite3_vtab *vtab, const char *message);

  // node-addon-api takes the pending exception out of the engine to build the
  // Napi::Error it throws. Puts that value back so the caller sees what was
  // thrown, and returns whether an exception is now pending.
  bool RestorePendingException(const Napi::Error &error);

  bool IsExceptionPending() const;

  // False while the database is being torn down from a destructor, which runs
  // from a finalizer, where user JavaScript must not run.
  bool CanCallIntoJS() const;

  // Runs the iterator's return() method so generator `finally` blocks still
  // run when an iterator is abandoned while suspended. Returns true if the
  // lookup or the call threw; that exception is left pending.
  bool CloseIterator(NodeVTabCursor *cursor);

  static void ReleaseHiddenValues(NodeVTabCursor *cursor);

  Napi::Env env_;
  // The module lives no longer than the connection, which lives no longer
  // than this DatabaseSync: InternalClose() finalizes every statement before
  // sqlite3_close() destroys the module.
  DatabaseSync *db_;
  Napi::FunctionReference rows_fn_;
  std::string schema_sql_;
  int num_columns_;
  std::vector<int> hidden_col_indices_;
  // Maps schema column index to row array index for visible columns.
  // Hidden columns are mapped to -1.
  std::vector<int> col_index_map_;
  bool use_bigint_args_;
  bool direct_only_;
  // Cursors between xOpen and xClose, so CleanupHook can release their
  // references.
  std::unordered_set<NodeVTabCursor *> open_cursors_;
  // Each module gets its own copy, as in node:sqlite, so worker threads never
  // share one.
  sqlite3_module module_def_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_VIRTUAL_TABLE_H_
