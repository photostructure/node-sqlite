#include "sqlite_impl.h"
#include "user_function.h"
#include "aggregate_function.h"
#include <iostream>
#include <cmath>
#include <climits>
#include <algorithm>

namespace photostructure {
namespace sqlite {

// Static member initialization
Napi::FunctionReference DatabaseSync::constructor_;
Napi::FunctionReference StatementSync::constructor_;

// DatabaseSync Implementation
Napi::Object DatabaseSync::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "DatabaseSync", {
    InstanceMethod("open", &DatabaseSync::Open),
    InstanceMethod("close", &DatabaseSync::Close),
    InstanceMethod("prepare", &DatabaseSync::Prepare),
    InstanceMethod("exec", &DatabaseSync::Exec),
    InstanceMethod("function", &DatabaseSync::CustomFunction),
    InstanceMethod("aggregate", &DatabaseSync::AggregateFunction),
    InstanceAccessor("location", &DatabaseSync::LocationGetter, nullptr),
    InstanceAccessor("isOpen", &DatabaseSync::IsOpenGetter, nullptr),
    InstanceAccessor("isTransaction", &DatabaseSync::IsTransactionGetter, nullptr)
  });
  
  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();
  
  exports.Set("DatabaseSync", func);
  return exports;
}

DatabaseSync::DatabaseSync(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<DatabaseSync>(info) {
  
  // Optional location parameter
  std::string location = ":memory:";
  if (info.Length() > 0 && info[0].IsString()) {
    location = info[0].As<Napi::String>().Utf8Value();
  }
  
  // If location provided, open immediately
  if (info.Length() > 0) {
    try {
      DatabaseOpenConfiguration config(std::move(location));
      
      // Handle options object
      if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        
        if (options.Has("readOnly") && options.Get("readOnly").IsBoolean()) {
          config.set_read_only(options.Get("readOnly").As<Napi::Boolean>().Value());
        }
        
        if (options.Has("enableForeignKeys") && options.Get("enableForeignKeys").IsBoolean()) {
          config.set_enable_foreign_keys(options.Get("enableForeignKeys").As<Napi::Boolean>().Value());
        }
        
        if (options.Has("timeout") && options.Get("timeout").IsNumber()) {
          config.set_timeout(options.Get("timeout").As<Napi::Number>().Int32Value());
        }
      }
      
      InternalOpen(config);
    } catch (const std::exception& e) {
      node::THROW_ERR_SQLITE_ERROR(info.Env(), e.what());
    }
  }
}

DatabaseSync::~DatabaseSync() {
  if (connection_) {
    InternalClose();
  }
}

Napi::Value DatabaseSync::Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is already open");
    return env.Undefined();
  }
  
  if (info.Length() < 1 || !info[0].IsObject()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected configuration object");
    return env.Undefined();
  }
  
  Napi::Object config_obj = info[0].As<Napi::Object>();
  
  if (!config_obj.Has("location") || !config_obj.Get("location").IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Configuration must have location string");
    return env.Undefined();
  }
  
  std::string location = config_obj.Get("location").As<Napi::String>().Utf8Value();
  DatabaseOpenConfiguration config(std::move(location));
  
  // Parse other options
  if (config_obj.Has("readOnly") && config_obj.Get("readOnly").IsBoolean()) {
    config.set_read_only(config_obj.Get("readOnly").As<Napi::Boolean>().Value());
  }
  
  if (config_obj.Has("enableForeignKeys") && config_obj.Get("enableForeignKeys").IsBoolean()) {
    config.set_enable_foreign_keys(config_obj.Get("enableForeignKeys").As<Napi::Boolean>().Value());
  }
  
  try {
    InternalOpen(config);
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
  }
  
  return env.Undefined();
}

Napi::Value DatabaseSync::Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }
  
  try {
    InternalClose();
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
  }
  
  return env.Undefined();
}

