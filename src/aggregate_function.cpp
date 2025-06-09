#include "aggregate_function.h"

#include <cmath>
#include <cstring>

#include "shims/node_errors.h"
#include "sqlite_impl.h"

namespace photostructure {
namespace sqlite {

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

  // Create async context for callbacks
  napi_status status = napi_async_init(
      env, nullptr, Napi::String::New(env, "SQLiteAggregate"), &async_context_);
  if (status != napi_ok) {
    Napi::Error::New(env, "Failed to create async context")
        .ThrowAsJavaScriptException();
  }
}

CustomAggregate::~CustomAggregate() {
  if (start_type_ == OBJECT && !object_ref_.IsEmpty()) {
    object_ref_.Reset();
  }
  if (!step_fn_.IsEmpty())
    step_fn_.Reset();
  if (!inverse_fn_.IsEmpty())
    inverse_fn_.Reset();
  if (!result_fn_.IsEmpty())
    result_fn_.Reset();

  // Cleanup async context
  if (async_context_ != nullptr) {
    napi_async_destroy(env_, async_context_);
  }
}

void CustomAggregate::xStep(sqlite3_context *ctx, int argc,
                            sqlite3_value **argv) {
  xStepBase(ctx, argc, argv, false);
}

void CustomAggregate::xInverse(sqlite3_context *ctx, int argc,
                               sqlite3_value **argv) {
  xStepBase(ctx, argc, argv, true);
}

void CustomAggregate::xFinal(sqlite3_context *ctx) { xValueBase(ctx, true); }

void CustomAggregate::xValue(sqlite3_context *ctx) { xValueBase(ctx, false); }

void CustomAggregate::xDestroy(void *self) {
  if (self) {
    delete static_cast<CustomAggregate *>(self);
  }
}

void CustomAggregate::xStepBase(sqlite3_context *ctx, int argc,
                                sqlite3_value **argv, bool use_inverse) {
  void *user_data = sqlite3_user_data(ctx);
  if (!user_data) {
    sqlite3_result_error(ctx, "Invalid user data in aggregate function", -1);
    return;
  }

  CustomAggregate *self = static_cast<CustomAggregate *>(user_data);
  if (!self) {
    sqlite3_result_error(ctx, "No user data", -1);
    return;
  }

  // Create HandleScope and CallbackScope for this operation
  Napi::HandleScope scope(self->env_);
  Napi::CallbackScope callback_scope(self->env_, self->async_context_);

  try {
    auto agg = self->GetAggregate(ctx);
    if (!agg) {
      sqlite3_result_error(ctx, "Failed to get aggregate context", -1);
      return;
    }

    // Choose the right function
    Napi::Function func;
    if (use_inverse) {
      if (self->inverse_fn_.IsEmpty()) {
        sqlite3_result_error(ctx, "Inverse function not provided", -1);
        return;
      }
      func = self->inverse_fn_.Value();
    } else {
      if (self->step_fn_.IsEmpty()) {
        sqlite3_result_error(ctx, "Step function is empty", -1);
        return;
      }
      func = self->step_fn_.Value();
    }

    // Prepare arguments for JavaScript function call
    std::vector<Napi::Value> js_argv;

    // First argument is the current aggregate value
    Napi::Value agg_val;
    if (agg->first_call) {
      agg_val = self->GetStartValue();
      // Store the start value as raw data for future reference
      self->StoreJSValueAsRaw(agg, agg_val);
      agg->first_call = false;
    } else {
      agg_val = self->RawValueToJS(agg);
    }
    js_argv.push_back(agg_val);

    // Add the SQLite arguments
    for (int i = 0; i < argc; ++i) {
      Napi::Value js_val = self->SqliteValueToJS(argv[i]);
      js_argv.push_back(js_val);
    }

    // Call the JavaScript function
    Napi::Value result;
    try {
      // Debug: Log the call
      result = func.Call(js_argv);
      if (result.IsEmpty() || result.IsUndefined()) {
        sqlite3_result_error(ctx, "Step function returned empty/undefined", -1);
        return;
      }
    } catch (const std::exception &e) {
      throw;
    }

    // Update the aggregate value
    self->StoreJSValueAsRaw(agg, result);

  } catch (const Napi::Error &e) {
    // More detailed error message
    std::string error_msg = "Aggregate step error: ";
    error_msg += e.what();
    sqlite3_result_error(ctx, error_msg.c_str(), -1);
  } catch (const std::exception &e) {
    // Catch any other exceptions
    std::string error_msg = "Aggregate step exception: ";
    error_msg += e.what();
    sqlite3_result_error(ctx, error_msg.c_str(), -1);
  }
}

void CustomAggregate::xValueBase(sqlite3_context *ctx, bool finalize) {
  void *user_data = sqlite3_user_data(ctx);
  if (!user_data) {
    sqlite3_result_error(ctx, "Invalid user data in aggregate value function",
                         -1);
    return;
  }

  CustomAggregate *self = static_cast<CustomAggregate *>(user_data);

  // Create HandleScope and CallbackScope for this operation
  Napi::HandleScope scope(self->env_);
  Napi::CallbackScope callback_scope(self->env_, self->async_context_);

  try {
    auto agg = self->GetAggregate(ctx);
    if (!agg) {
      sqlite3_result_null(ctx);
      return;
    }

    Napi::Value final_value = self->RawValueToJS(agg);

    // If we have a result function, call it
    if (!self->result_fn_.IsEmpty()) {
      Napi::Function result_func = self->result_fn_.Value();
      final_value = result_func.Call({final_value});
    }

    // Convert to SQLite result
    self->JSValueToSqliteResult(ctx, final_value);

    // Clean up if this is finalization
    if (finalize) {
      // Properly destroy the C++ object constructed with placement new
      // This will call the destructor for Napi::Reference members
      agg->~AggregateData();
    }

  } catch (const Napi::Error &e) {
    sqlite3_result_error(ctx, e.what(), -1);
  }
}

CustomAggregate::AggregateData *
CustomAggregate::GetAggregate(sqlite3_context *ctx) {
  AggregateData *agg = static_cast<AggregateData *>(
      sqlite3_aggregate_context(ctx, sizeof(AggregateData)));

  // sqlite3_aggregate_context only returns NULL if size is 0 or memory
  // allocation fails
  if (!agg) {
    return nullptr;
  }

  // Check if this is uninitialized memory by testing if initialized flag is
  // false or garbage We need to be careful because the memory might contain
  // random values Check if this memory has been initialized as a C++ object
  if (agg->initialized != true) {
    // First call - use placement new to properly construct the C++ object
    new (agg) AggregateData();
    agg->value_type = AggregateData::TYPE_NULL;
    agg->number_val = 0.0;
    agg->boolean_val = false;
    agg->bigint_val = 0;
    agg->initialized = true;
    agg->is_window = false;
    agg->first_call = true; // Mark that we need to initialize with start value
  }

  return agg;
}

Napi::Value CustomAggregate::SqliteValueToJS(sqlite3_value *value) {
  // Don't create HandleScope here - let the caller manage it

  int type = sqlite3_value_type(value);

  switch (type) {
  case SQLITE_INTEGER: {
    sqlite3_int64 int_val = sqlite3_value_int64(value);
    if (use_bigint_args_) {
      return Napi::BigInt::New(env_, static_cast<int64_t>(int_val));
    } else {
      return Napi::Number::New(env_, static_cast<double>(int_val));
    }
    break;
  }
  case SQLITE_FLOAT: {
    double float_val = sqlite3_value_double(value);
    return Napi::Number::New(env_, float_val);
  }
  case SQLITE_TEXT: {
    const char *text_val =
        reinterpret_cast<const char *>(sqlite3_value_text(value));
    return Napi::String::New(env_, text_val);
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

void CustomAggregate::JSValueToSqliteResult(sqlite3_context *ctx,
                                            Napi::Value value) {
  if (value.IsNull() || value.IsUndefined()) {
    sqlite3_result_null(ctx);
  } else if (value.IsBoolean()) {
    bool bool_val = value.As<Napi::Boolean>().Value();
    sqlite3_result_int(ctx, bool_val ? 1 : 0);
  } else if (value.IsBigInt()) {
    bool lossless;
    int64_t bigint_val = value.As<Napi::BigInt>().Int64Value(&lossless);
    if (lossless) {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(bigint_val));
    } else {
      sqlite3_result_error(ctx, "BigInt value too large for SQLite", -1);
    }
  } else if (value.IsNumber()) {
    double num_val = value.As<Napi::Number>().DoubleValue();
    // Note: We cast INT64_MIN/MAX to double to avoid implicit conversion
    // warnings
    if (floor(num_val) == num_val &&
        num_val >= static_cast<double>(INT64_MIN) &&
        num_val <= static_cast<double>(INT64_MAX)) {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(num_val));
    } else {
      sqlite3_result_double(ctx, num_val);
    }
  } else if (value.IsString()) {
    std::string str_val = value.As<Napi::String>().Utf8Value();
    sqlite3_result_text(ctx, str_val.c_str(), str_val.length(),
                        SQLITE_TRANSIENT);
  } else if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
    sqlite3_result_blob(ctx, buffer.Data(), buffer.Length(), SQLITE_TRANSIENT);
  } else {
    // Convert to string as fallback
    std::string str_val = value.ToString().Utf8Value();
    sqlite3_result_text(ctx, str_val.c_str(), str_val.length(),
                        SQLITE_TRANSIENT);
  }
}

Napi::Value CustomAggregate::GetStartValue() {
  // Don't create HandleScope here - let the caller manage it

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
  default:
    return env_.Null();
  }
}

