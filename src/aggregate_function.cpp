#include "aggregate_function.h"

#include <cinttypes>
#include <cmath>
#include <cstring>
#include <limits>
#include <unordered_map>
#include <vector>

#include "shims/node_errors.h"
#include "sqlite_impl.h"

// Maximum safe integer for JavaScript numbers (2^53 - 1)
static constexpr int64_t kMaxSafeJsInteger = 9007199254740991LL;

namespace photostructure::sqlite {

// Static member definitions for ValueStorage
std::unordered_map<int32_t, Napi::Reference<Napi::Value>>
    ValueStorage::storage_;
std::mutex ValueStorage::mutex_;
std::atomic<int32_t> ValueStorage::next_id_{0};

// ValueStorage implementation
int32_t ValueStorage::Store([[maybe_unused]] Napi::Env env, Napi::Value value) {
  const std::lock_guard<std::mutex> lock(mutex_);
  const int32_t id = ++next_id_;

  // Try direct napi_value persistence instead of Napi::Reference
  try {
    storage_[id] = Napi::Reference<Napi::Value>::New(value, 1);
  } catch (...) {
    // If Reference creation fails, throw to let caller handle
    throw;
  }

  return id;
}

Napi::Value ValueStorage::Get(Napi::Env env, int32_t id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  auto it = storage_.find(id);
  return (it != storage_.end()) ? it->second.Value() : env.Undefined();
}

void ValueStorage::Remove(int32_t id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  auto it = storage_.find(id);
  if (it != storage_.end()) {
    it->second.Reset();
    storage_.erase(it);
  }
}

CustomAggregate::CustomAggregate(Napi::Env env, DatabaseSync *db,
                                 bool use_bigint_args, Napi::Value start,
                                 Napi::Function step_fn,
                                 Napi::Function inverse_fn,
                                 Napi::Function result_fn)
    : env_(env), db_(db), use_bigint_args_(use_bigint_args),
      async_context_(nullptr) {
  // Handle start value based on type
  if (start.IsNull()) {
    start_type_ = PRIMITIVE_NULL;
  } else if (start.IsUndefined()) {
    start_type_ = PRIMITIVE_UNDEFINED;
  } else if (start.IsFunction()) {
    start_type_ = FUNCTION;
    start_fn_ =
        Napi::Reference<Napi::Function>::New(start.As<Napi::Function>(), 1);
  } else if (start.IsNumber()) {
    start_type_ = PRIMITIVE_NUMBER;
    number_value_ = start.As<Napi::Number>().DoubleValue();
  } else if (start.IsString()) {
    start_type_ = PRIMITIVE_STRING;
    string_value_ = start.As<Napi::String>().Utf8Value();
  } else if (start.IsBoolean()) {
    start_type_ = PRIMITIVE_BOOLEAN;
    boolean_value_ = start.As<Napi::Boolean>().Value();
  } else if (start.IsBigInt()) {
    start_type_ = PRIMITIVE_BIGINT;
    bool lossless;
    bigint_value_ = start.As<Napi::BigInt>().Int64Value(&lossless);
  } else {
    // Object, Array, or other complex type
    start_type_ = OBJECT;
    object_ref_ = Napi::Reference<Napi::Value>::New(start, 1);
  }

  step_fn_ = Napi::Reference<Napi::Function>::New(step_fn, 1);

  if (!inverse_fn.IsEmpty()) {
    inverse_fn_ = Napi::Reference<Napi::Function>::New(inverse_fn, 1);
  }
  if (!result_fn.IsEmpty()) {
    result_fn_ = Napi::Reference<Napi::Function>::New(result_fn, 1);
  }

  // Don't create async context immediately - we'll create it lazily if needed
  async_context_ = nullptr;
}

CustomAggregate::~CustomAggregate() {
  // Let Napi::FunctionReference destructors handle cleanup naturally.
  // Explicitly calling Reset() during GC causes JIT corruption on Alpine/musl.
  // See: nodejs/node-addon-api#660, P02-investigate-flaky-native-crashes.md

  // Check if environment is still valid before N-API operations.
  napi_handle_scope scope;
  napi_status status = napi_open_handle_scope(env_, &scope);

  if (status == napi_ok) {
    // Clean up async context if it was created
    if (async_context_ != nullptr) {
      napi_async_destroy(env_, async_context_);
      async_context_ = nullptr;
    }
    napi_close_handle_scope(env_, scope);
  }
}

void CustomAggregate::xStep(sqlite3_context *ctx, int argc,
                            sqlite3_value **argv) {
  xStepBase(ctx, argc, argv, &CustomAggregate::step_fn_);
}

void CustomAggregate::xInverse(sqlite3_context *ctx, int argc,
                               sqlite3_value **argv) {
  xStepBase(ctx, argc, argv, &CustomAggregate::inverse_fn_);
}

void CustomAggregate::xFinal(sqlite3_context *ctx) { xValueBase(ctx, true); }

void CustomAggregate::xValue(sqlite3_context *ctx) { xValueBase(ctx, false); }

void CustomAggregate::xDestroy(void *self) {
  if (self) {
    delete static_cast<CustomAggregate *>(self);
  }
}

void CustomAggregate::xStepBase(
    sqlite3_context *ctx, int argc, sqlite3_value **argv,
    Napi::Reference<Napi::Function> CustomAggregate::*mptr) {
  CustomAggregate *self =
      static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
  if (!self) {
    sqlite3_result_error(ctx, "No user data", -1);
    return;
  }

  // Create HandleScope for N-API operations
  Napi::HandleScope scope(self->env_);

  AggregateValue *state = static_cast<AggregateValue *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateValue)));

  if (!state) {
    sqlite3_result_error(ctx, "Failed to get aggregate state", -1);
    return;
  }

  if (!state->is_initialized) {
    // Initialize with the proper start value
    Napi::Value start_val;

    // If start is a function, call it to get the initial value
    if (self->start_type_ == FUNCTION) {
      Napi::Function start_func = self->start_fn_.Value();
      napi_value result;
      napi_status status = napi_call_function(
          self->env_, self->env_.Undefined(), start_func, 0, nullptr, &result);

      if (status != napi_ok || self->env_.IsExceptionPending()) {
        // JavaScript exception is pending - let it propagate
        self->db_->SetIgnoreNextSQLiteError(true);
        sqlite3_result_error(ctx, "", 0);
        return;
      }
      start_val = Napi::Value(self->env_, result);
    } else {
      start_val = self->GetStartValue();
    }

    // Store the start value in the appropriate type
    if (start_val.IsNumber()) {
      state->type = AggregateValue::NUMBER;
      state->number_value = start_val.As<Napi::Number>().DoubleValue();
    } else if (start_val.IsString()) {
      state->type = AggregateValue::STRING;
      std::string str_val = start_val.As<Napi::String>().Utf8Value();
      size_t copy_len =
          std::min(str_val.length(), sizeof(state->string_buffer) - 1);
      memcpy(state->string_buffer, str_val.c_str(), copy_len);
      state->string_buffer[copy_len] = '\0';
      state->string_length = copy_len;
    } else if (start_val.IsBigInt()) {
      state->type = AggregateValue::BIGINT;
      bool lossless;
      state->bigint_value = start_val.As<Napi::BigInt>().Int64Value(&lossless);
    } else if (start_val.IsBoolean()) {
      state->type = AggregateValue::BOOLEAN;
      state->bool_value = start_val.As<Napi::Boolean>().Value();
    } else if (start_val.IsBuffer()) {
      state->type = AggregateValue::BUFFER;
      Napi::Buffer<uint8_t> buffer = start_val.As<Napi::Buffer<uint8_t>>();
      size_t copy_len =
          std::min(buffer.Length(), sizeof(state->string_buffer) - 1);
      memcpy(state->string_buffer, buffer.Data(), copy_len);
      state->string_length = copy_len;
    } else if ((start_val.IsObject() || start_val.IsArray()) &&
               !start_val.IsBuffer()) {
      // Store objects and arrays as JSON strings
      state->type = AggregateValue::OBJECT_JSON;
      // Use JSON.stringify to serialize the object
      std::string json_str = SafeJsonStringify(self->env_, start_val);

      // If JSON is too long, use a simpler representation
      if (json_str.length() >= sizeof(state->string_buffer) - 1) {
        const char *fallback = "{\"_truncated\":true}";
        size_t fallback_len = strlen(fallback);
        memcpy(state->string_buffer, fallback, fallback_len);
        state->string_buffer[fallback_len] = '\0';
        state->string_length = fallback_len;
      } else {
        memcpy(state->string_buffer, json_str.c_str(), json_str.length());
        state->string_buffer[json_str.length()] = '\0';
        state->string_length = json_str.length();
      }
    } else {
      state->type = AggregateValue::NULL_VAL;
    }

    state->is_initialized = true;
    state->xvalue_called = false;
  }

  // Get the JavaScript function
  if ((self->*mptr).IsEmpty()) {
    sqlite3_result_error(ctx, "Function not defined", -1);
    return;
  }
  Napi::Function func = (self->*mptr).Value();

  // Build arguments for the JavaScript function
  std::vector<Napi::Value> js_args;
  js_args.reserve(argc + 1);

  // First argument: current aggregate value (convert from stored type)
  Napi::Value current_value;
  switch (state->type) {
  case AggregateValue::NUMBER:
    current_value = Napi::Number::New(self->env_, state->number_value);
    break;
  case AggregateValue::STRING:
    current_value = Napi::String::New(self->env_, state->string_buffer,
                                      state->string_length);
    break;
  case AggregateValue::BIGINT:
    current_value = Napi::BigInt::New(self->env_, state->bigint_value);
    break;
  case AggregateValue::BOOLEAN:
    current_value = Napi::Boolean::New(self->env_, state->bool_value);
    break;
  case AggregateValue::BUFFER: {
    // Return Uint8Array to match Node.js node:sqlite behavior
    auto array_buffer =
        Napi::ArrayBuffer::New(self->env_, state->string_length);
    if (state->string_length > 0) {
      memcpy(array_buffer.Data(), state->string_buffer, state->string_length);
    }
    current_value = Napi::Uint8Array::New(self->env_, state->string_length,
                                          array_buffer, 0);
    break;
  }
  case AggregateValue::OBJECT_JSON: {
    // Parse JSON back to object using JSON.parse
    try {
      Napi::Object global = self->env_.Global();
      Napi::Object json = global.Get("JSON").As<Napi::Object>();
      Napi::Function parse = json.Get("parse").As<Napi::Function>();
      Napi::String json_str = Napi::String::New(
          self->env_, state->string_buffer, state->string_length);
      current_value = parse.Call({json_str});
    } catch (...) {
      // If JSON parsing fails, return the string instead
      current_value = Napi::String::New(self->env_, state->string_buffer,
                                        state->string_length);
    }
    break;
  }
  case AggregateValue::NULL_VAL:
  default:
    current_value = self->env_.Null();
    break;
  }
  js_args.push_back(current_value);

  // Convert SQLite values to JavaScript
  for (int i = 0; i < argc; ++i) {
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

  // Convert to napi_value array
  std::vector<napi_value> raw_args;
  for (const auto &arg : js_args) {
    raw_args.push_back(arg);
  }

  // Call the JavaScript function
  napi_value result;
  napi_status status =
      napi_call_function(self->env_, self->env_.Undefined(), func,
                         raw_args.size(), raw_args.data(), &result);

  if (status != napi_ok || self->env_.IsExceptionPending()) {
    // JavaScript exception is pending - let it propagate
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }

  // Convert result back and store in appropriate type
  Napi::Value result_val(self->env_, result);

  // Check for Promise (from async functions) first
  if (result_val.IsObject() && !result_val.IsArray() &&
      !result_val.IsBuffer()) {
    Napi::Object obj = result_val.As<Napi::Object>();
    // Check if it's a Promise by looking for 'then' method
    if (obj.Has("then") && obj.Get("then").IsFunction()) {
      sqlite3_result_error(ctx, "User-defined function returned invalid type",
                           -1);
      return;
    }
  }

  if (result_val.IsNumber()) {
    state->type = AggregateValue::NUMBER;
    state->number_value = result_val.As<Napi::Number>().DoubleValue();
  } else if (result_val.IsString()) {
    state->type = AggregateValue::STRING;
    std::string str_val = result_val.As<Napi::String>().Utf8Value();
    size_t copy_len =
        std::min(str_val.length(), sizeof(state->string_buffer) - 1);
    memcpy(state->string_buffer, str_val.c_str(), copy_len);
    state->string_buffer[copy_len] = '\0';
    state->string_length = copy_len;
  } else if (result_val.IsBigInt()) {
    state->type = AggregateValue::BIGINT;
    bool lossless;
    state->bigint_value = result_val.As<Napi::BigInt>().Int64Value(&lossless);
  } else if (result_val.IsBoolean()) {
    state->type = AggregateValue::BOOLEAN;
    state->bool_value = result_val.As<Napi::Boolean>().Value();
  } else if (result_val.IsBuffer()) {
    state->type = AggregateValue::BUFFER;
    Napi::Buffer<uint8_t> buffer = result_val.As<Napi::Buffer<uint8_t>>();
    size_t copy_len =
        std::min(buffer.Length(), sizeof(state->string_buffer) - 1);
    memcpy(state->string_buffer, buffer.Data(), copy_len);
    state->string_length = copy_len;
  } else if ((result_val.IsObject() || result_val.IsArray()) &&
             !result_val.IsBuffer()) {
    // Store objects and arrays as JSON strings
    state->type = AggregateValue::OBJECT_JSON;
    // Use JSON.stringify to serialize the object/array
    std::string json_str = SafeJsonStringify(self->env_, result_val);

    // If JSON is too long, use a simpler representation
    if (json_str.length() >= sizeof(state->string_buffer) - 1) {
      const char *fallback = "{\"_truncated\":true}";
      size_t fallback_len = strlen(fallback);
      memcpy(state->string_buffer, fallback, fallback_len);
      state->string_buffer[fallback_len] = '\0';
      state->string_length = fallback_len;
    } else {
      memcpy(state->string_buffer, json_str.c_str(), json_str.length());
      state->string_buffer[json_str.length()] = '\0';
      state->string_length = json_str.length();
    }
  } else if (result_val.IsNull() || result_val.IsUndefined()) {
    state->type = AggregateValue::NULL_VAL;
  }
}