Napi::Value DatabaseSync::Prepare(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }
  
  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected SQL string");
    return env.Undefined();
  }
  
  std::string sql = info[0].As<Napi::String>().Utf8Value();
  
  try {
    // Create new StatementSync instance
    Napi::Object stmt_obj = StatementSync::constructor_.New({}).As<Napi::Object>();
    
    // Initialize the statement
    StatementSync* stmt = StatementSync::Unwrap(stmt_obj);
    stmt->InitStatement(this, sql);
    
    return stmt_obj;
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value DatabaseSync::Exec(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }
  
  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected SQL string");
    return env.Undefined();
  }
  
  std::string sql = info[0].As<Napi::String>().Utf8Value();
  
  char* error_msg = nullptr;
  int result = sqlite3_exec(connection_, sql.c_str(), nullptr, nullptr, &error_msg);
  
  if (result != SQLITE_OK) {
    std::string error = error_msg ? error_msg : "Unknown SQLite error";
    if (error_msg) sqlite3_free(error_msg);
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }
  
  return env.Undefined();
}

Napi::Value DatabaseSync::LocationGetter(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), location_);
}

Napi::Value DatabaseSync::IsOpenGetter(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsOpen());
}

Napi::Value DatabaseSync::IsTransactionGetter(const Napi::CallbackInfo& info) {
  // Check if we're in a transaction
  bool in_transaction = IsOpen() && !sqlite3_get_autocommit(connection_);
  return Napi::Boolean::New(info.Env(), in_transaction);
}

void DatabaseSync::InternalOpen(DatabaseOpenConfiguration config) {
  location_ = config.location();
  read_only_ = config.get_read_only();
  
  int flags = SQLITE_OPEN_CREATE;
  if (read_only_) {
    flags = SQLITE_OPEN_READONLY;
  } else {
    flags |= SQLITE_OPEN_READWRITE;
  }
  
  int result = sqlite3_open_v2(location_.c_str(), &connection_, flags, nullptr);
  
  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(connection_);
    if (connection_) {
      sqlite3_close(connection_);
      connection_ = nullptr;
    }
    throw std::runtime_error("Failed to open database: " + error);
  }
  
  // Configure database
  if (config.get_enable_foreign_keys()) {
    sqlite3_exec(connection_, "PRAGMA foreign_keys = ON", nullptr, nullptr, nullptr);
  }
  
  if (config.get_timeout() > 0) {
    sqlite3_busy_timeout(connection_, config.get_timeout());
  }
}

void DatabaseSync::InternalClose() {
  if (connection_) {
    // Finalize all prepared statements
    prepared_statements_.clear();
    
    int result = sqlite3_close(connection_);
    if (result != SQLITE_OK) {
      // Force close even if there are outstanding statements
      sqlite3_close_v2(connection_);
    }
    connection_ = nullptr;
  }
  location_.clear();
}

Napi::Value DatabaseSync::CustomFunction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }
  
  if (info.Length() < 2) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected at least 2 arguments: name and function");
    return env.Undefined();
  }
  
  if (!info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Function name must be a string");
    return env.Undefined();
  }
  
  // Parse arguments: function(name, [options], callback)
  int fn_index = info.Length() < 3 ? 1 : 2;
  bool use_bigint_args = false;
  bool varargs = false;
  bool deterministic = false;
  bool direct_only = false;
  
  // Parse options object if provided
  if (fn_index > 1 && info[1].IsObject()) {
    Napi::Object options = info[1].As<Napi::Object>();
    
    if (options.Has("useBigIntArguments") && options.Get("useBigIntArguments").IsBoolean()) {
      use_bigint_args = options.Get("useBigIntArguments").As<Napi::Boolean>().Value();
    }
    
    if (options.Has("varargs") && options.Get("varargs").IsBoolean()) {
      varargs = options.Get("varargs").As<Napi::Boolean>().Value();
    }
    
    if (options.Has("deterministic") && options.Get("deterministic").IsBoolean()) {
      deterministic = options.Get("deterministic").As<Napi::Boolean>().Value();
    }
    
    if (options.Has("directOnly") && options.Get("directOnly").IsBoolean()) {
      direct_only = options.Get("directOnly").As<Napi::Boolean>().Value();
    }
  }
  
  if (!info[fn_index].IsFunction()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Callback must be a function");
    return env.Undefined();
  }
  
  std::string name = info[0].As<Napi::String>().Utf8Value();
  Napi::Function fn = info[fn_index].As<Napi::Function>();
  
  // Determine argument count
  int argc = -1; // Default to varargs
  if (!varargs) {
    // Try to get function.length
    Napi::Value length_prop = fn.Get("length");
    if (length_prop.IsNumber()) {
      argc = length_prop.As<Napi::Number>().Int32Value();
    }
  }
  
  // Create UserDefinedFunction wrapper
  UserDefinedFunction* user_data = new UserDefinedFunction(env, fn, this, use_bigint_args);
  
  // Set SQLite flags
  int flags = SQLITE_UTF8;
  if (deterministic) {
    flags |= SQLITE_DETERMINISTIC;
  }
  if (direct_only) {
    flags |= SQLITE_DIRECTONLY;
  }
  
  // Register with SQLite
  int result = sqlite3_create_function_v2(
    connection_,
    name.c_str(),
    argc,
    flags,
    user_data,
    UserDefinedFunction::xFunc,
    nullptr, // No aggregate step
    nullptr, // No aggregate final
    UserDefinedFunction::xDestroy
  );
  
  if (result != SQLITE_OK) {
    delete user_data; // Clean up on failure
    std::string error = "Failed to create function: ";
    error += sqlite3_errmsg(connection_);
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }
  
  return env.Undefined();
}

