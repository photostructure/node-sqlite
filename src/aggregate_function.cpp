#include "aggregate_function.h"

#include <cstring>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <vector>

#include "shims/node_errors.h"
#include "sqlite_impl.h"
#include "sqlite_value_conversion.h"
#include "user_function.h"

namespace photostructure::sqlite {

// ValueStorage implementation
int32_t ValueStorage::Store(Napi::Env env, Napi::Value value) {
  AddonData *addon_data = GetAddonData(env);
  if (!addon_data)
    throw Napi::Error::New(env, "Addon data not found");

  std::lock_guard<std::mutex> lock(addon_data->value_storage_mutex);
  const int32_t id =
      addon_data->next_value_id.fetch_add(1, std::memory_order_relaxed);
  try {
    addon_data->value_storage[id] = Napi::Reference<Napi::Value>::New(value, 1);
  } catch (...) {
    // If Reference creation fails, throw to let caller handle
    throw;
  }
  return id;
}

Napi::Value ValueStorage::Get(Napi::Env env, int32_t id) {
  AddonData *addon_data = GetAddonData(env);
  if (!addon_data)
    return env.Null();

  std::lock_guard<std::mutex> lock(addon_data->value_storage_mutex);
  auto it = addon_data->value_storage.find(id);
  if (it == addon_data->value_storage.end() || it->second.IsEmpty()) {
    return env.Null();
  }
  return it->second.Value();
}

void ValueStorage::Remove(Napi::Env env, int32_t id) {
  AddonData *addon_data = GetAddonData(env);
  if (!addon_data)
    return;

  std::lock_guard<std::mutex> lock(addon_data->value_storage_mutex);
  auto it = addon_data->value_storage.find(id);
  if (it != addon_data->value_storage.end()) {
    // Don't call Reset() here - it's unsafe during environment teardown on
    // musl. The Cleanup() hook will reset all remaining references safely. For
    // refs removed during normal operation, they'll be cleaned up by GC.
    addon_data->value_storage.erase(it);
  }
}

void CustomAggregate::CleanupHook(void *arg) {
  // Called before environment teardown - safe to Reset() references here
  auto *self = static_cast<CustomAggregate *>(arg);

  if (!self->start_fn_.IsEmpty())
    self->start_fn_.Reset();
  if (!self->object_ref_.IsEmpty())
    self->object_ref_.Reset();
  if (!self->step_fn_.IsEmpty())
    self->step_fn_.Reset();
  if (!self->inverse_fn_.IsEmpty())
    self->inverse_fn_.Reset();
  if (!self->result_fn_.IsEmpty())
    self->result_fn_.Reset();
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

  // Register cleanup hook to Reset() references before environment teardown.
  // This is required for worker thread support per Node-API best practices.
  // See:
  // https://nodejs.github.io/node-addon-examples/special-topics/context-awareness/
  napi_add_env_cleanup_hook(env_, CleanupHook, this);

  // Don't create async context immediately - we'll create it lazily if needed
  async_context_ = nullptr;
}

CustomAggregate::~CustomAggregate() {
  // Remove cleanup hook if still registered
  napi_remove_env_cleanup_hook(env_, CleanupHook, this);

  // Don't call Reset() on references here - CleanupHook already handled them,
  // or the environment is being torn down and Reset() would be unsafe.

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

// SQLite calls these four, so none may let a C++ exception unwind into it.
// xStepBase() and xValueBase() check the user data before anything that can
// throw.
void CustomAggregate::xStep(sqlite3_context *ctx, int argc,
                            sqlite3_value **argv) {
  try {
    xStepBase(ctx, argc, argv, &CustomAggregate::step_fn_);
  } catch (...) {
    auto *self = static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
    FailWithCaughtException(self->env_, self->db_, ctx);
  }
}

void CustomAggregate::xInverse(sqlite3_context *ctx, int argc,
                               sqlite3_value **argv) {
  try {
    xStepBase(ctx, argc, argv, &CustomAggregate::inverse_fn_);
  } catch (...) {
    auto *self = static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
    FailWithCaughtException(self->env_, self->db_, ctx);
  }
}

void CustomAggregate::xFinal(sqlite3_context *ctx) {
  try {
    xValueBase(ctx, true);
    DestroyAggregateData(ctx);
  } catch (...) {
    auto *self = static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
    FailWithCaughtException(self->env_, self->db_, ctx);
  }
}

void CustomAggregate::xValue(sqlite3_context *ctx) {
  try {
    xValueBase(ctx, false);
  } catch (...) {
    auto *self = static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
    FailWithCaughtException(self->env_, self->db_, ctx);
  }
}

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

  auto callback_guard = self->db_->EnterCallback();
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

    // A start value of a type StoreValue() does not store is kept as null.
    state->type = AggregateValue::NULL_VAL;
    if (!StoreValue(self->env_, state, start_val)) {
      self->db_->SetIgnoreNextSQLiteError(true);
      sqlite3_result_error(ctx, "", 0);
      return;
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
    Napi::Value js_val =
        SqliteValueToJS(self->env_, argv[i], self->use_bigint_args_);

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
    // Check if it's a Promise by looking for 'then' method. Raw Node-API,
    // because a getter can run JavaScript: when it throws, node-addon-api's
    // Get() converts the exception with Napi::Error::New(env), which aborts
    // the process for the termination exception process.exit() leaves in a
    // worker. A failed read leaves the exception pending, as a throwing step
    // function does.
    bool has_then = false;
    napi_value then = nullptr;
    if (napi_has_named_property(self->env_, result, "then", &has_then) !=
            napi_ok ||
        (has_then && napi_get_named_property(self->env_, result, "then",
                                             &then) != napi_ok)) {
      self->db_->SetIgnoreNextSQLiteError(true);
      sqlite3_result_error(ctx, "", 0);
      return;
    }
    napi_valuetype then_type;
    if (has_then && napi_typeof(self->env_, then, &then_type) == napi_ok &&
        then_type == napi_function) {
      sqlite3_result_error(ctx, "User-defined function returned invalid type",
                           -1);
      return;
    }
  }

  if (!StoreValue(self->env_, state, result_val)) {
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }
}

// AggregateValue lives in SQLite's aggregate context, so it holds only POD
// (see AGENTS.md): strings, Buffers and object JSON are copied into
// string_buffer, and BigInts are stored as int64. A value that does not fit
// throws instead of being truncated, replaced with {"_truncated":true}, or
// wrapped, as it was before. node:sqlite keeps the JavaScript value itself and
// has neither limit. A value of any other type leaves `state` unchanged.
bool CustomAggregate::StoreValue(Napi::Env env, AggregateValue *state,
                                 Napi::Value value) {
  constexpr size_t kMaxBytes = sizeof(AggregateValue::string_buffer) - 1;
  auto store_bytes = [&](AggregateValue::Type type, const char *kind,
                         const void *data, size_t size) {
    if (size > kMaxBytes) {
      std::string message = std::string("Aggregate ") + kind +
                            " is too large: " + std::to_string(size) +
                            " bytes, and the limit is " +
                            std::to_string(kMaxBytes);
      node::THROW_ERR_OUT_OF_RANGE(env, message.c_str());
      return false;
    }
    state->type = type;
    if (size > 0) {
      memcpy(state->string_buffer, data, size);
    }
    state->string_buffer[size] = '\0';
    state->string_length = size;
    return true;
  };

  if (value.IsNumber()) {
    state->type = AggregateValue::NUMBER;
    state->number_value = value.As<Napi::Number>().DoubleValue();
  } else if (value.IsString()) {
    std::string str = value.As<Napi::String>().Utf8Value();
    return store_bytes(AggregateValue::STRING, "string", str.data(),
                       str.size());
  } else if (value.IsBigInt()) {
    bool lossless;
    int64_t bigint_value = value.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      node::THROW_ERR_OUT_OF_RANGE(
          env,
          "BigInt value is too large to be represented as a SQLite integer");
      return false;
    }
    state->type = AggregateValue::BIGINT;
    state->bigint_value = bigint_value;
  } else if (value.IsBoolean()) {
    state->type = AggregateValue::BOOLEAN;
    state->bool_value = value.As<Napi::Boolean>().Value();
  } else if (value.IsDataView()) {
    // Before IsBuffer(): N-API's IsBuffer() is true for any ArrayBufferView,
    // and reading a DataView as a Buffer throws.
    Napi::DataView view = value.As<Napi::DataView>();
    return store_bytes(AggregateValue::BUFFER, "DataView",
                       static_cast<const uint8_t *>(view.ArrayBuffer().Data()) +
                           view.ByteOffset(),
                       view.ByteLength());
  } else if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
    return store_bytes(AggregateValue::BUFFER, "Buffer", buffer.Data(),
                       buffer.Length());
  } else if (value.IsObject() || value.IsArray()) {
    std::string json = SafeJsonStringify(env, value);
    return store_bytes(AggregateValue::OBJECT_JSON, "object's JSON",
                       json.data(), json.size());
  } else if (value.IsNull() || value.IsUndefined()) {
    state->type = AggregateValue::NULL_VAL;
  }
  return true;
}