void CustomAggregate::xValueBase(sqlite3_context *ctx, bool is_final) {
  CustomAggregate *self =
      static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
  if (!self) {
    sqlite3_result_error(ctx, "No user data", -1);
    return;
  }

  Napi::HandleScope scope(self->env_);

  // Get the same AggregateValue struct used in xStepBase
  AggregateValue *state = static_cast<AggregateValue *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateValue)));

  if (!state || !state->is_initialized) {
    // No rows processed, return null
    sqlite3_result_null(ctx);
    return;
  }

  // Convert the stored value to JavaScript first
  Napi::Value current_value;
  switch (state->type) {
  case AggregateValue::NUMBER:
    current_value = Napi::Number::New(self->env_, state->number_value);
    break;
  case AggregateValue::STRING:
    current_value = Napi::String::New(self->env_, state->string_buffer,
                                      state->string_length);
    break;
  case AggregateValue::BIGINT:
    current_value = Napi::BigInt::New(self->env_, state->bigint_value);
    break;
  case AggregateValue::BOOLEAN:
    current_value = Napi::Boolean::New(self->env_, state->bool_value);
    break;
  case AggregateValue::BUFFER: {
    // Return Uint8Array to match Node.js node:sqlite behavior
    auto array_buffer =
        Napi::ArrayBuffer::New(self->env_, state->string_length);
    if (state->string_length > 0) {
      memcpy(array_buffer.Data(), state->string_buffer, state->string_length);
    }
    current_value = Napi::Uint8Array::New(self->env_, state->string_length,
                                          array_buffer, 0);
    break;
  }
  case AggregateValue::OBJECT_JSON: {
    // Parse JSON back to object using JSON.parse
    try {
      Napi::Object global = self->env_.Global();
      Napi::Object json = global.Get("JSON").As<Napi::Object>();
      Napi::Function parse = json.Get("parse").As<Napi::Function>();
      Napi::String json_str = Napi::String::New(
          self->env_, state->string_buffer, state->string_length);
      current_value = parse.Call({json_str});
    } catch (...) {
      // If JSON parsing fails, return the string instead
      current_value = Napi::String::New(self->env_, state->string_buffer,
                                        state->string_length);
    }
    break;
  }
  case AggregateValue::NULL_VAL:
  default:
    current_value = self->env_.Null();
    break;
  }

  // For window functions, xValue is called for each row and xFinal is called at
  // the end. We should only call the result function once per actual result
  // row.
  // - xValue (is_final=false): Called for each row in window functions, call
  // result function
  // - xFinal (is_final=true): For regular aggregates, call result function
  //                           For window aggregates (xvalue_called=true), skip
  //                           result function
  bool should_call_result = !is_final || !state->xvalue_called;

  if (!is_final) {
    // Mark that xValue was called (this is a window function)
    state->xvalue_called = true;
  }

  // Apply result function if provided and appropriate
  Napi::Value final_value = current_value;
  if (should_call_result && !self->result_fn_.IsEmpty()) {
    Napi::Function result_func = self->result_fn_.Value();

    std::vector<napi_value> args = {current_value};
    napi_value result;

    napi_status status =
        napi_call_function(self->env_, self->env_.Undefined(), result_func, 1,
                           args.data(), &result);

    if (status != napi_ok || self->env_.IsExceptionPending()) {
      // JavaScript exception is pending - let it propagate
      self->db_->SetIgnoreNextSQLiteError(true);
      sqlite3_result_error(ctx, "", 0);
      return;
    }

    final_value = Napi::Value(self->env_, result);
  }

  // Convert the final JavaScript value to SQLite result
  self->JSValueToSqliteResult(ctx, final_value);

  // Check if JSValueToSqliteResult threw an exception (e.g., ERR_OUT_OF_RANGE)
  if (self->env_.IsExceptionPending()) {
    // Ignore the SQLite error because a JavaScript exception is pending
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }
}