Napi::Value DatabaseSync::AggregateFunction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }
  
  if (info.Length() < 2) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected at least 2 arguments: name and options");
    return env.Undefined();
  }
  
  if (!info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Function name must be a string");
    return env.Undefined();
  }
  
  if (!info[1].IsObject()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Options must be an object");
    return env.Undefined();
  }
  
  std::string name = info[0].As<Napi::String>().Utf8Value();
  Napi::Object options = info[1].As<Napi::Object>();
  
  // Parse required options - start can be undefined, will default to null
  Napi::Value start = env.Null();
  if (options.Has("start") && !options.Get("start").IsUndefined()) {
    start = options.Get("start");
  }
  
  if (!options.Has("step") || !options.Get("step").IsFunction()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "options.step must be a function");
    return env.Undefined();
  }
  
  Napi::Function step_fn = options.Get("step").As<Napi::Function>();
  
  // Parse optional options
  Napi::Function inverse_fn;
  if (options.Has("inverse") && options.Get("inverse").IsFunction()) {
    inverse_fn = options.Get("inverse").As<Napi::Function>();
  }
  
  Napi::Function result_fn;
  if (options.Has("result") && options.Get("result").IsFunction()) {
    result_fn = options.Get("result").As<Napi::Function>();
  }
  
  bool use_bigint_args = false;
  if (options.Has("useBigIntArguments") && options.Get("useBigIntArguments").IsBoolean()) {
    use_bigint_args = options.Get("useBigIntArguments").As<Napi::Boolean>().Value();
  }
  
  bool varargs = false;
  if (options.Has("varargs") && options.Get("varargs").IsBoolean()) {
    varargs = options.Get("varargs").As<Napi::Boolean>().Value();
  }
  
  bool deterministic = false;
  if (options.Has("deterministic") && options.Get("deterministic").IsBoolean()) {
    deterministic = options.Get("deterministic").As<Napi::Boolean>().Value();
  }
  
  bool direct_only = false;
  if (options.Has("directOnly") && options.Get("directOnly").IsBoolean()) {
    direct_only = options.Get("directOnly").As<Napi::Boolean>().Value();
  }
  
  // Determine argument count
  int argc = -1; // Default to varargs
  if (!varargs) {
    Napi::Value length_prop = step_fn.Get("length");
    if (length_prop.IsNumber()) {
      // Subtract 1 because the first argument is the aggregate value
      argc = length_prop.As<Napi::Number>().Int32Value() - 1;
    }
    
    // Also check inverse function length if provided
    if (!inverse_fn.IsEmpty()) {
      Napi::Value inverse_length = inverse_fn.Get("length");
      if (inverse_length.IsNumber()) {
        int inverse_argc = inverse_length.As<Napi::Number>().Int32Value() - 1;
        argc = std::max({argc, inverse_argc, 0});
      }
    }
    
    // Ensure argc is non-negative
    argc = std::max(argc, 0);
  }
  
  // Set SQLite flags
  int flags = SQLITE_UTF8;
  if (deterministic) {
    flags |= SQLITE_DETERMINISTIC;
  }
  if (direct_only) {
    flags |= SQLITE_DIRECTONLY;
  }
  
  // Create CustomAggregate wrapper
  CustomAggregate* user_data;
  try {
    user_data = new CustomAggregate(env, this, use_bigint_args, start, step_fn, inverse_fn, result_fn);
  } catch (const std::exception& e) {
    std::string error = "Failed to create CustomAggregate: ";
    error += e.what();
    node::THROW_ERR_INVALID_ARG_VALUE(env, error.c_str());
    return env.Undefined();
  }
  
  // Register with SQLite - Node.js always uses sqlite3_create_window_function for aggregates
  auto xInverse = !inverse_fn.IsEmpty() ? CustomAggregate::xInverse : nullptr;
  auto xValue = xInverse ? CustomAggregate::xValue : nullptr;
  int result = sqlite3_create_window_function(
    connection_,
    name.c_str(),
    argc,
    flags,
    user_data,
    CustomAggregate::xStep,
    CustomAggregate::xFinal,
    xValue,
    xInverse,
    CustomAggregate::xDestroy
  );
  
  if (result != SQLITE_OK) {
    delete user_data; // Clean up on failure
    std::string error = "Failed to create aggregate function '";
    error += name;
    error += "': ";
    error += sqlite3_errmsg(connection_);
    error += " (SQLite error code: ";
    error += std::to_string(result);
    error += ")";
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }
  
  return env.Undefined();
}