void CustomAggregate::xValueBase(sqlite3_context *ctx, bool is_final) {
  CustomAggregate *self =
      static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
  if (!self) {
    sqlite3_result_error(ctx, "No user data", -1);
    return;
  }

  auto callback_guard = self->db_->EnterCallback();
  Napi::HandleScope scope(self->env_);

  // SQLite calls xFinal after a step fails, with that step's JavaScript
  // exception still pending. Rebuilding the state below would make N-API
  // calls that fail while an exception is pending, and node-addon-api's
  // handling of that failure clears it, so leave it for the caller.
  if (self->env_.IsExceptionPending()) {
    self->db_->SetIgnoreNextSQLiteError(true);
    sqlite3_result_error(ctx, "", 0);
    return;
  }

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
  JSValueToSqliteResult(self->env_, ctx, final_value);

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
  CustomAggregate *self =
      static_cast<CustomAggregate *>(sqlite3_user_data(ctx));
  AggregateData *agg = static_cast<AggregateData *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateData)));

  if (!self || !agg || !agg->initialized) {
    return;
  }
  ValueStorage::Remove(self->env_, agg->value_id);
  agg->initialized = false;
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
    // Not Napi::Function::Call(): when a toJSON() method or getter throws, it
    // converts the exception with Napi::Error::New(env), which aborts the
    // process for the termination exception process.exit() leaves in a
    // worker. Clear the exception and fall back as for any other failure.
    napi_value argv[] = {value};
    napi_value json_result;
    if (napi_call_function(env, env.Undefined(), stringify, 1, argv,
                           &json_result) != napi_ok) {
      napi_value discarded;
      napi_get_and_clear_last_exception(env, &discarded);
      throw std::runtime_error("JSON.stringify() threw");
    }
    return Napi::Value(env, json_result).As<Napi::String>().Utf8Value();
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