CustomAggregate::AggregateData *
CustomAggregate::GetAggregate(sqlite3_context *ctx) {
  AggregateData *agg = static_cast<AggregateData *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateData)));

  if (!agg) {
    sqlite3_result_error(ctx, "Failed to allocate aggregate context", -1);
    return nullptr;
  }

  if (!agg->initialized) {
    Napi::Value start_value;

    if (start_type_ == FUNCTION) {
      // Call start function
      Napi::Function start_func = start_fn_.Value();
      napi_value result;
      napi_async_context async_ctx = GetAsyncContext();

      napi_status status = napi_make_callback(env_, async_ctx, env_.Undefined(),
                                              start_func, 0, nullptr, &result);

      if (status != napi_ok) {
        sqlite3_result_error(ctx, "Error calling aggregate start function", -1);
        return nullptr;
      }

      start_value = Napi::Value(env_, result);
    } else {
      start_value = GetStartValue();
    }

    agg->value_id = ValueStorage::Store(env_, start_value);
    agg->initialized = true;
    agg->is_window = false;
  }

  return agg;
}

void CustomAggregate::DestroyAggregateData(sqlite3_context *ctx) {
  AggregateData *agg = static_cast<AggregateData *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateData)));

  if (agg && agg->initialized) {
    ValueStorage::Remove(agg->value_id);
    agg->initialized = false;
  }
}

