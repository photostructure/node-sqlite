#include "sqlite_impl.h"

#include <algorithm>
#include <cctype>
#include <climits>
#include <cmath>
#include <iostream>

#include "aggregate_function.h"
#include "user_function.h"

namespace photostructure {
namespace sqlite {

// Path validation function implementation
std::optional<std::string> ValidateDatabasePath(Napi::Env env, Napi::Value path,
                                                const std::string &field_name) {
  auto has_null_bytes = [](const std::string &str) {
    return str.find('\0') != std::string::npos;
  };

  if (path.IsString()) {
    std::string location = path.As<Napi::String>().Utf8Value();
    if (!has_null_bytes(location)) {
      return location;
    }
  } else if (path.IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = path.As<Napi::Buffer<uint8_t>>();
    size_t length = buffer.Length();
    const uint8_t *data = buffer.Data();

    // Check for null bytes in buffer
    if (std::find(data, data + length, 0) == data + length) {
      return std::string(reinterpret_cast<const char *>(data), length);
    }
  } else if (path.IsObject()) {
    Napi::Object url = path.As<Napi::Object>();

    // Check if it's a URL object with href property
    if (url.Has("href")) {
      Napi::Value href = url.Get("href");
      if (href.IsString()) {
        std::string location = href.As<Napi::String>().Utf8Value();
        if (!has_null_bytes(location)) {
          // Check if it's a file:// URL
          if (location.compare(0, 7, "file://") == 0) {
            // Convert file:// URL to file path with proper validation
            std::string file_path = location.substr(7);

            // Enhanced URL decoding with security checks
            std::string decoded_path;
            decoded_path.reserve(file_path.length());

            // Maximum path length check (platform-specific, but 4096 is
            // reasonable)
            const size_t MAX_PATH_LENGTH = 4096;
            if (file_path.length() > MAX_PATH_LENGTH) {
              node::THROW_ERR_INVALID_ARG_TYPE(
                  env,
                  ("The \"" + field_name + "\" path is too long.").c_str());
              return std::nullopt;
            }

            // URL decode with multiple passes to prevent double-encoding bypass
            int decode_passes = 0;
            const int MAX_DECODE_PASSES = 5; // Prevent infinite decoding loops
            std::string current_path = file_path;
            std::string next_path;

            while (decode_passes < MAX_DECODE_PASSES) {
              bool found_encoding = false;
              next_path.clear();
              next_path.reserve(current_path.length());

              for (size_t i = 0; i < current_path.length(); ++i) {
                if (current_path[i] == '%' && i + 2 < current_path.length()) {
                  // Validate hex characters
                  if (std::isxdigit(current_path[i + 1]) &&
                      std::isxdigit(current_path[i + 2])) {
                    char hex_str[3] = {current_path[i + 1], current_path[i + 2],
                                       '\0'};
                    long val = std::strtol(hex_str, nullptr, 16);

                    // Special handling for control characters and dangerous
                    // sequences
                    if (val == 0) {
                      node::THROW_ERR_INVALID_ARG_TYPE(
                          env, ("The \"" + field_name +
                                "\" contains encoded null bytes.")
                                   .c_str());
                      return std::nullopt;
                    }

                    next_path += static_cast<char>(val);
                    i += 2;
                    found_encoding = true;
                  } else {
                    // Invalid hex sequence, reject
                    node::THROW_ERR_INVALID_ARG_TYPE(
                        env, ("The \"" + field_name +
                              "\" contains invalid percent encoding.")
                                 .c_str());
                    return std::nullopt;
                  }
                } else {
                  next_path += current_path[i];
                }
              }

              if (!found_encoding) {
                decoded_path = current_path;
                break;
              }

              current_path = next_path;
              decode_passes++;
            }

            if (decode_passes >= MAX_DECODE_PASSES) {
              node::THROW_ERR_INVALID_ARG_TYPE(
                  env, ("The \"" + field_name +
                        "\" contains too many levels of percent encoding.")
                           .c_str());
              return std::nullopt;
            }

            // Security: Check for null bytes after all decoding
            if (has_null_bytes(decoded_path)) {
              node::THROW_ERR_INVALID_ARG_TYPE(
                  env, ("The \"" + field_name +
                        "\" argument contains null bytes after URL decoding.")
                           .c_str());
              return std::nullopt;
            }

            // Security: Normalize path components to detect traversal attempts
            // This includes various representations of ".."
            std::vector<std::string> dangerous_patterns = {
                "..", "/..", "../", "\\..", "..\\",
                // Windows alternate stream syntax (but allow single colon for
                // drive letters)
                "::", "::$",
                // Zero-width characters that might hide dangerous sequences
                "\u200B", "\u200C", "\u200D", "\uFEFF"};

            // Check each component after splitting by directory separators
            std::string normalized_path = decoded_path;
            std::replace(normalized_path.begin(), normalized_path.end(), '\\',
                         '/');

            // Split path and check each component
            size_t start = 0;
            size_t end = normalized_path.find('/');

            while (end != std::string::npos) {
              std::string component =
                  normalized_path.substr(start, end - start);

              // Check for dangerous patterns in component
              if (component == "..") {
                // Always reject ..
                node::THROW_ERR_INVALID_ARG_TYPE(
                    env, ("The \"" + field_name +
                          "\" argument contains path traversal sequences.")
                             .c_str());
                return std::nullopt;
              }

              // Check for other dangerous patterns
              for (const auto &pattern : dangerous_patterns) {
                if (component.find(pattern) != std::string::npos) {
                  node::THROW_ERR_INVALID_ARG_TYPE(
                      env, ("The \"" + field_name +
                            "\" argument contains dangerous sequences.")
                               .c_str());
                  return std::nullopt;
                }
              }

              start = end + 1;
              end = normalized_path.find('/', start);
            }

            // Check last component
            if (start < normalized_path.length()) {
              std::string component = normalized_path.substr(start);
              if (component == "..") {
                // Always reject ..
                node::THROW_ERR_INVALID_ARG_TYPE(
                    env, ("The \"" + field_name +
                          "\" argument contains path traversal sequences.")
                             .c_str());
                return std::nullopt;
              }

              // Check for other dangerous patterns
              for (const auto &pattern : dangerous_patterns) {
                if (component.find(pattern) != std::string::npos) {
                  node::THROW_ERR_INVALID_ARG_TYPE(
                      env, ("The \"" + field_name +
                            "\" argument contains dangerous sequences.")
                               .c_str());
                  return std::nullopt;
                }
              }
            }

            return decoded_path;
          } else {
            node::THROW_ERR_INVALID_URL_SCHEME(env);
            return std::nullopt;
          }
        }
      }
    }
  }

  node::THROW_ERR_INVALID_ARG_TYPE(env, ("The \"" + field_name +
                                         "\" argument must be a string, "
                                         "Buffer, or URL without null bytes.")
                                            .c_str());
  return std::nullopt;
}

// Note: Static constructors removed to fix worker thread issues
// Constructors are now stored in per-instance AddonData

// Forward declarations for addon data access
extern AddonData *GetAddonData(napi_env env);

// DatabaseSync Implementation
Napi::Object DatabaseSync::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "DatabaseSync",
      {InstanceMethod("open", &DatabaseSync::Open),
       InstanceMethod("close", &DatabaseSync::Close),
       InstanceMethod("prepare", &DatabaseSync::Prepare),
       InstanceMethod("exec", &DatabaseSync::Exec),
       InstanceMethod("function", &DatabaseSync::CustomFunction),
       InstanceMethod("aggregate", &DatabaseSync::AggregateFunction),
       InstanceMethod("enableLoadExtension",
                      &DatabaseSync::EnableLoadExtension),
       InstanceMethod("loadExtension", &DatabaseSync::LoadExtension),
       InstanceMethod("createSession", &DatabaseSync::CreateSession),
       InstanceMethod("applyChangeset", &DatabaseSync::ApplyChangeset),
       InstanceMethod("backup", &DatabaseSync::Backup),
       InstanceMethod("location", &DatabaseSync::LocationMethod),
       InstanceAccessor("isOpen", &DatabaseSync::IsOpenGetter, nullptr),
       InstanceAccessor("isTransaction", &DatabaseSync::IsTransactionGetter,
                        nullptr)});