// StatementSync Implementation
Napi::Object StatementSync::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "StatementSync", {
    InstanceMethod("run", &StatementSync::Run),
    InstanceMethod("get", &StatementSync::Get),
    InstanceMethod("all", &StatementSync::All),
    InstanceMethod("iterate", &StatementSync::Iterate),
    InstanceMethod("finalize", &StatementSync::FinalizeStatement),
    InstanceAccessor("sourceSQL", &StatementSync::SourceSQLGetter, nullptr),
    InstanceAccessor("expandedSQL", &StatementSync::ExpandedSQLGetter, nullptr)
  });
  
  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();
  
  exports.Set("StatementSync", func);
  return exports;
}

StatementSync::StatementSync(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<StatementSync>(info) {
  // Constructor - initialization happens in InitStatement
}

void StatementSync::InitStatement(DatabaseSync* database, const std::string& sql) {
  database_ = database;
  source_sql_ = sql;
  
  // Prepare the statement
  const char* tail = nullptr;
  int result = sqlite3_prepare_v2(database->connection(), sql.c_str(), -1, &statement_, &tail);
  
  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(database->connection());
    throw std::runtime_error("Failed to prepare statement: " + error);
  }
}

StatementSync::~StatementSync() {
  if (statement_ && !finalized_) {
    sqlite3_finalize(statement_);
  }
}

