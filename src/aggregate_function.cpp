#include "aggregate_function.h"
#include "sqlite_impl.h"
#include "shims/node_errors.h"
#include <cmath>

namespace photostructure {
namespace sqlite {

CustomAggregate::CustomAggregate(Napi::Env env,
                                DatabaseSync* db,
                                bool use_bigint_args,
                                Napi::Value start,
                                Napi::Function step_fn,
                                Napi::Function inverse_fn,
                                Napi::Function result_fn)
    : env_(env), db_(db), use_bigint_args_(use_bigint_args),
      start_(Napi::Persistent(start)),
      step_fn_(Napi::Persistent(step_fn)) {
  
  start_.SuppressDestruct();
  step_fn_.SuppressDestruct();
  
  if (!inverse_fn.IsEmpty()) {
    inverse_fn_ = Napi::Persistent(inverse_fn);
    inverse_fn_.SuppressDestruct();
  }
  if (!result_fn.IsEmpty()) {
    result_fn_ = Napi::Persistent(result_fn);
    result_fn_.SuppressDestruct();
  }
}

CustomAggregate::~CustomAggregate() {
  start_.Reset();
  step_fn_.Reset();
  inverse_fn_.Reset();
  result_fn_.Reset();
}

void CustomAggregate::xStep(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
  xStepBase(ctx, argc, argv, false);
}

void CustomAggregate::xInverse(sqlite3_context* ctx, int argc, sqlite3_value** argv) {
  xStepBase(ctx, argc, argv, true);
}

void CustomAggregate::xFinal(sqlite3_context* ctx) {
  xValueBase(ctx, true);
}

void CustomAggregate::xValue(sqlite3_context* ctx) {
  xValueBase(ctx, false);
}

void CustomAggregate::xDestroy(void* self) {
  delete static_cast<CustomAggregate*>(self);
}

void CustomAggregate::xStepBase(sqlite3_context* ctx, int argc, sqlite3_value** argv, bool use_inverse) {
  CustomAggregate* self = static_cast<CustomAggregate*>(sqlite3_user_data(ctx));
  
  try {
    auto agg = self->GetAggregate(ctx);
    if (!agg) {
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
      func = self->step_fn_.Value();
    }

    // Prepare arguments for JavaScript function call
    std::vector<napi_value> js_argv;
    
    // First argument is the current aggregate value
    js_argv.push_back(agg->value.Value());
    
    // Add the SQLite arguments
    for (int i = 0; i < argc; ++i) {
      Napi::Value js_val = self->SqliteValueToJS(argv[i]);
      js_argv.push_back(js_val);
    }
    
    // Call the JavaScript function
    Napi::Value result = func.Call(js_argv);
    
    // Update the aggregate value
    agg->value.Reset();
    agg->value = Napi::Persistent(result);
    agg->value.SuppressDestruct();
    
  } catch (const Napi::Error& e) {
    sqlite3_result_error(ctx, e.what(), -1);
  }
}

void CustomAggregate::xValueBase(sqlite3_context* ctx, bool finalize) {
  CustomAggregate* self = static_cast<CustomAggregate*>(sqlite3_user_data(ctx));
  
  try {
    auto agg = self->GetAggregate(ctx);
    if (!agg) {
      sqlite3_result_null(ctx);
      return;
    }

    Napi::Value final_value = agg->value.Value();
    
    // If we have a result function, call it
    if (!self->result_fn_.IsEmpty()) {
      Napi::Function result_func = self->result_fn_.Value();
      final_value = result_func.Call({final_value});
    }
    
    // Convert to SQLite result
    self->JSValueToSqliteResult(ctx, final_value);
    
    // Clean up if this is finalization
    if (finalize) {
      agg->value.Reset();
    }
    
  } catch (const Napi::Error& e) {
    sqlite3_result_error(ctx, e.what(), -1);
  }
}

CustomAggregate::AggregateData* CustomAggregate::GetAggregate(sqlite3_context* ctx) {
  AggregateData* agg = static_cast<AggregateData*>(sqlite3_aggregate_context(ctx, sizeof(AggregateData)));
  if (!agg) {
    return nullptr;
  }
  
  if (!agg->initialized) {
    // First call - initialize the aggregate
    agg->value = Napi::Persistent(start_.Value());
    agg->value.SuppressDestruct();
    agg->initialized = true;
    agg->is_window = false;
  }
  
  return agg;
}

Napi::Value CustomAggregate::SqliteValueToJS(sqlite3_value* value) {
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
      const char* text_val = reinterpret_cast<const char*>(sqlite3_value_text(value));
      return Napi::String::New(env_, text_val);
    }
    case SQLITE_BLOB: {
      const void* blob_data = sqlite3_value_blob(value);
      int blob_size = sqlite3_value_bytes(value);
      return Napi::Buffer<uint8_t>::Copy(env_, static_cast<const uint8_t*>(blob_data), blob_size);
    }
    case SQLITE_NULL:
    default:
      return env_.Null();
  }
}

void CustomAggregate::JSValueToSqliteResult(sqlite3_context* ctx, Napi::Value value) {
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
    if (floor(num_val) == num_val && num_val >= INT64_MIN && num_val <= INT64_MAX) {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(num_val));
    } else {
      sqlite3_result_double(ctx, num_val);
    }
  } else if (value.IsString()) {
    std::string str_val = value.As<Napi::String>().Utf8Value();
    sqlite3_result_text(ctx, str_val.c_str(), str_val.length(), SQLITE_TRANSIENT);
  } else if (value.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
    sqlite3_result_blob(ctx, buffer.Data(), buffer.Length(), SQLITE_TRANSIENT);
  } else {
    // Convert to string as fallback
    std::string str_val = value.ToString().Utf8Value();
    sqlite3_result_text(ctx, str_val.c_str(), str_val.length(), SQLITE_TRANSIENT);
  }
}

} // namespace sqlite
} // namespace photostructure