  // Store constructor in per-instance addon data instead of static variable
  AddonData *addon_data = GetAddonData(env);
  if (addon_data) {
    addon_data->databaseSyncConstructor =
        Napi::Reference<Napi::Function>::New(func);
  }

  exports.Set("DatabaseSync", func);
  return exports;
}

DatabaseSync::DatabaseSync(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<DatabaseSync>(info),
      creation_thread_(std::this_thread::get_id()), env_(info.Env()) {
  // Register this instance for cleanup tracking
  RegisterDatabaseInstance(info.Env(), this);

  // If no arguments, create but don't open (for manual open() call)
  if (info.Length() == 0) {
    return;
  }

  // Validate and extract the database path
  std::optional<std::string> location =
      ValidateDatabasePath(info.Env(), info[0], "path");
  if (!location.has_value()) {
    return; // Error already thrown by ValidateDatabasePath
  }

  try {
    DatabaseOpenConfiguration config(std::move(location.value()));

    // Handle options object if provided as second argument
    if (info.Length() > 1 && info[1].IsObject()) {
      Napi::Object options = info[1].As<Napi::Object>();

      if (options.Has("readOnly") && options.Get("readOnly").IsBoolean()) {
        config.set_read_only(
            options.Get("readOnly").As<Napi::Boolean>().Value());
      }

      // Support both old and new naming for backwards compatibility
      if (options.Has("enableForeignKeyConstraints") &&
          options.Get("enableForeignKeyConstraints").IsBoolean()) {
        config.set_enable_foreign_keys(
            options.Get("enableForeignKeyConstraints")
                .As<Napi::Boolean>()
                .Value());
      } else if (options.Has("enableForeignKeys") &&
                 options.Get("enableForeignKeys").IsBoolean()) {
        config.set_enable_foreign_keys(
            options.Get("enableForeignKeys").As<Napi::Boolean>().Value());
      }

      if (options.Has("timeout") && options.Get("timeout").IsNumber()) {
        config.set_timeout(
            options.Get("timeout").As<Napi::Number>().Int32Value());
      }

      if (options.Has("enableDoubleQuotedStringLiterals") &&
          options.Get("enableDoubleQuotedStringLiterals").IsBoolean()) {
        config.set_enable_dqs(options.Get("enableDoubleQuotedStringLiterals")
                                  .As<Napi::Boolean>()
                                  .Value());
      }

      if (options.Has("allowExtension") &&
          options.Get("allowExtension").IsBoolean()) {
        allow_load_extension_ =
            options.Get("allowExtension").As<Napi::Boolean>().Value();
      }
    }

    InternalOpen(config);
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(info.Env(), e.what());
  }
}

DatabaseSync::~DatabaseSync() {
  // Unregister this instance
  UnregisterDatabaseInstance(env_, this);

  if (connection_) {
    InternalClose();
  }
}

Napi::Value DatabaseSync::Open(const Napi::CallbackInfo &info) {
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
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "Configuration must have location string");
    return env.Undefined();
  }

  std::string location =
      config_obj.Get("location").As<Napi::String>().Utf8Value();
  DatabaseOpenConfiguration config(std::move(location));

  // Parse other options
  if (config_obj.Has("readOnly") && config_obj.Get("readOnly").IsBoolean()) {
    config.set_read_only(
        config_obj.Get("readOnly").As<Napi::Boolean>().Value());
  }

  // Support both old and new naming for backwards compatibility
  if (config_obj.Has("enableForeignKeyConstraints") &&
      config_obj.Get("enableForeignKeyConstraints").IsBoolean()) {
    config.set_enable_foreign_keys(config_obj.Get("enableForeignKeyConstraints")
                                       .As<Napi::Boolean>()
                                       .Value());
  } else if (config_obj.Has("enableForeignKeys") &&
             config_obj.Get("enableForeignKeys").IsBoolean()) {
    config.set_enable_foreign_keys(
        config_obj.Get("enableForeignKeys").As<Napi::Boolean>().Value());
  }

  if (config_obj.Has("timeout") && config_obj.Get("timeout").IsNumber()) {
    config.set_timeout(
        config_obj.Get("timeout").As<Napi::Number>().Int32Value());
  }

  if (config_obj.Has("enableDoubleQuotedStringLiterals") &&
      config_obj.Get("enableDoubleQuotedStringLiterals").IsBoolean()) {
    config.set_enable_dqs(config_obj.Get("enableDoubleQuotedStringLiterals")
                              .As<Napi::Boolean>()
                              .Value());
  }

  if (config_obj.Has("allowExtension") &&
      config_obj.Get("allowExtension").IsBoolean()) {
    allow_load_extension_ =
        config_obj.Get("allowExtension").As<Napi::Boolean>().Value();
  }

  try {
    InternalOpen(config);
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::Close(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  try {
    InternalClose();
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::Prepare(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

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
    // Create new StatementSync instance using addon data constructor
    AddonData *addon_data = GetAddonData(env);
    if (!addon_data || addon_data->statementSyncConstructor.IsEmpty()) {
      node::THROW_ERR_INVALID_STATE(
          env, "StatementSync constructor not initialized");
      return env.Undefined();
    }
    Napi::Object stmt_obj =
        addon_data->statementSyncConstructor.New({}).As<Napi::Object>();

    // Initialize the statement
    StatementSync *stmt = StatementSync::Unwrap(stmt_obj);
    stmt->InitStatement(this, sql);

    return stmt_obj;
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value DatabaseSync::Exec(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env, "Expected SQL string");
    return env.Undefined();
  }

  std::string sql = info[0].As<Napi::String>().Utf8Value();

  char *error_msg = nullptr;
  int result =
      sqlite3_exec(connection(), sql.c_str(), nullptr, nullptr, &error_msg);

  if (result != SQLITE_OK) {
    std::string error = error_msg ? error_msg : "Unknown SQLite error";
    if (error_msg)
      sqlite3_free(error_msg);
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::LocationMethod(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  // Default to "main" if no dbName provided
  std::string db_name = "main";
  if (info.Length() > 0 && info[0].IsString()) {
    db_name = info[0].As<Napi::String>().Utf8Value();
  }

  // Use sqlite3_db_filename() to get the database file path
  const char *filename = sqlite3_db_filename(connection(), db_name.c_str());

  // Return null for in-memory databases, non-existent databases, or if database
  // not found
  if (filename == nullptr || strlen(filename) == 0) {
    return env.Null();
  }

  return Napi::String::New(env, filename);
}

Napi::Value DatabaseSync::IsOpenGetter(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), IsOpen());
}

Napi::Value DatabaseSync::IsTransactionGetter(const Napi::CallbackInfo &info) {
  // Check if we're in a transaction
  bool in_transaction = IsOpen() && !sqlite3_get_autocommit(connection());
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
    sqlite3_exec(connection(), "PRAGMA foreign_keys = ON", nullptr, nullptr,
                 nullptr);
  }

  if (config.get_timeout() > 0) {
    sqlite3_busy_timeout(connection(), config.get_timeout());
  }

  // Configure double-quoted string literals
  if (config.get_enable_dqs()) {
    int dqs_enable = 1;
    result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DQS_DML,
                               dqs_enable, nullptr);
    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(connection());
      sqlite3_close(connection_);
      connection_ = nullptr;
      throw std::runtime_error("Failed to configure DQS_DML: " + error);
    }

    result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DQS_DDL,
                               dqs_enable, nullptr);
    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(connection());
      sqlite3_close(connection_);
      connection_ = nullptr;
      throw std::runtime_error("Failed to configure DQS_DDL: " + error);
    }
  }
}