Napi::Value StatementSync::Run(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }
  
  try {
    Reset();
    BindParameters(info);
    
    int result = sqlite3_step(statement_);
    
    if (result != SQLITE_DONE && result != SQLITE_ROW) {
      std::string error = sqlite3_errmsg(database_->connection());
      node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
      return env.Undefined();
    }
    
    // Create result object
    Napi::Object result_obj = Napi::Object::New(env);
    result_obj.Set("changes", Napi::Number::New(env, sqlite3_changes(database_->connection())));
    
    sqlite3_int64 last_rowid = sqlite3_last_insert_rowid(database_->connection());
    if (last_rowid > 2147483647LL) {
      result_obj.Set("lastInsertRowid", Napi::BigInt::New(env, static_cast<uint64_t>(last_rowid)));
    } else {
      result_obj.Set("lastInsertRowid", Napi::Number::New(env, static_cast<int32_t>(last_rowid)));
    }
    
    return result_obj;
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::Get(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }
  
  try {
    Reset();
    BindParameters(info);
    
    int result = sqlite3_step(statement_);
    
    if (result == SQLITE_ROW) {
      return CreateResult();
    } else if (result == SQLITE_DONE) {
      return env.Undefined();
    } else {
      std::string error = sqlite3_errmsg(database_->connection());
      node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
      return env.Undefined();
    }
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::All(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }
  
  try {
    Reset();
    BindParameters(info);
    
    Napi::Array results = Napi::Array::New(env);
    uint32_t index = 0;
    
    while (true) {
      int result = sqlite3_step(statement_);
      
      if (result == SQLITE_ROW) {
        results.Set(index++, CreateResult());
      } else if (result == SQLITE_DONE) {
        break;
      } else {
        std::string error = sqlite3_errmsg(database_->connection());
        node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
        return env.Undefined();
      }
    }
    
    return results;
  } catch (const std::exception& e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::Iterate(const Napi::CallbackInfo& info) {
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "statement has been finalized");
    return info.Env().Undefined();
  }
  
  // Reset the statement first
  int r = sqlite3_reset(statement_);
  if (r != SQLITE_OK) {
    node::THROW_ERR_SQLITE_ERROR(info.Env(), sqlite3_errmsg(database_->connection()));
    return info.Env().Undefined();
  }
  
  // Bind parameters if provided
  BindParameters(info, 0);
  
  // Create and return iterator
  return StatementSyncIterator::Create(info.Env(), this);
}

Napi::Value StatementSync::FinalizeStatement(const Napi::CallbackInfo& info) {
  if (statement_ && !finalized_) {
    sqlite3_finalize(statement_);
    statement_ = nullptr;
    finalized_ = true;
  }
  return info.Env().Undefined();
}

Napi::Value StatementSync::SourceSQLGetter(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), source_sql_);
}

Napi::Value StatementSync::ExpandedSQLGetter(const Napi::CallbackInfo& info) {
  if (statement_) {
    char* expanded = sqlite3_expanded_sql(statement_);
    if (expanded) {
      Napi::String result = Napi::String::New(info.Env(), expanded);
      sqlite3_free(expanded);
      return result;
    }
  }
  return info.Env().Undefined();
}

void StatementSync::BindParameters(const Napi::CallbackInfo& info, size_t start_index) {
  for (size_t i = start_index; i < info.Length(); i++) {
    Napi::Value param = info[i];
    int param_index = static_cast<int>(i - start_index + 1);
    
    if (param.IsNull() || param.IsUndefined()) {
      sqlite3_bind_null(statement_, param_index);
    } else if (param.IsBigInt()) {
      // Handle BigInt before IsNumber since BigInt values should bind as int64
      bool lossless;
      int64_t bigint_val = param.As<Napi::BigInt>().Int64Value(&lossless);
      if (lossless) {
        sqlite3_bind_int64(statement_, param_index, static_cast<sqlite3_int64>(bigint_val));
      } else {
        // BigInt too large, convert to text
        std::string bigint_str = param.As<Napi::BigInt>().ToString().Utf8Value();
        sqlite3_bind_text(statement_, param_index, bigint_str.c_str(), -1, SQLITE_TRANSIENT);
      }
    } else if (param.IsNumber()) {
      double val = param.As<Napi::Number>().DoubleValue();
      if (val == std::floor(val) && val >= INT32_MIN && val <= INT32_MAX) {
        sqlite3_bind_int(statement_, param_index, param.As<Napi::Number>().Int32Value());
      } else {
        sqlite3_bind_double(statement_, param_index, param.As<Napi::Number>().DoubleValue());
      }
    } else if (param.IsString()) {
      std::string str = param.As<Napi::String>().Utf8Value();
      sqlite3_bind_text(statement_, param_index, str.c_str(), -1, SQLITE_TRANSIENT);
    } else if (param.IsBoolean()) {
      sqlite3_bind_int(statement_, param_index, param.As<Napi::Boolean>().Value() ? 1 : 0);
    } else if (param.IsBuffer()) {
      Napi::Buffer<uint8_t> buffer = param.As<Napi::Buffer<uint8_t>>();
      sqlite3_bind_blob(statement_, param_index, buffer.Data(), static_cast<int>(buffer.Length()), SQLITE_TRANSIENT);
    }
  }
}