void CustomAggregate::StoreJSValueAsRaw(AggregateData *agg, Napi::Value value) {
  // Always clean up previous object reference if it exists
  if (agg->value_type == AggregateData::TYPE_OBJECT &&
      !agg->object_ref.IsEmpty()) {
    agg->object_ref.Reset();
  }

  if (value.IsNull()) {
    agg->value_type = AggregateData::TYPE_NULL;
  } else if (value.IsUndefined()) {
    agg->value_type = AggregateData::TYPE_UNDEFINED;
  } else if (value.IsNumber()) {
    agg->value_type = AggregateData::TYPE_NUMBER;
    agg->number_val = value.As<Napi::Number>().DoubleValue();
  } else if (value.IsString()) {
    agg->value_type = AggregateData::TYPE_STRING;
    agg->string_val = value.As<Napi::String>().Utf8Value();
  } else if (value.IsBoolean()) {
    agg->value_type = AggregateData::TYPE_BOOLEAN;
    agg->boolean_val = value.As<Napi::Boolean>().Value();
  } else if (value.IsBigInt()) {
    agg->value_type = AggregateData::TYPE_BIGINT;
    bool lossless;
    agg->bigint_val = value.As<Napi::BigInt>().Int64Value(&lossless);
  } else {
    // Complex object - this still requires Persistent reference
    agg->value_type = AggregateData::TYPE_OBJECT;
    agg->object_ref = Napi::Reference<Napi::Value>::New(value, 1);
  }
}

Napi::Value CustomAggregate::RawValueToJS(AggregateData *agg) {
  // Don't create HandleScope here - it should be managed by the caller

  switch (agg->value_type) {
  case AggregateData::TYPE_NULL:
    return env_.Null();
  case AggregateData::TYPE_UNDEFINED:
    return env_.Undefined();
  case AggregateData::TYPE_NUMBER:
    return Napi::Number::New(env_, agg->number_val);
  case AggregateData::TYPE_STRING:
    return Napi::String::New(env_, agg->string_val);
  case AggregateData::TYPE_BOOLEAN:
    return Napi::Boolean::New(env_, agg->boolean_val);
  case AggregateData::TYPE_BIGINT:
    return Napi::BigInt::New(env_, agg->bigint_val);
  case AggregateData::TYPE_OBJECT:
    return agg->object_ref.Value();
  default:
    return env_.Null();
  }
}

} // namespace sqlite
} // namespace photostructure