void DatabaseSync::InternalClose() {
  if (connection_) {
    // Finalize all prepared statements
    prepared_statements_.clear();

    // Delete all sessions before closing the database
    // This is required by SQLite to avoid undefined behavior
    DeleteAllSessions();

    // Close the database connection
    int result = sqlite3_close(connection_);
    if (result != SQLITE_OK) {
      // Force close even if there are outstanding statements
      sqlite3_close_v2(connection_);
    }
    connection_ = nullptr;
  }
  location_.clear();
  enable_load_extension_ = false;
}

Napi::Value DatabaseSync::CustomFunction(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  if (info.Length() < 2) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "Expected at least 2 arguments: name and function");
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

    if (options.Has("useBigIntArguments") &&
        options.Get("useBigIntArguments").IsBoolean()) {
      use_bigint_args =
          options.Get("useBigIntArguments").As<Napi::Boolean>().Value();
    }

    if (options.Has("varargs") && options.Get("varargs").IsBoolean()) {
      varargs = options.Get("varargs").As<Napi::Boolean>().Value();
    }

    if (options.Has("deterministic") &&
        options.Get("deterministic").IsBoolean()) {
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
  UserDefinedFunction *user_data =
      new UserDefinedFunction(env, fn, this, use_bigint_args);

  // Set SQLite flags
  int flags = SQLITE_UTF8;
  if (deterministic) {
    flags |= SQLITE_DETERMINISTIC;
  }
  if (direct_only) {
    flags |= SQLITE_DIRECTONLY;
  }

  // Register with SQLite
  int result =
      sqlite3_create_function_v2(connection(), name.c_str(), argc, flags,
                                 user_data, UserDefinedFunction::xFunc,
                                 nullptr, // No aggregate step
                                 nullptr, // No aggregate final
                                 UserDefinedFunction::xDestroy);

  if (result != SQLITE_OK) {
    delete user_data; // Clean up on failure
    std::string error = "Failed to create function: ";
    error += sqlite3_errmsg(connection());
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::AggregateFunction(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  if (info.Length() < 2) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "Expected at least 2 arguments: name and options");
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
  if (options.Has("useBigIntArguments") &&
      options.Get("useBigIntArguments").IsBoolean()) {
    use_bigint_args =
        options.Get("useBigIntArguments").As<Napi::Boolean>().Value();
  }

  bool varargs = false;
  if (options.Has("varargs") && options.Get("varargs").IsBoolean()) {
    varargs = options.Get("varargs").As<Napi::Boolean>().Value();
  }

  bool deterministic = false;
  if (options.Has("deterministic") &&
      options.Get("deterministic").IsBoolean()) {
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
  CustomAggregate *user_data;
  try {
    user_data = new CustomAggregate(env, this, use_bigint_args, start, step_fn,
                                    inverse_fn, result_fn);
  } catch (const std::exception &e) {
    std::string error = "Failed to create CustomAggregate: ";
    error += e.what();
    node::THROW_ERR_INVALID_ARG_VALUE(env, error.c_str());
    return env.Undefined();
  }

  // Register with SQLite - Node.js always uses sqlite3_create_window_function
  // for aggregates
  auto xInverse = !inverse_fn.IsEmpty() ? CustomAggregate::xInverse : nullptr;
  auto xValue = xInverse ? CustomAggregate::xValue : nullptr;
  int result = sqlite3_create_window_function(
      connection(), name.c_str(), argc, flags, user_data,
      CustomAggregate::xStep, CustomAggregate::xFinal, xValue, xInverse,
      CustomAggregate::xDestroy);

  if (result != SQLITE_OK) {
    delete user_data; // Clean up on failure
    std::string error = "Failed to create aggregate function '";
    error += name;
    error += "': ";
    error += sqlite3_errmsg(connection());
    error += " (SQLite error code: ";
    error += std::to_string(result);
    error += ")";
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::EnableLoadExtension(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"allow\" argument must be a boolean.");
    return env.Undefined();
  }

  bool enable = info[0].As<Napi::Boolean>().Value();

  // Check if extension loading was disallowed at database creation
  if (!allow_load_extension_ && enable) {
    node::THROW_ERR_INVALID_STATE(env,
                                  "Cannot enable extension loading because it "
                                  "was disabled at database creation.");
    return env.Undefined();
  }

  enable_load_extension_ = enable;

  // Configure SQLite to enable/disable extension loading
  int result =
      sqlite3_db_config(connection(), SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION,
                        enable ? 1 : 0, nullptr);

  if (result != SQLITE_OK) {
    std::string error = "Failed to configure extension loading: ";
    error += sqlite3_errmsg(connection());
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::LoadExtension(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database is not open");
    return env.Undefined();
  }

  if (!allow_load_extension_) {
    node::THROW_ERR_INVALID_STATE(env, "Extension loading is not allowed");
    return env.Undefined();
  }

  if (!enable_load_extension_) {
    node::THROW_ERR_INVALID_STATE(env, "Extension loading is not enabled");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "The \"path\" argument must be a string.");
    return env.Undefined();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();

  // Optional entry point parameter
  const char *entry_point = nullptr;
  std::string entry_point_str;
  if (info.Length() > 1 && info[1].IsString()) {
    entry_point_str = info[1].As<Napi::String>().Utf8Value();
    entry_point = entry_point_str.c_str();
  }

  // Load the extension
  char *errmsg = nullptr;
  int result =
      sqlite3_load_extension(connection(), path.c_str(), entry_point, &errmsg);

  if (result != SQLITE_OK) {
    std::string error = "Failed to load extension '";
    error += path;
    error += "': ";
    if (errmsg) {
      error += errmsg;
      sqlite3_free(errmsg);
    } else {
      error += sqlite3_errmsg(connection());
    }
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::CreateSession(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  std::string table;
  std::string db_name = "main";

  // Parse options if provided
  if (info.Length() > 0) {
    if (!info[0].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }

    Napi::Object options = info[0].As<Napi::Object>();

    // Get table option
    if (options.Has("table")) {
      Napi::Value table_value = options.Get("table");
      if (table_value.IsString()) {
        table = table_value.As<Napi::String>().Utf8Value();
      } else {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.table\" argument must be a string.");
        return env.Undefined();
      }
    }

    // Get db option
    if (options.Has("db")) {
      Napi::Value db_value = options.Get("db");
      if (db_value.IsString()) {
        db_name = db_value.As<Napi::String>().Utf8Value();
      } else {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.db\" argument must be a string.");
        return env.Undefined();
      }
    }
  }

  // Create the session
  sqlite3_session *pSession;
  int r = sqlite3session_create(connection(), db_name.c_str(), &pSession);

  if (r != SQLITE_OK) {
    std::string error = "Failed to create session: ";
    error += sqlite3_errmsg(connection());
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
    return env.Undefined();
  }

  // Attach table if specified
  r = sqlite3session_attach(pSession, table.empty() ? nullptr : table.c_str());

  if (r != SQLITE_OK) {
    sqlite3session_delete(pSession);
    std::string error = "Failed to attach table to session: ";
    error += sqlite3_errmsg(connection());
    node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
    return env.Undefined();
  }

  // Create and return the Session object
  return Session::Create(env, this, pSession);
}

void DatabaseSync::AddSession(Session *session) {
  std::lock_guard<std::mutex> lock(sessions_mutex_);
  sessions_.insert(session);
}

void DatabaseSync::RemoveSession(Session *session) {
  std::lock_guard<std::mutex> lock(sessions_mutex_);
  sessions_.erase(session);
}

void DatabaseSync::DeleteAllSessions() {
  std::lock_guard<std::mutex> lock(sessions_mutex_);
  // Copy the set to avoid iterator invalidation
  std::set<Session *> sessions_copy = sessions_;
  sessions_.clear(); // Clear first to prevent re-entrance

  // Now delete each session
  for (auto *session : sessions_copy) {
    // Direct SQLite cleanup since we're in database destruction
    if (session->GetSession()) {
      sqlite3session_delete(session->GetSession());
      // Clear the session's internal pointers
      session->session_ = nullptr;
      session->database_ = nullptr;
    }
  }
}

// Context structure for changeset callbacks to avoid global state
struct ChangesetCallbacks {
  std::function<int(int)> conflictCallback;
  std::function<bool(std::string)> filterCallback;
  Napi::Env env;
};

static int xConflict(void *pCtx, int eConflict, sqlite3_changeset_iter *pIter) {
  if (!pCtx)
    return SQLITE_CHANGESET_OMIT;
  ChangesetCallbacks *callbacks = static_cast<ChangesetCallbacks *>(pCtx);
  if (!callbacks->conflictCallback)
    return SQLITE_CHANGESET_OMIT;
  return callbacks->conflictCallback(eConflict);
}

static int xFilter(void *pCtx, const char *zTab) {
  if (!pCtx)
    return 1;
  ChangesetCallbacks *callbacks = static_cast<ChangesetCallbacks *>(pCtx);
  if (!callbacks->filterCallback)
    return 1;
  return callbacks->filterCallback(zTab) ? 1 : 0;
}

Napi::Value DatabaseSync::ApplyChangeset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"changeset\" argument must be a Buffer.");
    return env.Undefined();
  }

  // Create callback context to avoid global state
  ChangesetCallbacks callbacks{nullptr, nullptr, env};

  // Parse options if provided
  if (info.Length() > 1 && !info[1].IsUndefined()) {
    if (!info[1].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }

    Napi::Object options = info[1].As<Napi::Object>();

    // Handle onConflict callback
    if (options.Has("onConflict")) {
      Napi::Value conflictValue = options.Get("onConflict");
      if (!conflictValue.IsUndefined()) {
        if (!conflictValue.IsFunction()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              env, "The \"options.onConflict\" argument must be a function.");
          return env.Undefined();
        }

        Napi::Function conflictFunc = conflictValue.As<Napi::Function>();
        callbacks.conflictCallback = [env,
                                      conflictFunc](int conflictType) -> int {
          Napi::HandleScope scope(env);
          Napi::Value result =
              conflictFunc.Call({Napi::Number::New(env, conflictType)});

          if (env.IsExceptionPending()) {
            // If callback threw, abort the changeset apply
            return SQLITE_CHANGESET_ABORT;
          }

          if (!result.IsNumber()) {
            return -1; // Invalid value
          }

          return result.As<Napi::Number>().Int32Value();
        };
      }
    }

    // Handle filter callback
    if (options.Has("filter")) {
      Napi::Value filterValue = options.Get("filter");
      if (!filterValue.IsFunction()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.filter\" argument must be a function.");
        return env.Undefined();
      }

      Napi::Function filterFunc = filterValue.As<Napi::Function>();
      callbacks.filterCallback = [env,
                                  filterFunc](std::string tableName) -> bool {
        Napi::HandleScope scope(env);
        Napi::Value result =
            filterFunc.Call({Napi::String::New(env, tableName)});

        if (env.IsExceptionPending()) {
          // If callback threw, exclude the table
          return false;
        }

        return result.ToBoolean().Value();
      };
    }
  }

  // Get the changeset buffer
  Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();

  // Apply the changeset with context instead of global state
  int r = sqlite3changeset_apply(connection(), buffer.Length(), buffer.Data(),
                                 xFilter, xConflict, &callbacks);

  if (r == SQLITE_OK) {
    return Napi::Boolean::New(env, true);
  }

  if (r == SQLITE_ABORT) {
    // Not an error, just means the operation was aborted
    return Napi::Boolean::New(env, false);
  }

  // Other errors
  std::string error = "Failed to apply changeset: ";
  error += sqlite3_errmsg(connection());
  node::THROW_ERR_SQLITE_ERROR(env, error.c_str());
  return env.Undefined();
}