Napi::Value CustomAggregate::SqliteValueToJS(sqlite3_value *value) {
  switch (sqlite3_value_type(value)) {
  case SQLITE_NULL:
    return env_.Null();

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

  case SQLITE_FLOAT:
    return Napi::Number::New(env_, sqlite3_value_double(value));

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

  default:
    return env_.Undefined();
  }
}

void CustomAggregate::JSValueToSqliteResult(sqlite3_context *ctx,
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
    std::string str = value.As<Napi::String>().Utf8Value();
    sqlite3_result_text(ctx, str.c_str(), static_cast<int>(str.length()),
                        SQLITE_TRANSIENT);
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
    // Promises are not supported
    sqlite3_result_error(
        ctx, "Asynchronous user-defined functions are not supported", -1);
  } else {
    // Unsupported type
    sqlite3_result_error(
        ctx, "Returned JavaScript value cannot be converted to a SQLite value",
        -1);
  }
}

Napi::Value CustomAggregate::GetStartValue() {
  switch (start_type_) {
  case PRIMITIVE_NULL:
    return env_.Null();
  case PRIMITIVE_UNDEFINED:
    return env_.Undefined();
  case PRIMITIVE_NUMBER:
    return Napi::Number::New(env_, number_value_);
  case PRIMITIVE_STRING:
    return Napi::String::New(env_, string_value_);
  case PRIMITIVE_BOOLEAN:
    return Napi::Boolean::New(env_, boolean_value_);
  case PRIMITIVE_BIGINT:
    return Napi::BigInt::New(env_, bigint_value_);
  case OBJECT:
    return object_ref_.Value();
  case FUNCTION:
    // This shouldn't be called for FUNCTION type - it's handled separately
    return env_.Undefined();
  default:
    return env_.Undefined();
  }
}

