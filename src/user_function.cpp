#include "user_function.h"

#include <climits>
#include <limits>
#include <stdexcept>

#include "shims/node_errors.h"
#include "sqlite_impl.h"
#include "sqlite_value_conversion.h"

namespace photostructure::sqlite {

UserDefinedFunction::UserDefinedFunction(Napi::Env env, Napi::Function fn,
                                         DatabaseSync *db, bool use_bigint_args)
    : env_(env), fn_(Napi::Reference<Napi::Function>::New(fn, 1)), db_(db),
      use_bigint_args_(use_bigint_args), async_context_(nullptr) {
  // Register cleanup hook to Reset() reference before environment teardown.
  // This is required for worker thread support per Node-API best practices.
  // See:
  // https://nodejs.github.io/node-addon-examples/special-topics/context-awareness/
  napi_add_env_cleanup_hook(env_, CleanupHook, this);

  // Create async context for callbacks
  const napi_status status = napi_async_init(
      env, nullptr, Napi::String::New(env, "SQLiteUserFunction"),
      &async_context_);
  if (status != napi_ok) {
    Napi::Error::New(env, "Failed to create async context")
        .ThrowAsJavaScriptException();
  }
}

UserDefinedFunction::~UserDefinedFunction() noexcept {
  // Remove cleanup hook if still registered
  napi_remove_env_cleanup_hook(env_, CleanupHook, this);

  // Don't call fn_.Reset() here - CleanupHook already handled it,
  // or the environment is being torn down and Reset() would be unsafe.

  // Clean up async context if environment is still valid
  napi_handle_scope scope;
  napi_status status = napi_open_handle_scope(env_, &scope);

  if (status == napi_ok) {
    if (async_context_ != nullptr) {
      napi_async_destroy(env_, async_context_);
      async_context_ = nullptr;
    }
    napi_close_handle_scope(env_, scope);
  }
}

void UserDefinedFunction::CleanupHook(void *arg) {
  // Called before environment teardown - safe to Reset() here
  auto *self = static_cast<UserDefinedFunction *>(arg);
  if (!self->fn_.IsEmpty()) {
    self->fn_.Reset();
  }
}

void UserDefinedFunction::xFunc(sqlite3_context *ctx, int argc,
                                sqlite3_value **argv) {
  void *user_data = sqlite3_user_data(ctx);
  if (!user_data) {
    sqlite3_result_error(ctx, "Invalid user data in function callback", -1);
    return;
  }

  UserDefinedFunction *self = static_cast<UserDefinedFunction *>(user_data);

  auto callback_guard = self->db_->EnterCallback();
  Napi::HandleScope scope(self->env_);
  Napi::CallbackScope callback_scope(self->env_, self->async_context_);

  // Check if function reference is still valid
  if (self->fn_.IsEmpty()) {
    sqlite3_result_error(ctx, "Function reference is no longer valid", -1);
    return;
  }

  Napi::Value fn_value;
  try {
    fn_value = self->fn_.Value();
  } catch (const Napi::Error &e) {
    sqlite3_result_error(ctx, "Failed to retrieve function reference", -1);
    return;
  }

  // Additional check for function validity
  if (!fn_value.IsFunction()) {
    sqlite3_result_error(ctx, "Invalid function reference - not a function",
                         -1);
    return;
  }

  Napi::Function fn = fn_value.As<Napi::Function>();

  // Convert SQLite arguments to JavaScript values
  std::vector<napi_value> js_args;
  js_args.reserve(argc);

  for (int i = 0; i < argc; i++) {
    Napi::Value js_val = SqliteValueToJS(self->env_, argv[i], self->use_bigint_args_);

    // Check if SqliteValueToJS threw an exception (e.g., ERR_OUT_OF_RANGE)
    if (self->env_.IsExceptionPending()) {
      // Ignore the SQLite error because a JavaScript exception is pending
      self->db_->SetIgnoreNextSQLiteError(true);
      sqlite3_result_error(ctx, "", 0);
      return;
    }

    js_args.push_back(js_val);
  }

  // Call the JavaScript function
  napi_value js_result;
  napi_value js_func = fn;
  napi_value this_arg = self->env_.Undefined();

  napi_status status =
      napi_call_function(self->env_, this_arg, js_func, js_args.size(),
                         js_args.data(), &js_result);

  if (status != napi_ok || self->env_.IsExceptionPending()) {
    // JavaScript exception is pending - let it propagate
    // Ignore the SQLite error because the JavaScript exception takes precedence
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }

  Napi::Value result(self->env_, js_result);

  // Convert result back to SQLite
  JSValueToSqliteResult(self->env_, ctx, result);

  // Check if JSValueToSqliteResult threw an exception (e.g., ERR_OUT_OF_RANGE)
  if (self->env_.IsExceptionPending()) {
    // Ignore the SQLite error because a JavaScript exception is pending
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }
}

void UserDefinedFunction::xDestroy(void *self) {
  if (self) {
    delete static_cast<UserDefinedFunction *>(self);
  }
}

} // namespace photostructure::sqlite