// StatementSync Implementation
Napi::Object StatementSync::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "StatementSync",
      {InstanceMethod("run", &StatementSync::Run),
       InstanceMethod("get", &StatementSync::Get),
       InstanceMethod("all", &StatementSync::All),
       InstanceMethod("iterate", &StatementSync::Iterate),
       InstanceMethod("finalize", &StatementSync::FinalizeStatement),
       InstanceMethod("setReadBigInts", &StatementSync::SetReadBigInts),
       InstanceMethod("setReturnArrays", &StatementSync::SetReturnArrays),
       InstanceMethod("setAllowBareNamedParameters",
                      &StatementSync::SetAllowBareNamedParameters),
       InstanceMethod("columns", &StatementSync::Columns),
       InstanceAccessor("sourceSQL", &StatementSync::SourceSQLGetter, nullptr),
       InstanceAccessor("expandedSQL", &StatementSync::ExpandedSQLGetter,
                        nullptr)});

  // Store constructor in per-instance addon data instead of static variable
  AddonData *addon_data = GetAddonData(env);
  if (addon_data) {
    addon_data->statementSyncConstructor =
        Napi::Reference<Napi::Function>::New(func);
  }

  exports.Set("StatementSync", func);
  return exports;
}

StatementSync::StatementSync(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<StatementSync>(info),
      creation_thread_(std::this_thread::get_id()) {
  // Constructor - initialization happens in InitStatement
}

void StatementSync::InitStatement(DatabaseSync *database,
                                  const std::string &sql) {
  if (!database || !database->IsOpen()) {
    throw std::runtime_error("Database is not open");
  }

  database_ = database;
  source_sql_ = sql;

  // Prepare the statement
  const char *tail = nullptr;
  int result = sqlite3_prepare_v2(database->connection(), sql.c_str(), -1,
                                  &statement_, &tail);

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

Napi::Value StatementSync::Run(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
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
    result_obj.Set(
        "changes",
        Napi::Number::New(env, sqlite3_changes(database_->connection())));

    sqlite3_int64 last_rowid =
        sqlite3_last_insert_rowid(database_->connection());
    if (last_rowid > 2147483647LL) {
      result_obj.Set("lastInsertRowid",
                     Napi::BigInt::New(env, static_cast<uint64_t>(last_rowid)));
    } else {
      result_obj.Set("lastInsertRowid",
                     Napi::Number::New(env, static_cast<int32_t>(last_rowid)));
    }

    return result_obj;
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::Get(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
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
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::All(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
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
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::Iterate(const Napi::CallbackInfo &info) {
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "statement has been finalized");
    return info.Env().Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "Database connection is closed");
    return info.Env().Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(info.Env(),
                                  "Statement is not properly initialized");
    return info.Env().Undefined();
  }

  // Reset the statement first
  int r = sqlite3_reset(statement_);
  if (r != SQLITE_OK) {
    node::THROW_ERR_SQLITE_ERROR(info.Env(),
                                 sqlite3_errmsg(database_->connection()));
    return info.Env().Undefined();
  }

  // Bind parameters if provided
  BindParameters(info, 0);

  // Create and return iterator
  return StatementSyncIterator::Create(info.Env(), this);
}

Napi::Value StatementSync::FinalizeStatement(const Napi::CallbackInfo &info) {
  if (statement_ && !finalized_) {
    // It's safe to finalize even if database is closed
    // SQLite handles this gracefully
    sqlite3_finalize(statement_);
    statement_ = nullptr;
    finalized_ = true;
  }
  return info.Env().Undefined();
}

Napi::Value StatementSync::SourceSQLGetter(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), source_sql_);
}