napi_async_context CustomAggregate::GetAsyncContext() {
  if (async_context_ == nullptr) {
    napi_async_context context;
    napi_status status =
        napi_async_init(env_, env_.Null(),
                        Napi::String::New(env_, "sqlite_aggregate"), &context);
    if (status == napi_ok) {
      async_context_ = context;
    }
  }
  return async_context_;
}

// Helper method for safe JSON serialization with circular reference handling
std::string CustomAggregate::SafeJsonStringify(Napi::Env env,
                                               Napi::Value value) {
  try {
    Napi::Object global = env.Global();
    Napi::Object json = global.Get("JSON").As<Napi::Object>();
    Napi::Function stringify = json.Get("stringify").As<Napi::Function>();
    Napi::Value json_result = stringify.Call({value});
    return json_result.As<Napi::String>().Utf8Value();
  } catch (...) {
    // Handle circular references by creating a simplified object
    // Try to preserve key properties while breaking circularity
    try {
      if (!value.IsObject()) {
        return "{\"_error\":\"non_object\"}";
      }

      Napi::Object obj = value.As<Napi::Object>();
      // For objects with circular refs, try to extract simple properties
      if (obj.Has("value")) {
        Napi::Value value_prop = obj.Get("value");
        if (value_prop.IsNumber()) {
          double val = value_prop.As<Napi::Number>().DoubleValue();
          return "{\"value\":" + std::to_string(val) + "}";
        } else {
          return "{\"value\":0}";
        }
      } else {
        return "{\"_error\":\"circular_reference\"}";
      }
    } catch (...) {
      return "{\"_error\":\"circular_reference\"}";
    }
  }
}

} // namespace photostructure::sqlite