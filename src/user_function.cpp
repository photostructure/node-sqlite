#include "user_function.h"

#include <climits>
#include <cmath>
#include <stdexcept>

#include "sqlite_impl.h"

namespace photostructure {
namespace sqlite {

UserDefinedFunction::UserDefinedFunction(Napi::Env env, Napi::Function fn,
                                         DatabaseSync *db, bool use_bigint_args)
    : env_(env), fn_(Napi::Reference<Napi::Function>::New(fn)), db_(db),
      use_bigint_args_(use_bigint_args) {
  fn_.SuppressDestruct();
}

UserDefinedFunction::~UserDefinedFunction() {
  // Clean up the persistent function reference
  if (!fn_.IsEmpty()) {
    fn_.Reset();
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

  try {
    Napi::HandleScope scope(self->env_);

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
      js_args.push_back(js_val);
    }

    // Call the JavaScript function
    Napi::Value result = fn.Call(js_args);

    // Check if there's a pending exception after the call
    if (self->env_.IsExceptionPending()) {
      Napi::Error error = self->env_.GetAndClearPendingException();
      std::string error_msg = error.Message();
      try {
        sqlite3_result_error(ctx, error_msg.c_str(),
                             SafeCastToInt(error_msg.length()));
      } catch (const std::overflow_error &) {
        sqlite3_result_error(ctx, "Error message too long", -1);
      }
      return;
    }

    // Convert result back to SQLite
    self->JSValueToSqliteResult(ctx, result);

  } catch (const Napi::Error &e) {
    // Handle JavaScript exceptions
    std::string error_msg = e.Message();
    try {
      sqlite3_result_error(ctx, error_msg.c_str(),
                           SafeCastToInt(error_msg.length()));
    } catch (const std::overflow_error &) {
      sqlite3_result_error(ctx, "Error message too long", -1);
    }
  } catch (const std::exception &e) {
    sqlite3_result_error(ctx, e.what(), -1);
  } catch (...) {
    sqlite3_result_error(ctx, "Unknown error in user-defined function", -1);
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
    } else if (int_val >= INT32_MIN && int_val <= INT32_MAX) {
      return Napi::Number::New(env_, static_cast<int32_t>(int_val));
    } else {
      // Large integers that don't fit in int32 but aren't using BigInt
      // Check if the value can be safely represented as a JavaScript number
      if (int_val < -0x1FFFFFFFFFFFFF || int_val > 0x1FFFFFFFFFFFFF) {
        // Value is outside safe integer range for JavaScript numbers
        std::string error_msg =
            "Value is too large to be represented as a JavaScript number: " +
            std::to_string(int_val);
        throw std::runtime_error(error_msg);
      }
      return Napi::Number::New(env_, static_cast<double>(int_val));
    }
  }

  case SQLITE_FLOAT: {
    double double_val = sqlite3_value_double(value);
    return Napi::Number::New(env_, double_val);
  }

  case SQLITE_TEXT: {
    const unsigned char *text = sqlite3_value_text(value);
    return Napi::String::New(env_, reinterpret_cast<const char *>(text));
  }

  case SQLITE_BLOB: {
    const void *blob_data = sqlite3_value_blob(value);
    int blob_size = sqlite3_value_bytes(value);
    return Napi::Buffer<uint8_t>::Copy(
        env_, static_cast<const uint8_t *>(blob_data), blob_size);
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
    // Check boolean BEFORE number, since boolean values can also be numbers
    bool bool_val = value.As<Napi::Boolean>().Value();
    sqlite3_result_int(ctx, bool_val ? 1 : 0);
  } else if (value.IsBigInt()) {
    // Check BigInt BEFORE number to handle large integers properly
    bool lossless;
    int64_t bigint_val = value.As<Napi::BigInt>().Int64Value(&lossless);
    if (lossless) {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(bigint_val));
    } else {
      // BigInt too large, convert to text representation
      std::string bigint_str = value.As<Napi::BigInt>().ToString().Utf8Value();
      try {
        sqlite3_result_text(ctx, bigint_str.c_str(),
                            SafeCastToInt(bigint_str.length()),
                            SQLITE_TRANSIENT);
      } catch (const std::overflow_error &) {
        sqlite3_result_error(ctx, "BigInt string representation too long", -1);
      }
    }
  } else if (value.IsNumber()) {
    double num_val = value.As<Napi::Number>().DoubleValue();

    // Check if it's an integer value
    // Note: We cast INT64_MIN/MAX to double to avoid implicit conversion
    // warnings
    if (std::floor(num_val) == num_val &&
        num_val >= static_cast<double>(INT64_MIN) &&
        num_val <= static_cast<double>(INT64_MAX)) {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(num_val));
    } else {
      sqlite3_result_double(ctx, num_val);
    }
  } else if (value.IsString()) {
    std::string str_val = value.As<Napi::String>().Utf8Value();
    try {
      sqlite3_result_text(ctx, str_val.c_str(), SafeCastToInt(str_val.length()),
                          SQLITE_TRANSIENT);
    } catch (const std::overflow_error &) {
      sqlite3_result_error(ctx, "String value too long", -1);
    }
  } else if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
    try {
      sqlite3_result_blob(ctx, buffer.Data(), SafeCastToInt(buffer.Length()),
                          SQLITE_TRANSIENT);
    } catch (const std::overflow_error &) {
      sqlite3_result_error(ctx, "Buffer too large", -1);
    }
  } else {
    // For any other type, convert to string
    std::string str_val = value.ToString().Utf8Value();
    try {
      sqlite3_result_text(ctx, str_val.c_str(), SafeCastToInt(str_val.length()),
                          SQLITE_TRANSIENT);
    } catch (const std::overflow_error &) {
      sqlite3_result_error(ctx, "Converted string value too long", -1);
    }
  }
}

} // namespace sqlite
} // namespace photostructure