Napi::Value StatementSync::CreateResult() {
  Napi::Env env = Env();
  int column_count = sqlite3_column_count(statement_);
  Napi::Object result = Napi::Object::New(env);
  
  for (int i = 0; i < column_count; i++) {
    const char* column_name = sqlite3_column_name(statement_, i);
    int column_type = sqlite3_column_type(statement_, i);
    
    Napi::Value value;
    
    switch (column_type) {
      case SQLITE_NULL:
        value = env.Null();
        break;
      case SQLITE_INTEGER: {
        sqlite3_int64 int_val = sqlite3_column_int64(statement_, i);
        if (int_val > 2147483647LL || int_val < -2147483648LL) {
          value = Napi::BigInt::New(env, static_cast<int64_t>(int_val));
        } else {
          value = Napi::Number::New(env, static_cast<int32_t>(int_val));
        }
        break;
      }
      case SQLITE_FLOAT:
        value = Napi::Number::New(env, sqlite3_column_double(statement_, i));
        break;
      case SQLITE_TEXT: {
        const unsigned char* text = sqlite3_column_text(statement_, i);
        value = Napi::String::New(env, reinterpret_cast<const char*>(text));
        break;
      }
      case SQLITE_BLOB: {
        const void* blob_data = sqlite3_column_blob(statement_, i);
        int blob_size = sqlite3_column_bytes(statement_, i);
        value = Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(blob_data), blob_size);
        break;
      }
      default:
        value = env.Null();
        break;
    }
    
    result.Set(column_name, value);
  }
  
  return result;
}

void StatementSync::Reset() {
  sqlite3_reset(statement_);
  sqlite3_clear_bindings(statement_);
}

// ================================
// StatementSyncIterator Implementation  
// ================================

Napi::FunctionReference StatementSyncIterator::constructor_;

Napi::Object StatementSyncIterator::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "StatementSyncIterator", {
    InstanceMethod("next", &StatementSyncIterator::Next),
    InstanceMethod("return", &StatementSyncIterator::Return)
  });
  
  // Set up Symbol.iterator on the prototype to make it properly iterable
  Napi::Object prototype = func.Get("prototype").As<Napi::Object>();
  Napi::Symbol iteratorSymbol = Napi::Symbol::WellKnown(env, "iterator");
  
  // Add [Symbol.iterator]() { return this; } to make it iterable
  prototype.Set(iteratorSymbol, Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    return info.This();
  }));
  
  constructor_ = Napi::Persistent(func);
  constructor_.SuppressDestruct();
  
  exports.Set("StatementSyncIterator", func);
  return exports;
}

Napi::Object StatementSyncIterator::Create(Napi::Env env, StatementSync* stmt) {
  Napi::Object obj = constructor_.New({});
  StatementSyncIterator* iter = Napi::ObjectWrap<StatementSyncIterator>::Unwrap(obj);
  iter->SetStatement(stmt);
  return obj;
}

StatementSyncIterator::StatementSyncIterator(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<StatementSyncIterator>(info), stmt_(nullptr), done_(false) {
}

StatementSyncIterator::~StatementSyncIterator() {
}

void StatementSyncIterator::SetStatement(StatementSync* stmt) {
  stmt_ = stmt;
  done_ = false;
}

Napi::Value StatementSyncIterator::Next(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!stmt_ || stmt_->finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }
  
  if (done_) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("done", true);
    result.Set("value", env.Null());
    return result;
  }
  
  int r = sqlite3_step(stmt_->statement_);
  
  if (r != SQLITE_ROW) {
    if (r != SQLITE_DONE) {
      node::THROW_ERR_SQLITE_ERROR(env, sqlite3_errmsg(stmt_->database_->connection()));
      return env.Undefined();
    }
    
    // End of results
    sqlite3_reset(stmt_->statement_);
    done_ = true;
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("done", true);
    result.Set("value", env.Null());
    return result;
  }
  
  // Create row object using existing CreateResult method
  Napi::Value row_value = stmt_->CreateResult();
  
  Napi::Object result = Napi::Object::New(env);
  result.Set("done", false);
  result.Set("value", row_value);
  return result;
}

Napi::Value StatementSyncIterator::Return(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (!stmt_ || stmt_->finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }
  
  // Reset the statement and mark as done
  sqlite3_reset(stmt_->statement_);
  done_ = true;
  
  Napi::Object result = Napi::Object::New(env);
  result.Set("done", true);
  result.Set("value", env.Null());
  return result;
}

} // namespace sqlite
} // namespace photostructure