Napi::Value StatementSync::ExpandedSQLGetter(const Napi::CallbackInfo &info) {
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "Statement has been finalized");
    return info.Env().Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "Database connection is closed");
    return info.Env().Undefined();
  }

  if (statement_) {
    char *expanded = sqlite3_expanded_sql(statement_);
    if (expanded) {
      Napi::String result = Napi::String::New(info.Env(), expanded);
      sqlite3_free(expanded);
      return result;
    }
  }
  return info.Env().Undefined();
}

Napi::Value StatementSync::SetReadBigInts(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "The statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"readBigInts\" argument must be a boolean.");
    return env.Undefined();
  }

  use_big_ints_ = info[0].As<Napi::Boolean>().Value();
  return env.Undefined();
}

Napi::Value StatementSync::SetReturnArrays(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "The statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"returnArrays\" argument must be a boolean.");
    return env.Undefined();
  }

  return_arrays_ = info[0].As<Napi::Boolean>().Value();
  return env.Undefined();
}

Napi::Value
StatementSync::SetAllowBareNamedParameters(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "The statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"allowBareNamedParameters\" argument must be a boolean.");
    return env.Undefined();
  }

  allow_bare_named_params_ = info[0].As<Napi::Boolean>().Value();
  return env.Undefined();
}

Napi::Value StatementSync::Columns(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "The statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return env.Undefined();
  }

  int column_count = sqlite3_column_count(statement_);
  Napi::Array columns = Napi::Array::New(env, column_count);

  for (int i = 0; i < column_count; i++) {
    Napi::Object column_info = Napi::Object::New(env);

    // column: The original column name (sqlite3_column_origin_name)
    const char *origin_name = sqlite3_column_origin_name(statement_, i);
    if (origin_name) {
      column_info.Set("column", Napi::String::New(env, origin_name));
    } else {
      column_info.Set("column", env.Null());
    }

    // database: The database name (sqlite3_column_database_name)
    const char *database_name = sqlite3_column_database_name(statement_, i);
    if (database_name) {
      column_info.Set("database", Napi::String::New(env, database_name));
    } else {
      column_info.Set("database", env.Null());
    }

    // name: The column name/alias (sqlite3_column_name)
    const char *column_name = sqlite3_column_name(statement_, i);
    if (column_name) {
      column_info.Set("name", Napi::String::New(env, column_name));
    } else {
      column_info.Set("name", env.Null());
    }

    // table: The table name (sqlite3_column_table_name)
    const char *table_name = sqlite3_column_table_name(statement_, i);
    if (table_name) {
      column_info.Set("table", Napi::String::New(env, table_name));
    } else {
      column_info.Set("table", env.Null());
    }

    // type: The declared type (sqlite3_column_decltype)
    const char *decl_type = sqlite3_column_decltype(statement_, i);
    if (decl_type) {
      column_info.Set("type", Napi::String::New(env, decl_type));
    } else {
      column_info.Set("type", env.Null());
    }

    columns.Set(i, column_info);
  }

  return columns;
}

void StatementSync::BindParameters(const Napi::CallbackInfo &info,
                                   size_t start_index) {
  Napi::Env env = info.Env();

  // Safety checks
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return;
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return;
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return;
  }

  // Check if we have a single object for named parameters
  if (info.Length() == start_index + 1 && info[start_index].IsObject() &&
      !info[start_index].IsBuffer() && !info[start_index].IsArray()) {
    // Named parameters binding
    Napi::Object obj = info[start_index].As<Napi::Object>();

    // Build bare named params map if needed
    if (allow_bare_named_params_ && !bare_named_params_.has_value()) {
      bare_named_params_.emplace();
      int param_count = sqlite3_bind_parameter_count(statement_);

      // Parameter indexing starts at one
      for (int i = 1; i <= param_count; ++i) {
        const char *name = sqlite3_bind_parameter_name(statement_, i);
        if (name == nullptr) {
          continue;
        }

        std::string bare_name = std::string(name + 1); // Skip the : or $ prefix
        std::string full_name = std::string(name);
        auto insertion = bare_named_params_->insert({bare_name, full_name});

        if (!insertion.second) {
          // Check if the existing mapping is the same
          auto existing_full_name = insertion.first->second;
          if (full_name != existing_full_name) {
            std::string error_msg =
                "Cannot create bare named parameter '" + bare_name +
                "' because of conflicting names '" + existing_full_name +
                "' and '" + full_name + "'.";
            node::THROW_ERR_INVALID_STATE(env, error_msg.c_str());
            return;
          }
        }
      }
    }

    // Bind named parameters
    Napi::Array keys = obj.GetPropertyNames();
    for (uint32_t j = 0; j < keys.Length(); j++) {
      Napi::Value key = keys[j];
      std::string key_str = key.As<Napi::String>().Utf8Value();

      int param_index =
          sqlite3_bind_parameter_index(statement_, key_str.c_str());
      if (param_index == 0 && allow_bare_named_params_ &&
          bare_named_params_.has_value()) {
        // Try to find bare named parameter
        auto lookup = bare_named_params_->find(key_str);
        if (lookup != bare_named_params_->end()) {
          param_index =
              sqlite3_bind_parameter_index(statement_, lookup->second.c_str());
        }
      }

      if (param_index > 0) {
        Napi::Value value = obj.Get(key_str);
        try {
          BindSingleParameter(param_index, value);
        } catch (const Napi::Error &e) {
          // Re-throw with parameter info
          std::string msg =
              "Error binding parameter '" + key_str + "': " + e.Message();
          node::THROW_ERR_INVALID_ARG_VALUE(env, msg.c_str());
          return;
        }
      }
    }
  } else {
    // Positional parameters binding
    for (size_t i = start_index; i < info.Length(); i++) {
      int param_index = static_cast<int>(i - start_index + 1);
      try {
        BindSingleParameter(param_index, info[i]);
      } catch (const Napi::Error &e) {
        // Re-throw with parameter info
        std::string msg = "Error binding parameter " +
                          std::to_string(param_index) + ": " + e.Message();
        node::THROW_ERR_INVALID_ARG_VALUE(env, msg.c_str());
        return;
      }
    }
  }
}

