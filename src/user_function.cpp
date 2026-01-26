#include "user_function.h"

#include <cinttypes>
#include <climits>
#include <cmath>
#include <limits>
#include <stdexcept>

#include "shims/node_errors.h"
#include "sqlite_impl.h"

// Maximum safe integer for JavaScript numbers (2^53 - 1)
static constexpr int64_t kMaxSafeJsInteger = 9007199254740991LL;

namespace photostructure::sqlite {

UserDefinedFunction::UserDefinedFunction(Napi::Env env, Napi::Function fn,
                                         DatabaseSync *db, bool use_bigint_args)
    : env_(env), fn_(Napi::Reference<Napi::Function>::New(fn, 1)), db_(db),
      use_bigint_args_(use_bigint_args), async_context_(nullptr) {
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
  // Check if environment is still valid before N-API operations.
  // During shutdown, env_ may be torn down and N-API operations would crash.
  // Try to create a handle scope - if this fails, env is invalid.
  napi_handle_scope scope;
  napi_status status = napi_open_handle_scope(env_, &scope);

  if (status == napi_ok) {
    // Safe to do N-API operations
    if (!fn_.IsEmpty()) {
      fn_.Reset();
    }

    if (async_context_ != nullptr) {
      napi_async_destroy(env_, async_context_);
      async_context_ = nullptr;
    }

    napi_close_handle_scope(env_, scope);
  }
  // If status != napi_ok, env is invalid - skip cleanup.
  // References will be leaked, but that's better than crashing.
}

void UserDefinedFunction::xFunc(sqlite3_context *ctx, int argc,
                                sqlite3_value **argv) {
  void *user_data = sqlite3_user_data(ctx);
  if (!user_data) {
    sqlite3_result_error(ctx, "Invalid user data in function callback", -1);
    return;
  }

  UserDefinedFunction *self = static_cast<UserDefinedFunction *>(user_data);

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
    Napi::Value js_val = self->SqliteValueToJS(argv[i]);

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
  self->JSValueToSqliteResult(ctx, result);

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

Napi::Value UserDefinedFunction::SqliteValueToJS(sqlite3_value *value) {
  switch (sqlite3_value_type(value)) {
  case SQLITE_INTEGER: {
    sqlite3_int64 int_val = sqlite3_value_int64(value);

    if (use_bigint_args_) {
      return Napi::BigInt::New(env_, static_cast<int64_t>(int_val));
    } else if (std::abs(int_val) <= kMaxSafeJsInteger) {
      return Napi::Number::New(env_, static_cast<double>(int_val));
    } else {
      // Value is outside safe integer range for JavaScript numbers
      // Throw ERR_OUT_OF_RANGE directly - we're in a valid N-API context
      char error_msg[128];
      snprintf(error_msg, sizeof(error_msg),
               "Value is too large to be represented as a JavaScript number: "
               "%" PRId64,
               static_cast<int64_t>(int_val));
      node::THROW_ERR_OUT_OF_RANGE(env_, error_msg);
      return env_.Undefined(); // Return undefined, exception is pending
    }
  }

  case SQLITE_FLOAT: {
    double double_val = sqlite3_value_double(value);
    return Napi::Number::New(env_, double_val);
  }

  case SQLITE_TEXT: {
    const char *text =
        reinterpret_cast<const char *>(sqlite3_value_text(value));
    return Napi::String::New(env_, text ? text : "");
  }

  case SQLITE_BLOB: {
    const void *blob = sqlite3_value_blob(value);
    int bytes = sqlite3_value_bytes(value);
    // Return Uint8Array to match Node.js node:sqlite behavior
    if (blob && bytes > 0) {
      auto array_buffer = Napi::ArrayBuffer::New(env_, bytes);
      memcpy(array_buffer.Data(), blob, bytes);
      return Napi::Uint8Array::New(env_, bytes, array_buffer, 0);
    } else {
      auto array_buffer = Napi::ArrayBuffer::New(env_, 0);
      return Napi::Uint8Array::New(env_, 0, array_buffer, 0);
    }
  }

  case SQLITE_NULL:
  default:
    return env_.Null();
  }
}

void UserDefinedFunction::JSValueToSqliteResult(sqlite3_context *ctx,
                                                Napi::Value value) {
  if (value.IsNull() || value.IsUndefined()) {
    sqlite3_result_null(ctx);
  } else if (value.IsBoolean()) {
    // Extension over Node.js: Convert booleans to 0/1
    sqlite3_result_int(ctx, value.As<Napi::Boolean>().Value() ? 1 : 0);
  } else if (value.IsNumber()) {
    // Match Node.js: numbers are stored as doubles
    sqlite3_result_double(ctx, value.As<Napi::Number>().DoubleValue());
  } else if (value.IsString()) {
    std::string str_val = value.As<Napi::String>().Utf8Value();
    sqlite3_result_text(ctx, str_val.c_str(),
                        static_cast<int>(str_val.length()), SQLITE_TRANSIENT);
  } else if (value.IsDataView()) {
    // IMPORTANT: Check DataView BEFORE IsBuffer() because N-API's IsBuffer()
    // returns true for ALL ArrayBufferViews (including DataView), but
    // Buffer::As() doesn't work correctly for DataView (returns length=0).
    // See: https://github.com/nodejs/node/pull/56227
    Napi::DataView dataView = value.As<Napi::DataView>();
    Napi::ArrayBuffer arrayBuffer = dataView.ArrayBuffer();
    size_t byteOffset = dataView.ByteOffset();
    size_t byteLength = dataView.ByteLength();

    if (arrayBuffer.Data() != nullptr && byteLength > 0) {
      const uint8_t *data =
          static_cast<const uint8_t *>(arrayBuffer.Data()) + byteOffset;
      sqlite3_result_blob(ctx, data, static_cast<int>(byteLength),
                          SQLITE_TRANSIENT);
    } else {
      sqlite3_result_zeroblob(ctx, 0);
    }
  } else if (value.IsTypedArray()) {
    // Handles Uint8Array and other TypedArrays (but not DataView, handled
    // above)
    Napi::TypedArray arr = value.As<Napi::TypedArray>();
    Napi::ArrayBuffer buf = arr.ArrayBuffer();
    sqlite3_result_blob(
        ctx, static_cast<const uint8_t *>(buf.Data()) + arr.ByteOffset(),
        static_cast<int>(arr.ByteLength()), SQLITE_TRANSIENT);
  } else if (value.IsBigInt()) {
    // Check BigInt - must fit in int64
    bool lossless;
    int64_t bigint_val = value.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      // BigInt too large for SQLite - throw ERR_OUT_OF_RANGE
      node::THROW_ERR_OUT_OF_RANGE(
          env_,
          "BigInt value is too large to be represented as a SQLite integer");
      return;
    }
    sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(bigint_val));
  } else if (value.IsPromise()) {
    // Promises are not supported - must use sqlite3_result_error for this one
    // because it's an ERR_SQLITE_ERROR per the test expectations
    sqlite3_result_error(
        ctx, "Asynchronous user-defined functions are not supported", -1);
  } else {
    // Unsupported type - must use sqlite3_result_error
    sqlite3_result_error(
        ctx, "Returned JavaScript value cannot be converted to a SQLite value",
        -1);
  }
}

} // namespace photostructure::sqlite