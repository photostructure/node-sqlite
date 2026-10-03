#include "sqlite_value_conversion.h"

#include <cinttypes>
#include <cstdio>
#include <cstring>
#include <string>

#include "shims/node_errors.h"
#include "sqlite_impl.h"

// Maximum safe integer for JavaScript numbers (2^53 - 1)
static constexpr int64_t kMaxSafeJsInteger = 9007199254740991LL;

namespace photostructure::sqlite {

Napi::Value SqliteValueToJS(Napi::Env env, sqlite3_value *value,
                            bool use_bigint_args) {
  switch (sqlite3_value_type(value)) {
  case SQLITE_INTEGER: {
    sqlite3_int64 int_val = sqlite3_value_int64(value);

    if (use_bigint_args) {
      return Napi::BigInt::New(env, static_cast<int64_t>(int_val));
    } else if (int_val >= -kMaxSafeJsInteger && int_val <= kMaxSafeJsInteger) {
      // Compare both bounds, as node:sqlite does: std::abs(INT64_MIN) is UB.
      return Napi::Number::New(env, static_cast<double>(int_val));
    } else {
      // Value is outside safe integer range for JavaScript numbers
      // Throw ERR_OUT_OF_RANGE directly - we're in a valid N-API context
      char error_msg[128];
      snprintf(error_msg, sizeof(error_msg),
               "Value is too large to be represented as a JavaScript number: "
               "%" PRId64,
               static_cast<int64_t>(int_val));
      node::THROW_ERR_OUT_OF_RANGE(env, error_msg);
      return env.Undefined(); // Return undefined, exception is pending
    }
  }

  case SQLITE_FLOAT: {
    double double_val = sqlite3_value_double(value);
    return Napi::Number::New(env, double_val);
  }

  case SQLITE_TEXT: {
    const char *text =
        reinterpret_cast<const char *>(sqlite3_value_text(value));
    if (!text) {
      return Napi::String::New(env, "");
    }
    // Pass the byte length, as node:sqlite does: text can contain NUL bytes.
    // Napi::String::New would throw a C++ exception for an oversized value,
    // and this runs inside SQLite callbacks, where one must not unwind through
    // SQLite.
    napi_value result;
    if (!SqliteTextToValue(env, text, sqlite3_value_bytes(value), &result)) {
      return env.Undefined(); // Return undefined, exception is pending
    }
    return Napi::Value(env, result);
  }

  case SQLITE_BLOB: {
    const void *blob = sqlite3_value_blob(value);
    int bytes = sqlite3_value_bytes(value);
    // Return Uint8Array to match Node.js node:sqlite behavior
    if (blob && bytes > 0) {
      auto array_buffer = Napi::ArrayBuffer::New(env, bytes);
      memcpy(array_buffer.Data(), blob, bytes);
      return Napi::Uint8Array::New(env, bytes, array_buffer, 0);
    } else {
      auto array_buffer = Napi::ArrayBuffer::New(env, 0);
      return Napi::Uint8Array::New(env, 0, array_buffer, 0);
    }
  }

  case SQLITE_NULL:
  default:
    return env.Null();
  }
}

void JSValueToSqliteResult(Napi::Env env, sqlite3_context *ctx,
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
          env,
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