void StatementSync::BindSingleParameter(int param_index, Napi::Value param) {
  // Safety check - statement_ should be valid if we got here
  if (!statement_ || finalized_) {
    return; // Silent return since error was already thrown by caller
  }

  try {
    if (param.IsNull() || param.IsUndefined()) {
      sqlite3_bind_null(statement_, param_index);
    } else if (param.IsBigInt()) {
      // Handle BigInt before IsNumber since BigInt values should bind as int64
      bool lossless;
      int64_t bigint_val = param.As<Napi::BigInt>().Int64Value(&lossless);
      if (lossless) {
        sqlite3_bind_int64(statement_, param_index,
                           static_cast<sqlite3_int64>(bigint_val));
      } else {
        // BigInt too large, convert to text
        std::string bigint_str =
            param.As<Napi::BigInt>().ToString().Utf8Value();
        sqlite3_bind_text(statement_, param_index, bigint_str.c_str(), -1,
                          SQLITE_TRANSIENT);
      }
    } else if (param.IsNumber()) {
      double val = param.As<Napi::Number>().DoubleValue();
      if (val == std::floor(val) && val >= INT32_MIN && val <= INT32_MAX) {
        sqlite3_bind_int(statement_, param_index,
                         param.As<Napi::Number>().Int32Value());
      } else {
        sqlite3_bind_double(statement_, param_index,
                            param.As<Napi::Number>().DoubleValue());
      }
    } else if (param.IsString()) {
      std::string str = param.As<Napi::String>().Utf8Value();
      sqlite3_bind_text(statement_, param_index, str.c_str(), -1,
                        SQLITE_TRANSIENT);
    } else if (param.IsBoolean()) {
      sqlite3_bind_int(statement_, param_index,
                       param.As<Napi::Boolean>().Value() ? 1 : 0);
    } else if (param.IsBuffer()) {
      Napi::Buffer<uint8_t> buffer = param.As<Napi::Buffer<uint8_t>>();
      sqlite3_bind_blob(statement_, param_index, buffer.Data(),
                        static_cast<int>(buffer.Length()), SQLITE_TRANSIENT);
    } else if (param.IsFunction()) {
      // Functions cannot be stored in SQLite - bind as NULL
      sqlite3_bind_null(statement_, param_index);
    } else if (param.IsObject()) {
      // Try to convert object to string
      Napi::String str_value = param.ToString();
      std::string str = str_value.Utf8Value();
      sqlite3_bind_text(statement_, param_index, str.c_str(), -1,
                        SQLITE_TRANSIENT);
    } else {
      // For any other type, bind as NULL
      sqlite3_bind_null(statement_, param_index);
    }
  } catch (const Napi::Error &e) {
    // Re-throw Napi errors
    throw;
  } catch (const std::exception &e) {
    // Convert standard exceptions to Napi errors
    throw Napi::Error::New(Env(), e.what());
  }
}

Napi::Value StatementSync::CreateResult() {
  Napi::Env env = Env();

  // Safety checks
  if (!statement_ || finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  int column_count = sqlite3_column_count(statement_);

  if (return_arrays_) {
    // Return result as array when returnArrays is true
    Napi::Array result = Napi::Array::New(env, column_count);

    for (int i = 0; i < column_count; i++) {
      int column_type = sqlite3_column_type(statement_, i);
      Napi::Value value;

      switch (column_type) {
      case SQLITE_NULL:
        value = env.Null();
        break;
      case SQLITE_INTEGER: {
        sqlite3_int64 int_val = sqlite3_column_int64(statement_, i);
        if (use_big_ints_) {
          // Always return BigInt when readBigInts is true
          value = Napi::BigInt::New(env, static_cast<int64_t>(int_val));
        } else if (int_val > 2147483647LL || int_val < -2147483648LL) {
          // Return BigInt for values outside 32-bit range
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
        const unsigned char *text = sqlite3_column_text(statement_, i);
        value = Napi::String::New(env, reinterpret_cast<const char *>(text));
        break;
      }
      case SQLITE_BLOB: {
        const void *blob_data = sqlite3_column_blob(statement_, i);
        int blob_size = sqlite3_column_bytes(statement_, i);
        value = Napi::Buffer<uint8_t>::Copy(
            env, static_cast<const uint8_t *>(blob_data), blob_size);
        break;
      }
      default:
        value = env.Null();
        break;
      }

      result.Set(i, value);
    }

    return result;
  } else {
    // Return result as object (default behavior)
    Napi::Object result = Napi::Object::New(env);

    for (int i = 0; i < column_count; i++) {
      const char *column_name = sqlite3_column_name(statement_, i);
      int column_type = sqlite3_column_type(statement_, i);

      Napi::Value value;

      switch (column_type) {
      case SQLITE_NULL:
        value = env.Null();
        break;
      case SQLITE_INTEGER: {
        sqlite3_int64 int_val = sqlite3_column_int64(statement_, i);
        if (use_big_ints_) {
          // Always return BigInt when readBigInts is true
          value = Napi::BigInt::New(env, static_cast<int64_t>(int_val));
        } else if (int_val > 2147483647LL || int_val < -2147483648LL) {
          // Return BigInt for values outside 32-bit range
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
        const unsigned char *text = sqlite3_column_text(statement_, i);
        value = Napi::String::New(env, reinterpret_cast<const char *>(text));
        break;
      }
      case SQLITE_BLOB: {
        const void *blob_data = sqlite3_column_blob(statement_, i);
        int blob_size = sqlite3_column_bytes(statement_, i);
        value = Napi::Buffer<uint8_t>::Copy(
            env, static_cast<const uint8_t *>(blob_data), blob_size);
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
}

void StatementSync::Reset() {
  // Safety check
  if (!statement_ || finalized_) {
    return; // Silent return, error should have been caught earlier
  }

  sqlite3_reset(statement_);
  sqlite3_clear_bindings(statement_);
}

// ================================
// StatementSyncIterator Implementation
// ================================

Napi::Object StatementSyncIterator::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func =
      DefineClass(env, "StatementSyncIterator",
                  {InstanceMethod("next", &StatementSyncIterator::Next),
                   InstanceMethod("return", &StatementSyncIterator::Return)});

  // Set up Symbol.iterator on the prototype to make it properly iterable
  Napi::Object prototype = func.Get("prototype").As<Napi::Object>();
  Napi::Symbol iteratorSymbol = Napi::Symbol::WellKnown(env, "iterator");

  // Add [Symbol.iterator]() { return this; } to make it iterable
  prototype.Set(iteratorSymbol,
                Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
                  return info.This();
                }));

  // Store constructor in per-instance addon data instead of static variable
  AddonData *addon_data = GetAddonData(env);
  if (addon_data) {
    addon_data->statementSyncIteratorConstructor =
        Napi::Reference<Napi::Function>::New(func);
  }

  exports.Set("StatementSyncIterator", func);
  return exports;
}

Napi::Object StatementSyncIterator::Create(Napi::Env env, StatementSync *stmt) {
  AddonData *addon_data = GetAddonData(env);
  if (!addon_data || addon_data->statementSyncIteratorConstructor.IsEmpty()) {
    Napi::Error::New(env, "StatementSyncIterator constructor not initialized")
        .ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  Napi::Object obj = addon_data->statementSyncIteratorConstructor.New({});
  StatementSyncIterator *iter =
      Napi::ObjectWrap<StatementSyncIterator>::Unwrap(obj);
  iter->SetStatement(stmt);
  return obj;
}

StatementSyncIterator::StatementSyncIterator(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<StatementSyncIterator>(info), stmt_(nullptr),
      done_(false) {}

StatementSyncIterator::~StatementSyncIterator() {}

void StatementSyncIterator::SetStatement(StatementSync *stmt) {
  stmt_ = stmt;
  done_ = false;
}

Napi::Value StatementSyncIterator::Next(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!stmt_ || stmt_->finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!stmt_->database_ || !stmt_->database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
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
      node::THROW_ERR_SQLITE_ERROR(
          env, sqlite3_errmsg(stmt_->database_->connection()));
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

Napi::Value StatementSyncIterator::Return(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!stmt_ || stmt_->finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!stmt_->database_ || !stmt_->database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
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

// Session Implementation
Napi::Object Session::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func =
      DefineClass(env, "Session",
                  {InstanceMethod("changeset", &Session::Changeset),
                   InstanceMethod("patchset", &Session::Patchset),
                   InstanceMethod("close", &Session::Close)});

  // Store constructor in per-instance addon data instead of static variable
  AddonData *addon_data = GetAddonData(env);
  if (addon_data) {
    addon_data->sessionConstructor = Napi::Reference<Napi::Function>::New(func);
  }

  exports.Set("Session", func);
  return exports;
}

Napi::Object Session::Create(Napi::Env env, DatabaseSync *database,
                             sqlite3_session *session) {
  AddonData *addon_data = GetAddonData(env);
  if (!addon_data || addon_data->sessionConstructor.IsEmpty()) {
    Napi::Error::New(env, "Session constructor not initialized")
        .ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  Napi::Object obj = addon_data->sessionConstructor.New({});
  Session *sess = Napi::ObjectWrap<Session>::Unwrap(obj);
  sess->SetSession(database, session);
  return obj;
}

Session::Session(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<Session>(info), session_(nullptr) {}

Session::~Session() { Delete(); }

void Session::SetSession(DatabaseSync *database, sqlite3_session *session) {
  database_ = database;
  session_ = session;
  if (database_) {
    database_->AddSession(this);
  }
}

void Session::Delete() {
  if (session_ == nullptr)
    return;

  // Store the session pointer and clear our member immediately
  // to prevent double-delete
  sqlite3_session *session_to_delete = session_;
  session_ = nullptr;

  // Remove ourselves from the database's session list BEFORE deleting
  // to avoid any potential issues with the database trying to access us
  DatabaseSync *database = database_;
  database_ = nullptr;

  if (database) {
    database->RemoveSession(this);
  }

  // Now it's safe to delete the SQLite session
  sqlite3session_delete(session_to_delete);
}

template <int (*sqliteChangesetFunc)(sqlite3_session *, int *, void **)>
Napi::Value Session::GenericChangeset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (session_ == nullptr) {
    node::THROW_ERR_INVALID_STATE(env, "session is not open");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  int nChangeset;
  void *pChangeset;
  int r = sqliteChangesetFunc(session_, &nChangeset, &pChangeset);

  if (r != SQLITE_OK) {
    const char *errMsg = sqlite3_errmsg(database_->connection());
    Napi::Error::New(env,
                     std::string("Failed to generate changeset: ") + errMsg)
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Create a Buffer from the changeset data
  Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::New(env, nChangeset);
  std::memcpy(buffer.Data(), pChangeset, nChangeset);

  // Free the changeset allocated by SQLite
  sqlite3_free(pChangeset);

  return buffer;
}

Napi::Value Session::Changeset(const Napi::CallbackInfo &info) {
  return GenericChangeset<sqlite3session_changeset>(info);
}

Napi::Value Session::Patchset(const Napi::CallbackInfo &info) {
  return GenericChangeset<sqlite3session_patchset>(info);
}

Napi::Value Session::Close(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (session_ == nullptr) {
    node::THROW_ERR_INVALID_STATE(env, "session is not open");
    return env.Undefined();
  }

  Delete();
  return env.Undefined();
}

// Static members for tracking active jobs
std::atomic<int> BackupJob::active_jobs_(0);
std::mutex BackupJob::active_jobs_mutex_;
std::set<BackupJob *> BackupJob::active_job_instances_;

// BackupJob Implementation
BackupJob::BackupJob(Napi::Env env, DatabaseSync *source,
                     const std::string &destination_path,
                     const std::string &source_db, const std::string &dest_db,
                     int pages, Napi::Function progress_func,
                     Napi::Promise::Deferred deferred)
    : Napi::AsyncProgressWorker<BackupProgress>(
          !progress_func.IsEmpty() && !progress_func.IsUndefined()
              ? progress_func
              : Napi::Function::New(env, [](const Napi::CallbackInfo &) {})),
      source_(source), destination_path_(destination_path),
      source_db_(source_db), dest_db_(dest_db), pages_(pages),
      deferred_(deferred) {
  if (!progress_func.IsEmpty() && !progress_func.IsUndefined()) {
    progress_func_ = Napi::Reference<Napi::Function>::New(progress_func);
  }
  active_jobs_++;
}

BackupJob::~BackupJob() { active_jobs_--; }

void BackupJob::Execute(const ExecutionProgress &progress) {
  // This method is executed on a worker thread, not the main thread
  // Note: SQLite backup operations are thread-safe when the source database
  // is only being read. The backup API creates its own read transaction
  // and can safely operate across threads.

  backup_status_ = sqlite3_open_v2(
      destination_path_.c_str(), &dest_,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI, nullptr);

  if (backup_status_ != SQLITE_OK) {
    SetError("Failed to open destination database");
    return;
  }

  // Initialize backup
  backup_ = sqlite3_backup_init(dest_, dest_db_.c_str(), source_->connection(),
                                source_db_.c_str());

  if (!backup_) {
    SetError("Failed to initialize backup");
    return;
  }

  // Initial page count may be 0 until first step
  int remaining_pages = sqlite3_backup_remaining(backup_);
  total_pages_ = 0; // Will be updated after first step

  while ((remaining_pages > 0 || total_pages_ == 0) &&
         backup_status_ == SQLITE_OK) {
    // If pages_ is negative, use -1 to copy all remaining pages
    int pages_to_copy = pages_ < 0 ? -1 : pages_;
    backup_status_ = sqlite3_backup_step(backup_, pages_to_copy);

    // Update total pages after first step (when SQLite knows the actual count)
    if (total_pages_ == 0) {
      total_pages_ = sqlite3_backup_pagecount(backup_);
    }

    if (backup_status_ == SQLITE_OK || backup_status_ == SQLITE_DONE) {
      remaining_pages = sqlite3_backup_remaining(backup_);
      int current_page = total_pages_ - remaining_pages;

      // Send progress update to main thread
      if (!progress_func_.IsEmpty() && total_pages_ > 0) {
        BackupProgress prog = {current_page, total_pages_};
        progress.Send(&prog, 1);
      }

      // Check if we're done
      if (backup_status_ == SQLITE_DONE) {
        break;
      }
    } else if (backup_status_ == SQLITE_BUSY ||
               backup_status_ == SQLITE_LOCKED) {
      // These are retryable errors - continue
      backup_status_ = SQLITE_OK;
    } else {
      // Fatal error
      break;
    }
  }

  // Store final status for use in OnOK/OnError
  if (backup_status_ != SQLITE_DONE) {
    std::string error = "Backup failed with SQLite error: ";
    error += sqlite3_errmsg(dest_);
    SetError(error);
  }
}

void BackupJob::OnProgress(const BackupProgress *data, size_t count) {
  // This runs on the main thread
  if (!progress_func_.IsEmpty() && count > 0) {
    Napi::HandleScope scope(Env());
    Napi::Function progress_fn = progress_func_.Value();
    Napi::Object progress_info = Napi::Object::New(Env());
    progress_info.Set("totalPages", Napi::Number::New(Env(), data->total));
    progress_info.Set("remainingPages",
                      Napi::Number::New(Env(), data->total - data->current));

    try {
      progress_fn.Call(Env().Null(), {progress_info});
    } catch (...) {
      // Ignore errors in progress callback
    }
  }
}

void BackupJob::OnOK() {
  // This runs on the main thread after Execute completes successfully
  Napi::HandleScope scope(Env());

  // Cleanup SQLite resources
  Cleanup();

  // Resolve the promise with the total number of pages
  deferred_.Resolve(Napi::Number::New(Env(), total_pages_));
}

void BackupJob::OnError(const Napi::Error &error) {
  // This runs on the main thread if Execute encounters an error
  Napi::HandleScope scope(Env());

  // Cleanup SQLite resources
  Cleanup();

  // Create a more detailed error if we have SQLite error info
  if (dest_ && backup_status_ != SQLITE_OK) {
    Napi::Error detailed_error = Napi::Error::New(Env(), error.Message());
    detailed_error.Set(
        "code", Napi::String::New(Env(), sqlite3_errstr(backup_status_)));
    detailed_error.Set("errno", Napi::Number::New(Env(), backup_status_));
    deferred_.Reject(detailed_error.Value());
  } else {
    deferred_.Reject(error.Value());
  }
}

// HandleBackupError method removed - error handling now done in OnError

void BackupJob::Cleanup() {
  if (backup_) {
    sqlite3_backup_finish(backup_);
    backup_ = nullptr;
  }

  if (dest_) {
    backup_status_ = sqlite3_errcode(dest_);
    sqlite3_close_v2(dest_);
    dest_ = nullptr;
  }
}

// DatabaseSync::Backup implementation
Napi::Value DatabaseSync::Backup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Create a promise early for error handling
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

  if (!IsOpen()) {
    deferred.Reject(Napi::Error::New(env, "database is not open").Value());
    return deferred.Promise();
  }

  if (info.Length() < 1) {
    deferred.Reject(
        Napi::TypeError::New(env, "The \"destination\" argument is required")
            .Value());
    return deferred.Promise();
  }

  std::optional<std::string> destination_path =
      ValidateDatabasePath(env, info[0], "destination");
  if (!destination_path.has_value()) {
    deferred.Reject(Napi::Error::New(env, "Invalid destination path").Value());
    return deferred.Promise();
  }

  // Default options matching Node.js API
  int rate = 100;
  std::string source_db = "main";
  std::string target_db = "main";
  Napi::Function progress_func;

  // Parse options if provided
  if (info.Length() > 1) {
    if (!info[1].IsObject()) {
      deferred.Reject(Napi::TypeError::New(
                          env, "The \"options\" argument must be an object")
                          .Value());
      return deferred.Promise();
    }

    Napi::Object options = info[1].As<Napi::Object>();

    // Get rate option (number of pages per step)
    Napi::Value rate_value = options.Get("rate");
    if (!rate_value.IsUndefined()) {
      if (!rate_value.IsNumber()) {
        deferred.Reject(
            Napi::TypeError::New(env, "The \"options.rate\" must be a number")
                .Value());
        return deferred.Promise();
      }
      rate = rate_value.As<Napi::Number>().Int32Value();
      // Note: Node.js allows negative values for rate
    }

    // Get source database option
    Napi::Value source_value = options.Get("source");
    if (!source_value.IsUndefined()) {
      if (!source_value.IsString()) {
        deferred.Reject(
            Napi::TypeError::New(env, "The \"options.source\" must be a string")
                .Value());
        return deferred.Promise();
      }
      source_db = source_value.As<Napi::String>().Utf8Value();
    }

    // Get target database option
    Napi::Value target_value = options.Get("target");
    if (!target_value.IsUndefined()) {
      if (!target_value.IsString()) {
        deferred.Reject(
            Napi::TypeError::New(env, "The \"options.target\" must be a string")
                .Value());
        return deferred.Promise();
      }
      target_db = target_value.As<Napi::String>().Utf8Value();
    }

    // Get progress callback
    Napi::Value progress_value = options.Get("progress");
    if (!progress_value.IsUndefined()) {
      if (!progress_value.IsFunction()) {
        deferred.Reject(Napi::TypeError::New(
                            env, "The \"options.progress\" must be a function")
                            .Value());
        return deferred.Promise();
      }
      progress_func = progress_value.As<Napi::Function>();
    }
  }

  // Create and schedule backup job
  BackupJob *job = new BackupJob(env, this, destination_path.value(), source_db,
                                 target_db, rate, progress_func, deferred);

  // Queue the async work - AsyncWorker will delete itself when complete
  job->Queue();

  return deferred.Promise();
}

// Thread validation implementations
bool DatabaseSync::ValidateThread(Napi::Env env) const {
  if (std::this_thread::get_id() != creation_thread_) {
    node::THROW_ERR_INVALID_STATE(
        env, "Database connection cannot be used from different thread");
    return false;
  }
  return true;
}

bool StatementSync::ValidateThread(Napi::Env env) const {
  if (std::this_thread::get_id() != creation_thread_) {
    node::THROW_ERR_INVALID_STATE(
        env, "Statement cannot be used from different thread");
    return false;
  }
  return true;
}

} // namespace sqlite
} // namespace photostructure