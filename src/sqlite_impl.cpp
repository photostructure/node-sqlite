#include "sqlite_impl.h"

#include <algorithm>
#include <cctype>
#include <cinttypes>
#include <climits>
#include <cmath>
#include <limits>

#include "aggregate_function.h"
#include "shims/sqlite_errors.h"

// Database-aware error handling functions to avoid forward declaration issues
namespace {
inline void ThrowErrSqliteErrorWithDb(Napi::Env env,
                                      photostructure::sqlite::DatabaseSync *db,
                                      const char *message = nullptr) {
  // Check if we should ignore this SQLite error due to pending JavaScript
  // exception (e.g., from authorizer callback)
  if (db != nullptr && db->ShouldIgnoreSQLiteError()) {
    db->SetIgnoreNextSQLiteError(false);
    // Check for deferred authorizer exception and throw it instead
    if (db->HasDeferredAuthorizerException()) {
      db->RethrowDeferredAuthorizerException();
    }
    return; // Don't throw SQLite error, JavaScript exception takes precedence
  }

  const char *msg = (message != nullptr) ? message : "SQLite error";
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

inline void ThrowEnhancedSqliteErrorWithDB(
    Napi::Env env, photostructure::sqlite::DatabaseSync *db_sync, sqlite3 *db,
    int /*sqlite_code*/, const std::string &message) {
  // Check if we should ignore this SQLite error due to pending JavaScript
  // exception (e.g., from authorizer callback)
  if (db_sync != nullptr && db_sync->ShouldIgnoreSQLiteError()) {
    db_sync->SetIgnoreNextSQLiteError(false);
    // Check for deferred authorizer exception and throw it instead
    if (db_sync->HasDeferredAuthorizerException()) {
      db_sync->RethrowDeferredAuthorizerException();
    }
    return; // Don't throw SQLite error, JavaScript exception takes precedence
  }

  // Use extended error code from db handle (e.g., 1555 for
  // SQLITE_CONSTRAINT_PRIMARYKEY) instead of basic code (e.g., 19 for
  // SQLITE_CONSTRAINT) to match Node.js behavior
  int extended_code = db ? sqlite3_extended_errcode(db) : SQLITE_ERROR;
  node::ThrowEnhancedSqliteError(env, db, extended_code, message);
}
} // namespace
#include "sqlite_exception.h"
#include "user_function.h"

namespace photostructure::sqlite {

// JavaScript safe integer limits (2^53 - 1)
constexpr int64_t JS_MAX_SAFE_INTEGER = 9007199254740991LL;
constexpr int64_t JS_MIN_SAFE_INTEGER = -9007199254740991LL;

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
    const auto buffer = path.As<Napi::Buffer<uint8_t>>();
    const size_t length = buffer.Length();
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
            // Check if URL has query parameters - if so, return full URI
            // for SQLite URI mode (e.g., file:///path/to/db?mode=ro)
            size_t query_pos = location.find('?');
            if (query_pos != std::string::npos) {
              // Return full URI for SQLite to parse with SQLITE_OPEN_URI
              return location;
            }

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

  node::THROW_ERR_INVALID_ARG_TYPE(env,
                                   ("The \"" + field_name +
                                    "\" argument must be a string, "
                                    "Uint8Array, or URL without null bytes.")
                                       .c_str());
  return std::nullopt;
}

// Note: Static constructors removed to fix worker thread issues
// Constructors are now stored in per-instance AddonData

// Forward declarations for addon data access
extern AddonData *GetAddonData(napi_env env);

// Helper to create an object with null prototype (matches Node.js behavior)
// Node.js uses Object::New(isolate, Null(isolate), ...) but N-API doesn't have
// this capability, so we use cached Object.create(null) instead.
Napi::Object CreateObjectWithNullPrototype(Napi::Env env) {
  AddonData *addon_data = GetAddonData(env);
  if (addon_data && !addon_data->objectCreateFn.IsEmpty()) {
    // Call Object.create(null) to create object with null prototype
    return addon_data->objectCreateFn.Value()
        .Call({env.Null()})
        .As<Napi::Object>();
  }
  // Fallback to regular object if Object.create not available
  return Napi::Object::New(env);
}

// DatabaseSync Implementation
Napi::Object DatabaseSync::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "DatabaseSync",
      {InstanceMethod("open", &DatabaseSync::Open),
       InstanceMethod("close", &DatabaseSync::Close),
       InstanceMethod("dispose", &DatabaseSync::Dispose),
       InstanceMethod("prepare", &DatabaseSync::Prepare),
       InstanceMethod("exec", &DatabaseSync::Exec),
       InstanceMethod("function", &DatabaseSync::CustomFunction),
       InstanceMethod("aggregate", &DatabaseSync::AggregateFunction),
       InstanceMethod("enableLoadExtension",
                      &DatabaseSync::EnableLoadExtension),
       InstanceMethod("loadExtension", &DatabaseSync::LoadExtension),
       InstanceMethod("enableDefensive", &DatabaseSync::EnableDefensive),
       InstanceMethod("createSession", &DatabaseSync::CreateSession),
       InstanceMethod("applyChangeset", &DatabaseSync::ApplyChangeset),
       InstanceMethod("setAuthorizer", &DatabaseSync::SetAuthorizer),
       InstanceMethod("getLimit", &DatabaseSync::GetLimit),
       InstanceMethod("setLimit", &DatabaseSync::SetLimit),
       InstanceMethod("backup", &DatabaseSync::Backup),
       InstanceMethod("serialize", &DatabaseSync::Serialize),
       InstanceMethod("deserialize", &DatabaseSync::Deserialize),
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

  // Add Symbol.dispose to the prototype (Node.js v25+ compatibility)
  Napi::Value symbolDispose =
      env.Global().Get("Symbol").As<Napi::Object>().Get("dispose");
  if (!symbolDispose.IsUndefined()) {
    func.Get("prototype")
        .As<Napi::Object>()
        .Set(symbolDispose,
             Napi::Function::New(
                 env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                   DatabaseSync *db =
                       DatabaseSync::Unwrap(info.This().As<Napi::Object>());
                   return db->Dispose(info);
                 }));
  }

  // Add Symbol.for('sqlite-type') property for type identification
  // See: https://github.com/nodejs/node/pull/59405
  Napi::Object symbolConstructor =
      env.Global().Get("Symbol").As<Napi::Object>();
  Napi::Function symbolFor = symbolConstructor.Get("for").As<Napi::Function>();
  Napi::Value sqliteTypeSymbol = symbolFor.Call(
      symbolConstructor, {Napi::String::New(env, "sqlite-type")});
  func.Get("prototype")
      .As<Napi::Object>()
      .Set(sqliteTypeSymbol, Napi::String::New(env, "node:sqlite"));

  exports.Set("DatabaseSync", func);
  return exports;
}

DatabaseSync::DatabaseSync(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<DatabaseSync>(info),
      creation_thread_(std::this_thread::get_id()), env_(info.Env()),
      config_("") {
  // Register this instance for cleanup tracking
  RegisterDatabaseInstance(info.Env(), this);

  // Register cleanup hook to clean up references before environment teardown
  napi_add_env_cleanup_hook(env_, CleanupHook, this);

  // Node.js requires a path argument - throw if missing
  if (info.Length() == 0 || info[0].IsUndefined()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        info.Env(),
        "The \"path\" argument must be a string, Uint8Array, or URL without "
        "null bytes.");
    return;
  }

  // Validate and extract the database path
  std::optional<std::string> location =
      ValidateDatabasePath(info.Env(), info[0], "path");
  if (!location.has_value()) {
    return; // Error already thrown by ValidateDatabasePath
  }

  try {
    std::string loc = std::move(*location);
    // Check if this is a file:// URI (for SQLite URI mode)
    bool is_uri = (loc.compare(0, 7, "file://") == 0);
    DatabaseOpenConfiguration config(std::move(loc));
    if (is_uri) {
      config.set_open_uri(true);
    }

    // Track whether to open immediately (default: true)
    bool should_open = true;

    // Handle options object if provided as second argument
    if (info.Length() > 1) {
      if (!info[1].IsObject()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            info.Env(), "The \"options\" argument must be an object.");
        return;
      }

      Napi::Object options = info[1].As<Napi::Object>();

      // Validate and parse 'open' option
      Napi::Value open_val = options.Get("open");
      if (!open_val.IsUndefined()) {
        if (!open_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(), "The \"options.open\" argument must be a boolean.");
          return;
        }
        should_open = open_val.As<Napi::Boolean>().Value();
      }

      // Validate and parse 'readOnly' option
      Napi::Value read_only_val = options.Get("readOnly");
      if (!read_only_val.IsUndefined()) {
        if (!read_only_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.readOnly\" argument must be a boolean.");
          return;
        }
        config.set_read_only(read_only_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'enableForeignKeyConstraints' option
      Napi::Value enable_fk_val = options.Get("enableForeignKeyConstraints");
      if (!enable_fk_val.IsUndefined()) {
        if (!enable_fk_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.enableForeignKeyConstraints\" argument must be a "
              "boolean.");
          return;
        }
        config.set_enable_foreign_keys(
            enable_fk_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'enableDoubleQuotedStringLiterals' option
      Napi::Value enable_dqs_val =
          options.Get("enableDoubleQuotedStringLiterals");
      if (!enable_dqs_val.IsUndefined()) {
        if (!enable_dqs_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.enableDoubleQuotedStringLiterals\" argument must "
              "be a boolean.");
          return;
        }
        config.set_enable_dqs(enable_dqs_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'allowExtension' option
      Napi::Value allow_ext_val = options.Get("allowExtension");
      if (!allow_ext_val.IsUndefined()) {
        if (!allow_ext_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.allowExtension\" argument must be a boolean.");
          return;
        }
        allow_load_extension_ = allow_ext_val.As<Napi::Boolean>().Value();
      }

      // Validate and parse 'timeout' option
      Napi::Value timeout_val = options.Get("timeout");
      if (!timeout_val.IsUndefined()) {
        if (!timeout_val.IsNumber()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.timeout\" argument must be an integer.");
          return;
        }
        double timeout_double = timeout_val.As<Napi::Number>().DoubleValue();
        if (timeout_double != std::trunc(timeout_double)) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.timeout\" argument must be an integer.");
          return;
        }
        config.set_timeout(timeout_val.As<Napi::Number>().Int32Value());
      }

      // Validate and parse 'readBigInts' option
      Napi::Value read_bigints_val = options.Get("readBigInts");
      if (!read_bigints_val.IsUndefined()) {
        if (!read_bigints_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.readBigInts\" argument must be a boolean.");
          return;
        }
        config.set_read_big_ints(read_bigints_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'returnArrays' option
      Napi::Value return_arrays_val = options.Get("returnArrays");
      if (!return_arrays_val.IsUndefined()) {
        if (!return_arrays_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.returnArrays\" argument must be a boolean.");
          return;
        }
        config.set_return_arrays(return_arrays_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'allowBareNamedParameters' option
      Napi::Value allow_bare_val = options.Get("allowBareNamedParameters");
      if (!allow_bare_val.IsUndefined()) {
        if (!allow_bare_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.allowBareNamedParameters\" argument must be a "
              "boolean.");
          return;
        }
        config.set_allow_bare_named_params(
            allow_bare_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'allowUnknownNamedParameters' option
      Napi::Value allow_unknown_val =
          options.Get("allowUnknownNamedParameters");
      if (!allow_unknown_val.IsUndefined()) {
        if (!allow_unknown_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.allowUnknownNamedParameters\" argument must be a "
              "boolean.");
          return;
        }
        config.set_allow_unknown_named_params(
            allow_unknown_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'defensive' option
      Napi::Value defensive_val = options.Get("defensive");
      if (!defensive_val.IsUndefined()) {
        if (!defensive_val.IsBoolean()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(),
              "The \"options.defensive\" argument must be a boolean.");
          return;
        }
        config.set_enable_defensive(defensive_val.As<Napi::Boolean>().Value());
      }

      // Validate and parse 'limits' option
      Napi::Value limits_val = options.Get("limits");
      if (!limits_val.IsUndefined()) {
        if (!limits_val.IsObject() || limits_val.IsNull()) {
          node::THROW_ERR_INVALID_ARG_TYPE(
              info.Env(), "The \"options.limits\" argument must be an object.");
          return;
        }

        Napi::Object limits_obj = limits_val.As<Napi::Object>();

        // Limit name to SQLite limit ID mapping (matches upstream
        // kLimitMapping)
        static const struct {
          const char *name;
          int id;
        } kLimitNames[] = {
            {"length", SQLITE_LIMIT_LENGTH},
            {"sqlLength", SQLITE_LIMIT_SQL_LENGTH},
            {"column", SQLITE_LIMIT_COLUMN},
            {"exprDepth", SQLITE_LIMIT_EXPR_DEPTH},
            {"compoundSelect", SQLITE_LIMIT_COMPOUND_SELECT},
            {"vdbeOp", SQLITE_LIMIT_VDBE_OP},
            {"functionArg", SQLITE_LIMIT_FUNCTION_ARG},
            {"attach", SQLITE_LIMIT_ATTACHED},
            {"likePatternLength", SQLITE_LIMIT_LIKE_PATTERN_LENGTH},
            {"variableNumber", SQLITE_LIMIT_VARIABLE_NUMBER},
            {"triggerDepth", SQLITE_LIMIT_TRIGGER_DEPTH},
        };

        for (const auto &limit : kLimitNames) {
          Napi::Value val = limits_obj.Get(limit.name);
          if (!val.IsUndefined()) {
            if (!val.IsNumber()) {
              std::string msg = std::string("The \"options.limits.") +
                                limit.name + "\" argument must be an integer.";
              node::THROW_ERR_INVALID_ARG_TYPE(info.Env(), msg.c_str());
              return;
            }

            double dval = val.As<Napi::Number>().DoubleValue();
            if (dval != std::trunc(dval) || std::isinf(dval) ||
                std::isnan(dval)) {
              std::string msg = std::string("The \"options.limits.") +
                                limit.name + "\" argument must be an integer.";
              node::THROW_ERR_INVALID_ARG_TYPE(info.Env(), msg.c_str());
              return;
            }

            int limit_val = static_cast<int>(dval);
            if (limit_val < 0) {
              std::string msg = std::string("The \"options.limits.") +
                                limit.name +
                                "\" argument must be non-negative.";
              node::THROW_ERR_OUT_OF_RANGE(info.Env(), msg.c_str());
              return;
            }

            config.set_initial_limit(limit.id, limit_val);
          }
        }
      }
    }

    // Store configuration for later use
    config_ = std::move(config);

    // Only open if should_open is true
    if (should_open) {
      InternalOpen(config_);
    }
  } catch (const SqliteException &e) {
    node::ThrowFromSqliteException(info.Env(), e);
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(info.Env(), e.what());
  }
}

DatabaseSync::~DatabaseSync() {
  // Remove cleanup hook if still registered
  napi_remove_env_cleanup_hook(env_, CleanupHook, this);

  // Unregister this instance
  UnregisterDatabaseInstance(env_, this);

  if (connection_) {
    InternalClose();
  }
}

void DatabaseSync::CleanupHook(void *arg) {
  // Called before environment teardown - safe to Reset() references here
  auto *self = static_cast<DatabaseSync *>(arg);

  // Clean up authorizer callback if it exists
  if (self->authorizer_callback_) {
    self->authorizer_callback_->Reset();
  }
  self->ClearDeferredAuthorizerException();
}

// SQLite forbids modifying a connection from inside its own authorizer
// callback and explicitly counts prepare/step as modification. The result of
// violating that contract is unspecified, so reject SQLite-backed operations
// on the invoking connection with a clear ERR_INVALID_STATE instead.
//
// This is an INTENTIONAL divergence from node:sqlite, which has no such guard:
// upstream currently passes these calls through to SQLite. We also deliberately
// guard SQLite-backed read-only getters (columns/expandedSQL/location/getLimit/
// isTransaction) for one consistent callback contract.
bool DatabaseSync::ThrowIfInAuthorizerCallback(Napi::Env env,
                                               const char *action) const {
  if (!IsInAuthorizerCallback()) {
    return false;
  }

  std::string message = "Cannot ";
  message += action;
  message += " while an authorizer callback is on the stack";
  node::THROW_ERR_INVALID_STATE(env, message.c_str());
  return true;
}

void DatabaseSync::RethrowDeferredAuthorizerException() {
  Napi::Error error = GetDeferredAuthorizerException();
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);
  error.ThrowAsJavaScriptException();
}

Napi::Value DatabaseSync::Open(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is already open");
    return env.Undefined();
  }

  try {
    InternalOpen(config_);
  } catch (const SqliteException &e) {
    node::ThrowFromSqliteException(env, e);
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
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "close database")) {
    return env.Undefined();
  }

  // SQLite forbids closing a connection while a statement is executing on it.
  // The only way close() is reachable in that state is from inside a user
  // callback invoked by sqlite3_step()/sqlite3_exec(); reject it rather than
  // finalize a statement whose VM is still on the stack (undefined behavior).
  if (IsExecutingStatement()) {
    node::THROW_ERR_INVALID_STATE(
        env,
        "database cannot be closed inside a user-defined function callback");
    return env.Undefined();
  }

  try {
    InternalClose();
  } catch (const std::exception &e) {
    node::THROW_ERR_SQLITE_ERROR(env, e.what());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::Dispose(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (IsOpen() && ThrowIfInAuthorizerCallback(env, "close database")) {
    return env.Undefined();
  }

  // Symbol.dispose is a no-op while a statement is executing on this
  // connection (i.e. inside a user-defined function callback). Disposal
  // deliberately swallows errors, and closing here would finalize a
  // statement whose sqlite3_step is still on the stack (undefined behavior).
  if (IsExecutingStatement()) {
    return env.Undefined();
  }

  // Try to close, but ignore errors during disposal (matches Node.js v25
  // behavior)
  try {
    if (IsOpen()) {
      InternalClose();
    }
  } catch (...) {
    // Ignore errors during disposal
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::Prepare(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "prepare statement")) {
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "The \"sql\" argument must be a string.");
    return env.Undefined();
  }

  std::string sql = info[0].As<Napi::String>().Utf8Value();

  // Parse optional second argument (options object)
  // Node.js v25+ supports per-statement options that override database defaults
  std::optional<bool> opt_read_big_ints;
  std::optional<bool> opt_return_arrays;
  std::optional<bool> opt_allow_bare_named_params;
  std::optional<bool> opt_allow_unknown_named_params;

  if (info.Length() > 1 && !info[1].IsUndefined()) {
    if (!info[1].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }

    Napi::Object options = info[1].As<Napi::Object>();

    // Parse readBigInts option
    Napi::Value read_big_ints_val = options.Get("readBigInts");
    if (!read_big_ints_val.IsUndefined()) {
      if (!read_big_ints_val.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.readBigInts\" argument must be a boolean.");
        return env.Undefined();
      }
      opt_read_big_ints = read_big_ints_val.As<Napi::Boolean>().Value();
    }

    // Parse returnArrays option
    Napi::Value return_arrays_val = options.Get("returnArrays");
    if (!return_arrays_val.IsUndefined()) {
      if (!return_arrays_val.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.returnArrays\" argument must be a boolean.");
        return env.Undefined();
      }
      opt_return_arrays = return_arrays_val.As<Napi::Boolean>().Value();
    }

    // Parse allowBareNamedParameters option
    Napi::Value allow_bare_val = options.Get("allowBareNamedParameters");
    if (!allow_bare_val.IsUndefined()) {
      if (!allow_bare_val.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.allowBareNamedParameters\" argument must be a "
                 "boolean.");
        return env.Undefined();
      }
      opt_allow_bare_named_params = allow_bare_val.As<Napi::Boolean>().Value();
    }

    // Parse allowUnknownNamedParameters option
    Napi::Value allow_unknown_val = options.Get("allowUnknownNamedParameters");
    if (!allow_unknown_val.IsUndefined()) {
      if (!allow_unknown_val.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.allowUnknownNamedParameters\" argument must be "
                 "a boolean.");
        return env.Undefined();
      }
      opt_allow_unknown_named_params =
          allow_unknown_val.As<Napi::Boolean>().Value();
    }
  }

  // Clear any stale deferred exception from a previous operation
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);

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

    // Initialize the statement (applies database-level defaults)
    StatementSync *stmt = StatementSync::Unwrap(stmt_obj);
    stmt->InitStatement(this, sql);

    // Apply per-statement option overrides (if explicitly provided)
    if (opt_read_big_ints.has_value()) {
      stmt->use_big_ints_ = *opt_read_big_ints;
    }
    if (opt_return_arrays.has_value()) {
      stmt->return_arrays_ = *opt_return_arrays;
    }
    if (opt_allow_bare_named_params.has_value()) {
      stmt->allow_bare_named_params_ = *opt_allow_bare_named_params;
    }
    if (opt_allow_unknown_named_params.has_value()) {
      stmt->allow_unknown_named_params_ = *opt_allow_unknown_named_params;
    }

    return stmt_obj;
  } catch (const SqliteException &e) {
    // SqliteException stores message in std::string, avoiding Windows ARM ABI
    // issues where std::exception::what() can return corrupted strings
    if (HasDeferredAuthorizerException()) {
      RethrowDeferredAuthorizerException();
      return env.Undefined();
    }
    node::ThrowFromSqliteException(env, e);
    return env.Undefined();
  } catch (const std::exception &e) {
    // Handle deferred authorizer exceptions:
    //
    // When an authorizer callback throws a JavaScript exception, we use a
    // "marker" exception pattern to safely propagate the error:
    //
    // 1. On Windows (MSVC), std::exception::what() can sometimes return an
    //    empty string, causing message loss.
    //
    // 2. DatabaseSync holds Napi::Error's persistent reference until this
    //    SQLite call unwinds, preserving the exact thrown JavaScript value.
    //
    // See also: StatementSync::InitStatement for the other half of this
    // pattern.
    if (HasDeferredAuthorizerException()) {
      RethrowDeferredAuthorizerException();
      return env.Undefined();
    }
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
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "exec")) {
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "The \"sql\" argument must be a string.");
    return env.Undefined();
  }

  std::string sql = info[0].As<Napi::String>().Utf8Value();

  // Clear any stale deferred exception from a previous operation
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);

  char *error_msg = nullptr;
  // Raise the user-callback depth for the duration of sqlite3_exec so that a
  // close()/deserialize() re-entered from a user function it invokes throws
  // ERR_INVALID_STATE. sqlite3_exec is a plain C call and never propagates a
  // C++ exception (JS callback errors are deferred), so manual balancing here
  // is safe.
  EnterStatementStep();
  int result =
      sqlite3_exec(connection(), sql.c_str(), nullptr, nullptr, &error_msg);
  LeaveStatementStep();

  if (result != SQLITE_OK) {
    // Check for deferred authorizer exception first
    if (HasDeferredAuthorizerException()) {
      if (error_msg)
        sqlite3_free(error_msg);
      RethrowDeferredAuthorizerException();
      return env.Undefined();
    }
    std::string error = error_msg ? error_msg : "Unknown SQLite error";
    if (error_msg)
      sqlite3_free(error_msg);
    // Use enhanced error throwing with database handle
    node::ThrowSqliteError(env, connection(), error);
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::LocationMethod(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "read database location")) {
    return env.Undefined();
  }

  // Default to "main" if no dbName provided
  std::string db_name = "main";
  if (info.Length() > 0 && !info[0].IsUndefined()) {
    if (!info[0].IsString()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"dbName\" argument must be a string.");
      return env.Undefined();
    }
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

Napi::Value DatabaseSync::Serialize(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "serialize database")) {
    return env.Undefined();
  }

  std::string db_name = "main";
  if (info.Length() > 0 && !info[0].IsUndefined()) {
    if (!info[0].IsString()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"dbName\" argument must be a string.");
      return env.Undefined();
    }
    db_name = info[0].As<Napi::String>().Utf8Value();
  }

  // Clear any stale deferred exception from a previous operation.
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);

  // Ordinary in-memory and file-backed databases use an internal
  // PRAGMA page_count path that can invoke the authorizer. The callback's
  // AuthorizerGuard rejects same-connection reentry while it is on the stack.
  sqlite3_int64 size = 0;
  unsigned char *data =
      sqlite3_serialize(connection_, db_name.c_str(), &size, 0);

  // sqlite3_serialize ignores errors from its empty-database
  // "BEGIN IMMEDIATE; COMMIT;" and can return either a zero-sized result or a
  // non-null buffer after the authorizer throws. Deferred callback state must
  // therefore take precedence over every data/size outcome.
  if (HasDeferredAuthorizerException()) {
    if (data != nullptr) {
      sqlite3_free(data);
    }
    RethrowDeferredAuthorizerException();
    return env.Undefined();
  }

  if (data == nullptr) {
    if (size == 0) {
      auto ab = Napi::ArrayBuffer::New(env, 0);
      return Napi::Uint8Array::New(env, 0, ab, 0);
    }
    node::THROW_ERR_SQLITE_ERROR(env, sqlite3_errmsg(connection_));
    return env.Undefined();
  }

  // ArrayBuffer takes ownership of the sqlite3_malloc'd buffer; the finalizer
  // calls sqlite3_free when V8 GCs the backing store.
  auto ab = Napi::ArrayBuffer::New(
      env, data, static_cast<size_t>(size),
      [](Napi::Env /*env*/, void *ptr) { sqlite3_free(ptr); });

  return Napi::Uint8Array::New(env, static_cast<size_t>(size), ab, 0);
}

Napi::Value DatabaseSync::Deserialize(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "deserialize database")) {
    return env.Undefined();
  }

  // deserialize() finalizes every open statement and replaces the database
  // contents; doing so while a statement is executing (i.e. from inside a
  // user-defined function callback) would pull the rug from under the running
  // VM. Reject it the same way SQLite would.
  if (IsExecutingStatement()) {
    node::THROW_ERR_INVALID_STATE(
        env, "database operation is not allowed inside a user-defined "
             "function callback");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsTypedArray() ||
      info[0].As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"buffer\" argument must be a Uint8Array.");
    return env.Undefined();
  }

  Napi::Uint8Array input = info[0].As<Napi::Uint8Array>();
  size_t byte_length = input.ByteLength();

  if (byte_length == 0) {
    node::THROW_ERR_INVALID_ARG_VALUE(
        env, "The \"buffer\" argument must not be empty.");
    return env.Undefined();
  }

  std::string db_name = "main";
  if (info.Length() > 1 && !info[1].IsUndefined()) {
    if (!info[1].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }
    Napi::Object options = info[1].As<Napi::Object>();
    Napi::Value db_name_value = options.Get("dbName");
    if (!db_name_value.IsUndefined()) {
      if (!db_name_value.IsString()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.dbName\" argument must be a string.");
        return env.Undefined();
      }
      db_name = db_name_value.As<Napi::String>().Utf8Value();
    }
  }

  // SQLITE_DESERIALIZE_FREEONCLOSE transfers buffer ownership to SQLite, which
  // calls sqlite3_free() on close (or on this call's failure). The buffer must
  // therefore come from sqlite3_malloc, not new/malloc.
  unsigned char *buf =
      static_cast<unsigned char *>(sqlite3_malloc64(byte_length));
  if (buf == nullptr) {
    Napi::Error::New(env, "Memory allocation failed")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  memcpy(buf, input.Data(), byte_length);

  // Finalize all open prepared statements; sqlite3_deserialize requires no
  // active statements on the connection. After this call, any user-held
  // StatementSync instances will throw on use.
  FinalizeStatements();

  // Clear any stale deferred exception from a previous operation.
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);

  // sqlite3_deserialize prepares an internal ATTACH statement that can invoke
  // the authorizer. The callback's AuthorizerGuard rejects same-connection
  // reentry while it is on the stack.
  int r = sqlite3_deserialize(
      connection_, db_name.c_str(), buf, byte_length, byte_length,
      SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE);

  if (HasDeferredAuthorizerException()) {
    RethrowDeferredAuthorizerException();
    return env.Undefined();
  }

  if (r != SQLITE_OK) {
    node::THROW_ERR_SQLITE_ERROR(env, sqlite3_errmsg(connection_));
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::IsOpenGetter(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), IsOpen());
}

Napi::Value DatabaseSync::IsTransactionGetter(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "read transaction state")) {
    return env.Undefined();
  }

  // Check if we're in a transaction
  bool in_transaction = !sqlite3_get_autocommit(connection());
  return Napi::Boolean::New(env, in_transaction);
}

void DatabaseSync::InternalOpen(DatabaseOpenConfiguration config) {
  // Store configuration for later use by statements
  config_ = std::move(config);
  location_ = config_.location();
  read_only_ = config_.get_read_only();

  int flags = SQLITE_OPEN_CREATE;
  if (read_only_) {
    flags = SQLITE_OPEN_READONLY;
  } else {
    flags |= SQLITE_OPEN_READWRITE;
  }

  // Add URI flag when location contains URI parameters
  if (config_.get_open_uri()) {
    flags |= SQLITE_OPEN_URI;
  }

  int result = sqlite3_open_v2(location_.c_str(), &connection_, flags, nullptr);

  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(connection_);
    // Capture error info before closing
    SqliteException ex(connection_, result,
                       "Failed to open database: " + error);
    if (connection_) {
      sqlite3_close(connection_);
      connection_ = nullptr;
    }
    throw ex;
  }

  // Configure foreign keys using sqlite3_db_config (matches Node.js behavior)
  // This properly handles both enabling and disabling FK constraints
  int fk_enabled;
  result =
      sqlite3_db_config(connection(), SQLITE_DBCONFIG_ENABLE_FKEY,
                        config_.get_enable_foreign_keys() ? 1 : 0, &fk_enabled);
  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(connection());
    SqliteException ex(connection_, result,
                       "Failed to configure foreign keys: " + error);
    sqlite3_close(connection_);
    connection_ = nullptr;
    throw ex;
  }

  if (config_.get_timeout() > 0) {
    sqlite3_busy_timeout(connection(), config_.get_timeout());
  }

  // Configure double-quoted string literals
  if (config_.get_enable_dqs()) {
    int dqs_enable = 1;
    result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DQS_DML,
                               dqs_enable, nullptr);
    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(connection());
      SqliteException ex(connection_, result,
                         "Failed to configure DQS_DML: " + error);
      sqlite3_close(connection_);
      connection_ = nullptr;
      throw ex;
    }

    result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DQS_DDL,
                               dqs_enable, nullptr);
    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(connection());
      SqliteException ex(connection_, result,
                         "Failed to configure DQS_DDL: " + error);
      sqlite3_close(connection_);
      connection_ = nullptr;
      throw ex;
    }
  }

  // Configure defensive mode
  if (config_.get_enable_defensive()) {
    int defensive_enabled;
    result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DEFENSIVE, 1,
                               &defensive_enabled);
    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(connection());
      SqliteException ex(connection_, result,
                         "Failed to configure DEFENSIVE: " + error);
      sqlite3_close(connection_);
      connection_ = nullptr;
      throw ex;
    }
  }

  // Apply initial limits from constructor options.
  //
  // Bind the array once rather than calling the accessor three times per
  // iteration: it makes the has_value()/deref pair obviously operate on the
  // same optional, which is also what lets clang-tidy's dataflow analysis see
  // the access is checked (bugprone-unchecked-optional-access).
  const auto &initial_limits = config_.initial_limits();
  for (size_t i = 0; i < initial_limits.size(); i++) {
    const std::optional<int> &limit = initial_limits[i];
    if (limit.has_value()) {
      sqlite3_limit(connection_, static_cast<int>(i), *limit);
    }
  }
}

void DatabaseSync::InternalClose() {
  if (connection_) {
    // Finalize any active backup jobs first
    // This prevents use-after-free if backup is running on worker thread
    FinalizeBackups();

    // Finalize every live StatementSync's sqlite3_stmt now. This is safe
    // because close() and Dispose() reject when IsExecutingStatement() is
    // true, so InternalClose() can never run while a sqlite3_step is on the
    // stack. Finalizing here (rather than deferring to ~StatementSync on GC)
    // releases the SHARED/read locks any suspended statement holds, so the
    // following sqlite3_close() succeeds immediately instead of leaving a
    // zombie connection whose locks outlive the close() call.
    FinalizeStatements();

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
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "create function")) {
    return env.Undefined();
  }

  if (!info[0].IsString()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "The \"name\" argument must be a string.");
    return env.Undefined();
  }

  // Parse arguments: function(name, [options], callback)
  int fn_index = info.Length() < 3 ? 1 : 2;
  bool use_bigint_args = false;
  bool varargs = false;
  bool deterministic = false;
  bool direct_only = false;

  // Parse options object if provided
  if (fn_index > 1) {
    if (!info[1].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }

    Napi::Object options = info[1].As<Napi::Object>();

    Napi::Value use_bigint_args_v = options.Get("useBigIntArguments");
    if (!use_bigint_args_v.IsUndefined()) {
      if (!use_bigint_args_v.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env,
            "The \"options.useBigIntArguments\" argument must be a boolean.");
        return env.Undefined();
      }
      use_bigint_args = use_bigint_args_v.As<Napi::Boolean>().Value();
    }

    Napi::Value varargs_v = options.Get("varargs");
    if (!varargs_v.IsUndefined()) {
      if (!varargs_v.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.varargs\" argument must be a boolean.");
        return env.Undefined();
      }
      varargs = varargs_v.As<Napi::Boolean>().Value();
    }

    Napi::Value deterministic_v = options.Get("deterministic");
    if (!deterministic_v.IsUndefined()) {
      if (!deterministic_v.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.deterministic\" argument must be a boolean.");
        return env.Undefined();
      }
      deterministic = deterministic_v.As<Napi::Boolean>().Value();
    }

    Napi::Value direct_only_v = options.Get("directOnly");
    if (!direct_only_v.IsUndefined()) {
      if (!direct_only_v.IsBoolean()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.directOnly\" argument must be a boolean.");
        return env.Undefined();
      }
      direct_only = direct_only_v.As<Napi::Boolean>().Value();
    }
  }

  if (!info[fn_index].IsFunction()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"function\" argument must be a function.");
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
    ThrowErrSqliteErrorWithDb(env, this, error.c_str());
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::AggregateFunction(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "create aggregate")) {
    return env.Undefined();
  }

  // Node.js doesn't check argument count - it just accesses args directly
  std::string name = info[0].IsString() ? info[0].As<Napi::String>().Utf8Value()
                                        : std::string();
  Napi::Object options =
      info[1].IsObject() ? info[1].As<Napi::Object>() : Napi::Object();

  if (options.IsEmpty() || options.IsNull() || options.IsUndefined()) {
    // If options isn't an object, trying to access its properties will fail
    // Node.js would throw from the property access, we mimic that
    options = Napi::Object::New(env);
  }

  // Parse start value
  Napi::Value start = options.Get("start");
  if (start.IsUndefined()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"options.start\" argument must be a function or a primitive "
             "value.");
    return env.Undefined();
  }

  // Parse step function
  Napi::Value step_v = options.Get("step");
  if (!step_v.IsFunction()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"options.step\" argument must be a function.");
    return env.Undefined();
  }
  Napi::Function step_fn = step_v.As<Napi::Function>();

  // Parse result function (optional)
  Napi::Function result_fn;
  Napi::Value result_v = options.Get("result");
  if (!result_v.IsUndefined()) {
    result_fn = result_v.As<Napi::Function>();
  }

  // Parse boolean options with validation
  bool use_bigint_args = false;
  Napi::Value use_bigint_args_v = options.Get("useBigIntArguments");
  if (!use_bigint_args_v.IsUndefined()) {
    if (!use_bigint_args_v.IsBoolean()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env,
          "The \"options.useBigIntArguments\" argument must be a boolean.");
      return env.Undefined();
    }
    use_bigint_args = use_bigint_args_v.As<Napi::Boolean>().Value();
  }

  bool varargs = false;
  Napi::Value varargs_v = options.Get("varargs");
  if (!varargs_v.IsUndefined()) {
    if (!varargs_v.IsBoolean()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options.varargs\" argument must be a boolean.");
      return env.Undefined();
    }
    varargs = varargs_v.As<Napi::Boolean>().Value();
  }

  bool deterministic = false;
  // Note: deterministic is handled via sqlite flags but Node.js
  // doesn't seem to validate it separately for aggregates

  bool direct_only = false;
  Napi::Value direct_only_v = options.Get("directOnly");
  if (!direct_only_v.IsUndefined()) {
    if (!direct_only_v.IsBoolean()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options.directOnly\" argument must be a boolean.");
      return env.Undefined();
    }
    direct_only = direct_only_v.As<Napi::Boolean>().Value();
  }

  // Parse inverse function (optional)
  Napi::Function inverse_fn;
  Napi::Value inverse_v = options.Get("inverse");
  if (!inverse_v.IsUndefined()) {
    if (!inverse_v.IsFunction()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options.inverse\" argument must be a function.");
      return env.Undefined();
    }
    inverse_fn = inverse_v.As<Napi::Function>();
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
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "configure extension loading")) {
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
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "load extension")) {
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
  // Extension entry points receive this connection and may execute SQL that
  // invokes its authorizer. Start a fresh deferred-error scope and consume it
  // even when the extension ignores the SQL error and reports successful init.
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);
  char *errmsg = nullptr;
  int result =
      sqlite3_load_extension(connection(), path.c_str(), entry_point, &errmsg);

  if (HasDeferredAuthorizerException()) {
    if (errmsg != nullptr) {
      sqlite3_free(errmsg);
    }
    RethrowDeferredAuthorizerException();
    return env.Undefined();
  }

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

Napi::Value DatabaseSync::EnableDefensive(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "configure defensive mode")) {
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"active\" argument must be a boolean.");
    return env.Undefined();
  }

  int enable = info[0].As<Napi::Boolean>().Value() ? 1 : 0;
  int defensive_enabled;
  int result = sqlite3_db_config(connection(), SQLITE_DBCONFIG_DEFENSIVE,
                                 enable, &defensive_enabled);
  if (result != SQLITE_OK) {
    node::ThrowEnhancedSqliteError(env, connection(), result,
                                   "Failed to set defensive mode");
  }

  return env.Undefined();
}

Napi::Value DatabaseSync::CreateSession(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "create session")) {
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
      // Clear the session pointer but KEEP database_ so we can detect
      // "database closed" vs "session closed" in Session methods
      session->session_ = nullptr;
      // Note: Don't null database_ - we need it to check IsOpen()
    }
  }
}

void DatabaseSync::AddBackup(BackupJob *backup) {
  std::lock_guard<std::mutex> lock(backups_mutex_);
  backups_.insert(backup);
}

void DatabaseSync::RemoveBackup(BackupJob *backup) {
  std::lock_guard<std::mutex> lock(backups_mutex_);
  backups_.erase(backup);
}

void DatabaseSync::FinalizeBackups() {
  // Copy the set while holding the lock, then release before cleanup
  // This prevents deadlock if destructor calls RemoveBackup
  std::set<BackupJob *> backups_copy;
  {
    std::lock_guard<std::mutex> lock(backups_mutex_);
    backups_copy = backups_;
    backups_.clear(); // Clear now to prevent destructor issues
  }

  // Clean up each active backup without holding the lock
  // We clear source_ to prevent the destructor from trying to
  // RemoveBackup (the set is already empty anyway)
  for (auto *backup : backups_copy) {
    backup->ClearSource(); // Prevent RemoveBackup call in destructor
    backup->Cleanup();
  }
}

void DatabaseSync::TrackStatement(StatementSync *stmt) {
  std::lock_guard<std::mutex> lock(statements_mutex_);
  statements_.insert(stmt);
}

void DatabaseSync::UntrackStatement(StatementSync *stmt) {
  std::lock_guard<std::mutex> lock(statements_mutex_);
  statements_.erase(stmt);
}

void DatabaseSync::FinalizeStatements() {
  // Copy the set under lock then drain it; FinalizeFromDatabase nulls each
  // statement's database_ so its destructor will not call UntrackStatement.
  std::set<StatementSync *> statements_copy;
  {
    std::lock_guard<std::mutex> lock(statements_mutex_);
    statements_copy = statements_;
    statements_.clear();
  }

  for (auto *stmt : statements_copy) {
    stmt->FinalizeFromDatabase();
  }
}

// Context structure for changeset callbacks to avoid global state
struct ChangesetCallbacks {
  std::function<int(int)> conflictCallback;
  std::function<bool(std::string)> filterCallback;
  Napi::Env env;
  // Store pending exception for re-throwing after SQLite call
  std::string pendingExceptionMessage;
  bool hasPendingException = false;
};

// Helper to extract error message from Napi::Error
// Handles both Error objects (use .message property) and primitive throws.
// For GetAndClearPendingException(), err.Value() returns the ORIGINAL thrown
// value - if JS throws "string", Value() IS the string, not a wrapper.
// See: node-addon-api/test/error.cc line 306-310 (CatchError function)
static std::string GetErrorMessage(const Napi::Error &err,
                                   const char *fallback) {
  // Try 1: Message() works for Error objects with .message property
  try {
    std::string msg = err.Message();
    if (!msg.empty()) {
      return msg;
    }
  } catch (...) {
    // Message() failed, continue trying
  }

  // Try 2: For primitives or when Message() is empty, err.Value() returns
  // the original thrown value. Just convert it to string directly.
  // This works for: throw "string", throw 42, throw new Error("msg")
  try {
    Napi::Value val = err.Value();
    if (!val.IsEmpty() && !val.IsUndefined() && !val.IsNull()) {
      return val.ToString().Utf8Value();
    }
  } catch (...) {
    // Value() or ToString() failed, continue
  }

  // Try 3: For C++ catch blocks, check ERROR_WRAP_VALUE property
  // (only relevant when catching Napi::Error as C++ exception)
  try {
    Napi::Value val = err.Value();
    if (val.IsObject()) {
      Napi::Object errObj = val.As<Napi::Object>();
      static const char *ERROR_WRAP_VALUE =
          "4bda9e7e-4913-4dbc-95de-891cbf66598e-errorVal";
      Napi::Value wrapped = errObj.Get(ERROR_WRAP_VALUE);
      if (!wrapped.IsUndefined()) {
        return wrapped.ToString().Utf8Value();
      }
    }
  } catch (...) {
    // Property access failed, continue
  }

  return fallback;
}

static int xConflict(void *pCtx, int eConflict, sqlite3_changeset_iter *pIter) {
  if (!pCtx)
    return SQLITE_CHANGESET_ABORT;
  ChangesetCallbacks *callbacks = static_cast<ChangesetCallbacks *>(pCtx);
  if (!callbacks->conflictCallback)
    return SQLITE_CHANGESET_ABORT;
  return callbacks->conflictCallback(eConflict);
}

static int xFilter(void *pCtx, const char *zTab) {
  if (!pCtx)
    return 1;
  ChangesetCallbacks *callbacks = static_cast<ChangesetCallbacks *>(pCtx);
  // Skip filter callback if we already have a pending exception
  if (callbacks->hasPendingException)
    return 0;
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

  if (ThrowIfInAuthorizerCallback(env, "apply changeset")) {
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsTypedArray()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"changeset\" argument must be a Uint8Array.");
    return env.Undefined();
  }

  // Create callback context to avoid global state
  ChangesetCallbacks callbacks{nullptr, nullptr, env, "", false};

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
        callbacks.conflictCallback = [&callbacks, env,
                                      conflictFunc](int conflictType) -> int {
          // Wrap in try-catch to prevent C++ exceptions from propagating
          // through C callback boundary into SQLite (causes SIGSEGV)
          try {
            // Skip callback if we already have a pending exception
            if (callbacks.hasPendingException)
              return SQLITE_CHANGESET_ABORT;

            Napi::HandleScope scope(env);
            Napi::Value result =
                conflictFunc.Call({Napi::Number::New(env, conflictType)});

            // Check for exception - Call() may have thrown
            if (env.IsExceptionPending()) {
              Napi::Error err = env.GetAndClearPendingException();
              callbacks.pendingExceptionMessage = GetErrorMessage(
                  err, "onConflict callback threw an exception");
              callbacks.hasPendingException = true;
              return SQLITE_CHANGESET_ABORT;
            }

            // Check for empty result (another exception indicator)
            if (result.IsEmpty()) {
              callbacks.pendingExceptionMessage = "Callback threw an exception";
              callbacks.hasPendingException = true;
              return SQLITE_CHANGESET_ABORT;
            }

            // Return -1 (invalid value) for non-integer results
            // This makes SQLite return SQLITE_MISUSE
            if (!result.IsNumber()) {
              return -1;
            }

            return result.As<Napi::Number>().Int32Value();
          } catch (const Napi::Error &e) {
            // Catch Napi::Error specifically (inherits from std::exception)
            callbacks.pendingExceptionMessage =
                GetErrorMessage(e, "onConflict callback threw an exception");
            callbacks.hasPendingException = true;
            return SQLITE_CHANGESET_ABORT;
          } catch (const std::exception &e) {
            // Catch non-Napi C++ exceptions (e.g., SqliteException)
            callbacks.pendingExceptionMessage =
                std::string("C++ exception in onConflict: ") + e.what();
            callbacks.hasPendingException = true;
            return SQLITE_CHANGESET_ABORT;
          } catch (...) {
            // Catch all other exceptions
            if (env.IsExceptionPending()) {
              Napi::Error err = env.GetAndClearPendingException();
              callbacks.pendingExceptionMessage =
                  GetErrorMessage(err, "Exception in onConflict callback");
            } else {
              callbacks.pendingExceptionMessage =
                  "Unknown exception in onConflict callback";
            }
            callbacks.hasPendingException = true;
            return SQLITE_CHANGESET_ABORT;
          }
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
      callbacks.filterCallback = [&callbacks, env,
                                  filterFunc](std::string tableName) -> bool {
        // Wrap in try-catch to prevent C++ exceptions from propagating
        // through C callback boundary into SQLite (causes SIGSEGV)
        try {
          // Skip callback if we already have a pending exception
          if (callbacks.hasPendingException)
            return false;

          Napi::HandleScope scope(env);
          Napi::Value result =
              filterFunc.Call({Napi::String::New(env, tableName)});

          // Check for exception - Call() may have thrown
          if (env.IsExceptionPending()) {
            Napi::Error err = env.GetAndClearPendingException();
            callbacks.pendingExceptionMessage =
                GetErrorMessage(err, "Filter callback threw an exception");
            callbacks.hasPendingException = true;
            return false;
          }

          // Check for empty result (another exception indicator)
          if (result.IsEmpty()) {
            callbacks.pendingExceptionMessage =
                "Filter callback threw an exception";
            callbacks.hasPendingException = true;
            return false;
          }

          return result.ToBoolean().Value();
        } catch (const Napi::Error &e) {
          // Catch Napi::Error specifically (inherits from std::exception)
          callbacks.pendingExceptionMessage =
              GetErrorMessage(e, "Filter callback threw an exception");
          callbacks.hasPendingException = true;
          return false;
        } catch (const std::exception &e) {
          // Catch non-Napi C++ exceptions (e.g., SqliteException)
          callbacks.pendingExceptionMessage =
              std::string("C++ exception in filter: ") + e.what();
          callbacks.hasPendingException = true;
          return false;
        } catch (...) {
          // Catch all other exceptions
          if (env.IsExceptionPending()) {
            Napi::Error err = env.GetAndClearPendingException();
            callbacks.pendingExceptionMessage =
                GetErrorMessage(err, "Exception in filter callback");
          } else {
            callbacks.pendingExceptionMessage =
                "Unknown exception in filter callback";
          }
          callbacks.hasPendingException = true;
          return false;
        }
      };
    }
  }

  // Get the changeset data from TypedArray (Uint8Array or Buffer)
  Napi::TypedArray typed_array = info[0].As<Napi::TypedArray>();
  Napi::ArrayBuffer array_buffer = typed_array.ArrayBuffer();
  size_t byte_offset = typed_array.ByteOffset();
  size_t byte_length = typed_array.ByteLength();
  uint8_t *data = static_cast<uint8_t *>(array_buffer.Data()) + byte_offset;

  // sqlite3changeset_apply runs internal SQL that can invoke the authorizer.
  // Start a fresh deferred-error scope for this outer SQLite call.
  ClearDeferredAuthorizerException();
  SetIgnoreNextSQLiteError(false);

  // Apply the changeset with context instead of global state
  int r = sqlite3changeset_apply(connection(), static_cast<int>(byte_length),
                                 data, xFilter, xConflict, &callbacks);

  // SQLite cleanup SQL runs after filter/conflict callbacks. Match Node's
  // last-exception-wins behavior by surfacing a later authorizer exception
  // before an earlier callback exception.
  if (HasDeferredAuthorizerException()) {
    RethrowDeferredAuthorizerException();
    return env.Undefined();
  }

  // Check for pending exception from callbacks - re-throw it
  if (callbacks.hasPendingException) {
    SetIgnoreNextSQLiteError(false);
    Napi::Error::New(env, callbacks.pendingExceptionMessage)
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (r == SQLITE_OK) {
    return Napi::Boolean::New(env, true);
  }

  if (r == SQLITE_ABORT) {
    // Not an error, just means the operation was aborted
    return Napi::Boolean::New(env, false);
  }

  // Other errors - use enhanced error with errcode property
  const char *errMsg = sqlite3_errmsg(connection());
  node::ThrowEnhancedSqliteError(env, connection(), r, errMsg);
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
       InstanceMethod("setReadBigInts", &StatementSync::SetReadBigInts),
       InstanceMethod("setReturnArrays", &StatementSync::SetReturnArrays),
       InstanceMethod("setAllowBareNamedParameters",
                      &StatementSync::SetAllowBareNamedParameters),
       InstanceMethod("setAllowUnknownNamedParameters",
                      &StatementSync::SetAllowUnknownNamedParameters),
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
    throw std::runtime_error("database is not open");
  }

  database_ = database;
  database->TrackStatement(this);
  source_sql_ = sql;

  // Apply database-level defaults
  use_big_ints_ = database->config_.get_read_big_ints();
  return_arrays_ = database->config_.get_return_arrays();
  allow_bare_named_params_ = database->config_.get_allow_bare_named_params();
  allow_unknown_named_params_ =
      database->config_.get_allow_unknown_named_params();

  // Prepare the statement
  const char *tail = nullptr;
  int result;
  {
    database->EnterStatementStep();
    result = sqlite3_prepare_v2(database->connection(), sql.c_str(), -1,
                                &statement_, &tail);
    database->LeaveStatementStep();
  }

  if (result != SQLITE_OK) {
    // Handle deferred authorizer exceptions:
    //
    // When an authorizer callback throws a JavaScript exception, we use a
    // "marker" exception pattern to safely propagate the error:
    //
    // 1. On Windows (MSVC), std::exception::what() can sometimes return an
    //    empty string, causing message loss.
    //
    // 2. DatabaseSync holds Napi::Error's persistent reference until this
    //    SQLite call unwinds, preserving the exact thrown JavaScript value.
    //
    // 3. This matches Node.js's behavior where JavaScript exceptions from
    //    authorizer callbacks propagate correctly to the caller.
    if (database->HasDeferredAuthorizerException()) {
      // Throw a marker exception; the exact JavaScript error is retained by
      // DatabaseSync and rethrown by Prepare().
      throw std::runtime_error("");
    }
    // Use sqlite3_errmsg directly without prefix - matches Node.js error format
    std::string error = sqlite3_errmsg(database->connection());
    // Use SqliteException to capture error info - avoids Windows ARM ABI issues
    // with std::runtime_error::what() returning corrupted strings
    throw SqliteException(database->connection(), result, error);
  }
}

StatementSync::~StatementSync() {
  // If database_ is non-null, the database is still alive and tracking us;
  // remove ourselves from its set. When the database is torn down it nulls
  // database_ via FinalizeFromDatabase() before destruction, so we never
  // call back into a freed DatabaseSync. This pattern avoids N-API Reset()
  // calls during GC, which caused JIT corruption on Alpine/musl.
  // See: commit 4da0638, nodejs/node-addon-api#660
  if (database_) {
    database_->UntrackStatement(this);
  }
  if (statement_ && !finalized_) {
    sqlite3_finalize(statement_);
  }
}

void StatementSync::FinalizeFromDatabase() {
  if (statement_ && !finalized_) {
    sqlite3_finalize(statement_);
  }
  statement_ = nullptr;
  finalized_ = true;
  // Detach from database so ~StatementSync will not call UntrackStatement
  // back into a database that is being torn down or has already cleared
  // its tracking set.
  database_ = nullptr;
}

inline int StatementSync::ResetStatement() {
  reset_generation_++;
  return sqlite3_reset(statement_);
}

Napi::Value StatementSync::Run(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return env.Undefined();
  }

  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  try {
    Reset();
    BindParameters(info);

    // Check if BindParameters set a pending exception
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }

    // Execute the statement
    {
      StepGuard guard(this);
      sqlite3_step(statement_);
    }
    // Reset immediately after step to ensure sqlite3_changes() returns
    // correct value. This fixes an issue where RETURNING queries would
    // report changes: 0 on the first call.
    // See: https://github.com/nodejs/node/issues/57344
    int result = ResetStatement();

    if (result != SQLITE_OK) {
      std::string error = sqlite3_errmsg(database_->connection());
      ThrowEnhancedSqliteErrorWithDB(env, database_, database_->connection(),
                                     result, error);
      return env.Undefined();
    }

    // Create result object
    Napi::Object result_obj = Napi::Object::New(env);

    // Get changes and lastInsertRowid
    int changes = sqlite3_changes(database_->connection());
    sqlite3_int64 last_rowid =
        sqlite3_last_insert_rowid(database_->connection());

    // When readBigInts is true, return BigInt for both (matches Node.js)
    if (use_big_ints_) {
      result_obj.Set("changes",
                     Napi::BigInt::New(env, static_cast<int64_t>(changes)));
      result_obj.Set("lastInsertRowid",
                     Napi::BigInt::New(env, static_cast<int64_t>(last_rowid)));
    } else if (last_rowid > JS_MAX_SAFE_INTEGER ||
               last_rowid < JS_MIN_SAFE_INTEGER) {
      // Use JavaScript's safe integer limits (2^53 - 1)
      result_obj.Set("changes", Napi::Number::New(env, changes));
      result_obj.Set("lastInsertRowid",
                     Napi::BigInt::New(env, static_cast<int64_t>(last_rowid)));
    } else {
      result_obj.Set("changes", Napi::Number::New(env, changes));
      result_obj.Set("lastInsertRowid",
                     Napi::Number::New(env, static_cast<double>(last_rowid)));
    }

    return result_obj;
  } catch (const std::exception &e) {
    ThrowErrSqliteErrorWithDb(env, database_, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::Get(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return env.Undefined();
  }

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return env.Undefined();
  }

  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  try {
    Reset();
    BindParameters(info);

    // Check if BindParameters set a pending exception
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }

    int result;
    {
      StepGuard guard(this);
      result = sqlite3_step(statement_);
    }

    if (result == SQLITE_ROW) {
      Napi::Value value = CreateResult();
      // Reset statement after fetching result to release locks (like Node.js
      // OnScopeLeave)
      ResetStatement();
      return value;
    } else if (result == SQLITE_DONE) {
      // Reset statement to release locks even when no rows returned
      ResetStatement();
      return env.Undefined();
    } else {
      // Reset statement before throwing to release locks
      ResetStatement();
      std::string error = sqlite3_errmsg(database_->connection());
      ThrowEnhancedSqliteErrorWithDB(env, database_, database_->connection(),
                                     result, error);
      return env.Undefined();
    }
  } catch (const std::exception &e) {
    // Reset statement on exception to release locks
    ResetStatement();
    ThrowErrSqliteErrorWithDb(env, database_, e.what());
    return env.Undefined();
  }
}

Napi::Value StatementSync::All(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return env.Undefined();
  }

  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  try {
    Reset();
    BindParameters(info);

    // Check if BindParameters set a pending exception
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }

    Napi::Array results = Napi::Array::New(env);
    uint32_t index = 0;

    // Column metadata (count + object-mode keys) is resolved once, lazily, on
    // the first row. Doing it after the first successful step means the values
    // reflect any auto-reprepare, and the key strings are built once and reused
    // for every row rather than recreated per column per row.
    int column_count = 0;
    std::vector<napi_value> keys;
    bool row_meta_ready = false;

    // Held across the whole row loop: a user function invoked by any step
    // must not be able to re-enter this statement until the loop unwinds.
    StepGuard guard(this);
    while (true) {
      int result = sqlite3_step(statement_);

      if (result == SQLITE_ROW) {
        if (!row_meta_ready) {
          column_count = sqlite3_column_count(statement_);
          if (!return_arrays_ && !BuildColumnKeys(env, column_count, &keys)) {
            ResetStatement();
            return env.Undefined();
          }
          row_meta_ready = true;
        }
        Napi::Value row = BuildRow(env, column_count, &keys);
        // BuildRow can set a pending exception (e.g. an integer outside the
        // safe range); stop stepping and let it propagate.
        if (env.IsExceptionPending()) {
          ResetStatement();
          return env.Undefined();
        }
        results.Set(index++, row);
      } else if (result == SQLITE_DONE) {
        // Reset statement to release locks (like Node.js OnScopeLeave)
        ResetStatement();
        break;
      } else {
        // Reset statement before throwing to release locks
        ResetStatement();
        std::string error = sqlite3_errmsg(database_->connection());
        ThrowEnhancedSqliteErrorWithDB(env, database_, database_->connection(),
                                       result, error);
        return env.Undefined();
      }
    }

    return results;
  } catch (const std::exception &e) {
    // Reset statement on exception to release locks
    ResetStatement();
    ThrowErrSqliteErrorWithDb(env, database_, e.what());
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

  if (database_->ThrowIfInAuthorizerCallback(info.Env(), "step statement")) {
    return info.Env().Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(info.Env(),
                                  "Statement is not properly initialized");
    return info.Env().Undefined();
  }

  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(info.Env(),
                                  "statement is currently being executed");
    return info.Env().Undefined();
  }

  // Reset the statement first
  int r = ResetStatement();
  if (r != SQLITE_OK) {
    node::THROW_ERR_SQLITE_ERROR(info.Env(),
                                 sqlite3_errmsg(database_->connection()));
    return info.Env().Undefined();
  }

  // Bind parameters if provided
  BindParameters(info, 0);

  // Check if BindParameters set a pending exception
  if (info.Env().IsExceptionPending()) {
    return info.Env().Undefined();
  }

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

Napi::Value StatementSync::Dispose(const Napi::CallbackInfo &info) {
  // Try to finalize, but ignore errors during disposal (matches Node.js v25
  // behavior)
  try {
    if (statement_ && !finalized_) {
      sqlite3_finalize(statement_);
      statement_ = nullptr;
      finalized_ = true;
    }
  } catch (...) {
    // Ignore errors during disposal
  }
  return info.Env().Undefined();
}

Napi::Value StatementSync::SourceSQLGetter(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), source_sql_);
}

Napi::Value StatementSync::ExpandedSQLGetter(const Napi::CallbackInfo &info) {
  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "statement has been finalized");
    return info.Env().Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(info.Env(), "Database connection is closed");
    return info.Env().Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(info.Env(),
                                             "expand statement SQL")) {
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

Napi::Value StatementSync::FinalizedGetter(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), finalized_);
}

Napi::Value StatementSync::SetReadBigInts(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  // Mutating result-shaping config while the statement is mid-step would
  // desync the in-flight all()/toArray() loop from its cached column keys
  // (an object-mode BuildRow would index a key vector that was never built),
  // so reject re-entrant mutation exactly like the stepping operations do.
  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
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
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  // A returnArrays flip mid-step is the memory-safety case: All()/ToArray()
  // build the object-mode column-key vector once, lazily, and only when
  // return_arrays_ was false at that point. Flipping to object mode afterward
  // makes BuildRow index an empty vector (OOB read). Reject it like the other
  // re-entrant statement mutations.
  //
  // NOTE: this is an INTENTIONAL divergence from node:sqlite, whose setters
  // (setReturnArrays/setReadBigInts/setAllow*) permit mutation from callbacks
  // invoked while the statement is stepping. Upstream snapshots result-shaping
  // modes for all()/get()/run(), so a mutation there affects later operations;
  // iterator rows read the live modes after each step. We freeze all config
  // setters instead, both to prevent the cached-key OOB above and to provide
  // one consistent contract. The remaining setters guard for consistency, not
  // memory safety.
  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
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
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  // No statement mutation is allowed while a step is on the stack (see the
  // matching guard in SetReturnArrays); keep all config setters consistent.
  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
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

Napi::Value
StatementSync::SetAllowUnknownNamedParameters(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  // No statement mutation is allowed while a step is on the stack (see the
  // matching guard in SetReturnArrays); keep all config setters consistent.
  if (stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"enabled\" argument must be a boolean.");
    return env.Undefined();
  }

  allow_unknown_named_params_ = info[0].As<Napi::Boolean>().Value();
  return env.Undefined();
}

Napi::Value StatementSync::Columns(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // When database is closed, statement is implicitly finalized by SQLite
  if (finalized_ || !database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "read statement columns")) {
    return env.Undefined();
  }

  if (!statement_) {
    node::THROW_ERR_INVALID_STATE(env, "Statement is not properly initialized");
    return env.Undefined();
  }

  int column_count = sqlite3_column_count(statement_);
  Napi::Array columns = Napi::Array::New(env, column_count);

  for (int i = 0; i < column_count; i++) {
    Napi::Object column_info = CreateObjectWithNullPrototype(env);

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
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
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

  // Track where positional parameters start
  size_t positional_start = start_index;

  // Check if first argument is an object for named parameters
  // (not a Buffer, TypedArray, or Array - those are positional values)
  if (info.Length() > start_index && info[start_index].IsObject() &&
      !info[start_index].IsBuffer() && !info[start_index].IsArray() &&
      !info[start_index].IsTypedArray()) {
    // Named parameters binding from the object
    Napi::Object obj = info[start_index].As<Napi::Object>();
    positional_start =
        start_index + 1; // Positional args start after the object

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
        BindSingleParameter(param_index, value);
        // Check for pending exceptions set by THROW_ERR_* macros
        // (they use ThrowAsJavaScriptException which doesn't throw C++
        // exceptions)
        if (env.IsExceptionPending()) {
          return;
        }
      } else {
        // Unknown named parameter
        if (allow_unknown_named_params_) {
          // Skip unknown parameters when allowed (matches Node.js v25 behavior)
          continue;
        } else {
          // Throw error when not allowed (default behavior)
          std::string msg = "Unknown named parameter '" + key_str + "'";
          node::THROW_ERR_INVALID_STATE(env, msg.c_str());
          return;
        }
      }
    }
  }

  // Bind remaining positional parameters to anonymous placeholders (?)
  // This handles both: (a) all args are positional, (b) first arg was named
  // params object and remaining are positional
  if (positional_start < info.Length()) {
    int anon_idx = 1;
    int param_count = sqlite3_bind_parameter_count(statement_);

    for (size_t i = positional_start; i < info.Length(); i++) {
      // Skip to the next anonymous placeholder (unnamed or ?NNN)
      while (anon_idx <= param_count) {
        const char *param_name =
            sqlite3_bind_parameter_name(statement_, anon_idx);
        // Anonymous placeholders have nullptr name or start with '?'
        if (param_name == nullptr || param_name[0] == '?') {
          break;
        }
        anon_idx++;
      }

      // When anon_idx > param_count, SQLite will return SQLITE_RANGE
      // and we'll throw an appropriate ERR_SQLITE_ERROR

      BindSingleParameter(anon_idx, info[i]);
      // Check for pending exceptions set by THROW_ERR_* macros
      if (env.IsExceptionPending()) {
        return;
      }
      anon_idx++;
    }
  }
}

void StatementSync::BindSingleParameter(int param_index, Napi::Value param) {
  // Safety check - statement_ should be valid if we got here
  if (!statement_ || finalized_) {
    return; // Silent return since error was already thrown by caller
  }

  int rc = SQLITE_OK;

  try {
    if (param.IsNull()) {
      rc = sqlite3_bind_null(statement_, param_index);
    } else if (param.IsUndefined()) {
      // Node.js throws for undefined (unlike null which binds as SQL NULL)
      node::THROW_ERR_INVALID_ARG_TYPE(
          Env(), ("Provided value cannot be bound to SQLite parameter " +
                  std::to_string(param_index) + ".")
                     .c_str());
      return;
    } else if (param.IsBigInt()) {
      // Handle BigInt before IsNumber since BigInt values should bind as int64
      bool lossless;
      int64_t bigint_val = param.As<Napi::BigInt>().Int64Value(&lossless);
      if (lossless) {
        rc = sqlite3_bind_int64(statement_, param_index,
                                static_cast<sqlite3_int64>(bigint_val));
      } else {
        // BigInt too large for SQLite int64 - throw error (matches Node.js)
        node::THROW_ERR_INVALID_ARG_VALUE(Env(),
                                          "BigInt value is too large to bind.");
        return;
      }
    } else if (param.IsNumber()) {
      double val = param.As<Napi::Number>().DoubleValue();
      if (std::abs(val - std::floor(val)) <
              std::numeric_limits<double>::epsilon() &&
          val >= INT32_MIN && val <= INT32_MAX) {
        rc = sqlite3_bind_int(statement_, param_index,
                              param.As<Napi::Number>().Int32Value());
      } else {
        rc = sqlite3_bind_double(statement_, param_index,
                                 param.As<Napi::Number>().DoubleValue());
      }
    } else if (param.IsString()) {
      std::string str = param.As<Napi::String>().Utf8Value();
      rc = sqlite3_bind_text(statement_, param_index, str.c_str(), -1,
                             SQLITE_TRANSIENT);
    } else if (param.IsBoolean()) {
      rc = sqlite3_bind_int(statement_, param_index,
                            param.As<Napi::Boolean>().Value() ? 1 : 0);
    } else if (param.IsDataView()) {
      // IMPORTANT: Check DataView BEFORE IsBuffer() because N-API's IsBuffer()
      // returns true for ALL ArrayBufferViews (including DataView), but
      // Buffer::As() doesn't work correctly for DataView (returns length=0).
      Napi::DataView dataView = param.As<Napi::DataView>();
      Napi::ArrayBuffer arrayBuffer = dataView.ArrayBuffer();
      size_t byteOffset = dataView.ByteOffset();
      size_t byteLength = dataView.ByteLength();
      // Use non-NULL pointer for zero-length blobs to preserve BLOB vs NULL
      // distinction. See: https://sqlite.org/c3ref/bind_blob.html
      const void *data = nullptr;
      if (arrayBuffer.Data() != nullptr && byteLength > 0) {
        data = static_cast<const uint8_t *>(arrayBuffer.Data()) + byteOffset;
      }
      rc = sqlite3_bind_blob(statement_, param_index, data ? data : "",
                             SafeCastToInt(byteLength), SQLITE_TRANSIENT);
    } else if (param.IsBuffer()) {
      // Handles Buffer and TypedArray (both are ArrayBufferViews that work
      // correctly with Buffer cast - Buffer::Data() handles byte offsets
      // internally)
      Napi::Buffer<uint8_t> buffer = param.As<Napi::Buffer<uint8_t>>();
      // Use non-NULL pointer for zero-length blobs to preserve BLOB vs NULL
      // distinction. See: https://sqlite.org/c3ref/bind_blob.html
      const void *data = buffer.Data();
      rc = sqlite3_bind_blob(statement_, param_index, data ? data : "",
                             SafeCastToInt(buffer.Length()), SQLITE_TRANSIENT);
    } else if (param.IsFunction()) {
      // Functions cannot be bound to SQLite parameters - throw error
      node::THROW_ERR_INVALID_ARG_TYPE(
          Env(), ("Provided value cannot be bound to SQLite parameter " +
                  std::to_string(param_index) + ".")
                     .c_str());
      return;
    } else if (param.IsArrayBuffer()) {
      // Handle ArrayBuffer as binary data
      Napi::ArrayBuffer arrayBuffer = param.As<Napi::ArrayBuffer>();
      // Use non-NULL pointer for zero-length blobs to preserve BLOB vs NULL
      // distinction. See: https://sqlite.org/c3ref/bind_blob.html
      const void *data = arrayBuffer.Data();
      rc = sqlite3_bind_blob(statement_, param_index, data ? data : "",
                             SafeCastToInt(arrayBuffer.ByteLength()),
                             SQLITE_TRANSIENT);
    } else if (param.IsObject()) {
      // Objects and arrays cannot be bound to SQLite parameters (same as
      // Node.js behavior). Note: DataView, Buffer, TypedArray, and ArrayBuffer
      // are handled above and don't reach this branch.
      node::THROW_ERR_INVALID_ARG_TYPE(
          Env(), ("Provided value cannot be bound to SQLite parameter " +
                  std::to_string(param_index) + ".")
                     .c_str());
      return;
    } else {
      // For any other type (Symbol, etc.), throw error like Node.js does
      node::THROW_ERR_INVALID_ARG_TYPE(
          Env(), ("Provided value cannot be bound to SQLite parameter " +
                  std::to_string(param_index) + ".")
                     .c_str());
      return;
    }

    // Check the result of sqlite3_bind_*
    if (rc != SQLITE_OK) {
      sqlite3 *db_handle = database_ ? database_->connection() : nullptr;
      // Get the error message from SQLite
      const char *err_msg = sqlite3_errstr(rc);
      node::ThrowEnhancedSqliteError(Env(), db_handle, rc,
                                     err_msg ? err_msg : "SQLite error");
      return;
    }
  } catch (const Napi::Error &e) {
    // Re-throw Napi errors
    throw;
  } catch (const std::exception &e) {
    // Convert standard exceptions to Napi errors
    throw Napi::Error::New(Env(), e.what());
  }
}

// Converts one column of the current row into a JS value written to *out.
// Shared by both the array and object result paths. Returns false with a
// pending ERR_OUT_OF_RANGE exception ONLY for the integer-out-of-safe-range
// case; every other branch writes *out and returns true. Returning a bool lets
// BuildRow drop a per-column env.IsExceptionPending() N-API call.
bool StatementSync::GetColumnValue(Napi::Env env, int i, int column_type,
                                   napi_value *out) {
  switch (column_type) {
  case SQLITE_NULL:
    *out = env.Null();
    return true;
  case SQLITE_INTEGER: {
    sqlite3_int64 int_val = sqlite3_column_int64(statement_, i);
    if (use_big_ints_) {
      // Always return BigInt when readBigInts is true
      *out = Napi::BigInt::New(env, static_cast<int64_t>(int_val));
      return true;
    }
    if (int_val > JS_MAX_SAFE_INTEGER || int_val < JS_MIN_SAFE_INTEGER) {
      // Throw ERR_OUT_OF_RANGE for values outside safe integer range
      // (matches Node.js behavior). This is the sole false-returning branch.
      char error_msg[128];
      snprintf(error_msg, sizeof(error_msg),
               "Value is too large to be represented as a JavaScript "
               "number: %" PRId64,
               static_cast<int64_t>(int_val));
      node::THROW_ERR_OUT_OF_RANGE(env, error_msg);
      return false;
    }
    *out = Napi::Number::New(env, static_cast<double>(int_val));
    return true;
  }
  case SQLITE_FLOAT:
    *out = Napi::Number::New(env, sqlite3_column_double(statement_, i));
    return true;
  case SQLITE_TEXT: {
    const unsigned char *text = sqlite3_column_text(statement_, i);
    // sqlite3_column_text() can return NULL on OOM or encoding errors
    if (!text) {
      *out = Napi::String::New(env, "");
      return true;
    }
    // Pass the byte length (valid to read after column_text) so N-API skips a
    // strlen over the value.
    int byte_len = sqlite3_column_bytes(statement_, i);
    *out = Napi::String::New(env, reinterpret_cast<const char *>(text),
                             static_cast<size_t>(byte_len));
    return true;
  }
  case SQLITE_BLOB: {
    const void *blob_data = sqlite3_column_blob(statement_, i);
    int blob_size = sqlite3_column_bytes(statement_, i);
    // sqlite3_column_blob() can return NULL for zero-length BLOBs or on OOM.
    // Return Uint8Array to match Node.js node:sqlite behavior.
    if (!blob_data || blob_size == 0) {
      auto array_buffer = Napi::ArrayBuffer::New(env, 0);
      *out = Napi::Uint8Array::New(env, 0, array_buffer, 0);
      return true;
    }
    auto array_buffer = Napi::ArrayBuffer::New(env, blob_size);
    memcpy(array_buffer.Data(), blob_data, blob_size);
    *out = Napi::Uint8Array::New(env, blob_size, array_buffer, 0);
    return true;
  }
  default:
    *out = env.Null();
    return true;
  }
}

// Builds the object-mode property-key strings for the current column set into
// `out_keys`. Callers invoke this once per operation (after the first
// successful step, so the names reflect any auto-reprepare) and reuse the
// resulting handles for every row, avoiding a fresh V8 string per column per
// row. The handles are plain locals scoped to the current call; we
// intentionally do not persist them in a Napi::Reference member (see the
// header note about napi_delete_reference / Alpine-musl JIT corruption).
bool StatementSync::BuildColumnKeys(Napi::Env env, int column_count,
                                    std::vector<napi_value> *out_keys) {
  out_keys->resize(column_count);
  for (int i = 0; i < column_count; i++) {
    const char *column_name = sqlite3_column_name(statement_, i);
    if (column_name == nullptr) {
      node::THROW_ERR_INVALID_STATE(env, "Cannot get name of column");
      return false;
    }
    (*out_keys)[i] = Napi::String::New(env, column_name);
  }
  return true;
}

// Builds one JS row from the current step. `keys` may be null: when provided
// (the multi-row all()/toArray() paths) object-mode properties are set with the
// caller's reused key handles, avoiding a fresh V8 string per column per row;
// when null (the single-row get()/next() paths) each property is set straight
// from sqlite3_column_name, which is leaner when there is nothing to amortize.
// `keys` is ignored in array mode.
Napi::Value StatementSync::BuildRow(Napi::Env env, int column_count,
                                    const std::vector<napi_value> *keys) {
  if (return_arrays_) {
    Napi::Array result = Napi::Array::New(env, column_count);
    for (int i = 0; i < column_count; i++) {
      int column_type = sqlite3_column_type(statement_, i);
      napi_value value;
      // GetColumnValue returns false only after setting a pending exception;
      // stop immediately and let the caller (which checks IsExceptionPending)
      // propagate it. Issuing another N-API call here would throw C++.
      if (!GetColumnValue(env, i, column_type, &value)) {
        return env.Undefined();
      }
      result.Set(static_cast<uint32_t>(i), value);
    }
    return result;
  }

  // Return result as object with null prototype (matches Node.js behavior).
  Napi::Object result = CreateObjectWithNullPrototype(env);
  for (int i = 0; i < column_count; i++) {
    int column_type = sqlite3_column_type(statement_, i);
    napi_value value;
    if (!GetColumnValue(env, i, column_type, &value)) {
      return env.Undefined();
    }
    if (keys != nullptr) {
      result.Set((*keys)[i], value);
    } else {
      result.Set(sqlite3_column_name(statement_, i), value);
    }
  }
  return result;
}

Napi::Value StatementSync::CreateResult() {
  Napi::Env env = Env();

  // Safety checks
  if (!statement_ || finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!database_ || !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  // Single-row path (get()/iterator next()): build the row directly from column
  // names. There is only one row, so caching key handles would add overhead
  // without any reuse to amortize it.
  return BuildRow(env, sqlite3_column_count(statement_), nullptr);
}

void StatementSync::Reset() {
  // Safety check
  if (!statement_ || finalized_) {
    return; // Silent return, error should have been caught earlier
  }

  ResetStatement();
  sqlite3_clear_bindings(statement_);
}

// ================================
// StatementSyncIterator Implementation
// ================================

Napi::Object StatementSyncIterator::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func =
      DefineClass(env, "StatementSyncIterator",
                  {InstanceMethod("next", &StatementSyncIterator::Next),
                   InstanceMethod("return", &StatementSyncIterator::Return),
                   InstanceMethod("toArray", &StatementSyncIterator::ToArray)});

  // Set up Symbol.iterator on the prototype to make it properly iterable
  Napi::Object prototype = func.Get("prototype").As<Napi::Object>();
  Napi::Symbol iteratorSymbol = Napi::Symbol::WellKnown(env, "iterator");

  // Add [Symbol.iterator]() { return this; } to make it iterable
  prototype.Set(iteratorSymbol,
                Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
                  return info.This();
                }));

  // Make our iterator inherit from Iterator.prototype so it's an instanceof
  // Iterator and gets Iterator Helper methods (map, filter, etc.)
  Napi::Object global = env.Global();
  Napi::Value iteratorValue = global.Get("Iterator");
  if (iteratorValue.IsFunction()) {
    Napi::Object iteratorProto =
        iteratorValue.As<Napi::Function>().Get("prototype").As<Napi::Object>();
    // Use Object.setPrototypeOf to set Iterator.prototype as prototype
    Napi::Object objectCtor = global.Get("Object").As<Napi::Object>();
    Napi::Function setPrototypeOf =
        objectCtor.Get("setPrototypeOf").As<Napi::Function>();
    setPrototypeOf.Call({prototype, iteratorProto});
  }

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
  statement_reset_generation_ = stmt->reset_generation_;
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

  if (stmt_->database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (statement_reset_generation_ != stmt_->reset_generation_) {
    node::THROW_ERR_INVALID_STATE(env, "iterator was invalidated");
    return env.Undefined();
  }

  if (stmt_->stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  if (done_) {
    Napi::Object result = CreateObjectWithNullPrototype(env);
    result.Set("done", true);
    result.Set("value", env.Null());
    return result;
  }

  int r;
  {
    StatementSync::StepGuard guard(stmt_);
    r = sqlite3_step(stmt_->statement_);
  }

  if (r != SQLITE_ROW) {
    if (r != SQLITE_DONE) {
      std::string error = sqlite3_errmsg(stmt_->database_->connection());
      ThrowEnhancedSqliteErrorWithDB(env, stmt_->database_,
                                     stmt_->database_->connection(), r, error);
      return env.Undefined();
    }

    // End of results
    sqlite3_reset(stmt_->statement_);
    done_ = true;

    Napi::Object result = CreateObjectWithNullPrototype(env);
    result.Set("done", true);
    result.Set("value", env.Null());
    return result;
  }

  // Create row object using existing CreateResult method
  Napi::Value row_value = stmt_->CreateResult();
  // CreateResult can set a pending exception (e.g. an integer outside the safe
  // range); surface it instead of wrapping an undefined value.
  if (env.IsExceptionPending()) {
    return env.Undefined();
  }

  Napi::Object result = CreateObjectWithNullPrototype(env);
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

  if (stmt_->database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (stmt_->stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  // Reset the statement and mark as done
  sqlite3_reset(stmt_->statement_);
  done_ = true;

  Napi::Object result = CreateObjectWithNullPrototype(env);
  result.Set("done", true);
  result.Set("value", env.Null());
  return result;
}

Napi::Value StatementSyncIterator::ToArray(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!stmt_ || stmt_->finalized_) {
    node::THROW_ERR_INVALID_STATE(env, "statement has been finalized");
    return env.Undefined();
  }

  if (!stmt_->database_ || !stmt_->database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "Database connection is closed");
    return env.Undefined();
  }

  if (stmt_->database_->ThrowIfInAuthorizerCallback(env, "step statement")) {
    return env.Undefined();
  }

  if (stmt_->stepping_) {
    node::THROW_ERR_INVALID_STATE(env, "statement is currently being executed");
    return env.Undefined();
  }

  Napi::Array arr = Napi::Array::New(env);
  uint32_t idx = 0;

  // Column metadata is resolved once, lazily, on the first row so the keys are
  // built a single time and reused for every row (see StatementSync::All).
  int column_count = 0;
  std::vector<napi_value> keys;
  bool row_meta_ready = false;

  StatementSync::StepGuard guard(stmt_);
  while (!done_) {
    int r = sqlite3_step(stmt_->statement_);

    if (r != SQLITE_ROW) {
      if (r != SQLITE_DONE) {
        std::string error = sqlite3_errmsg(stmt_->database_->connection());
        ThrowEnhancedSqliteErrorWithDB(
            env, stmt_->database_, stmt_->database_->connection(), r, error);
        return env.Undefined();
      }

      // End of results
      sqlite3_reset(stmt_->statement_);
      done_ = true;
      break;
    }

    if (!row_meta_ready) {
      column_count = sqlite3_column_count(stmt_->statement_);
      if (!stmt_->return_arrays_ &&
          !stmt_->BuildColumnKeys(env, column_count, &keys)) {
        // Release the read lock before surfacing the (OOM) error, matching
        // StatementSync::All's error paths.
        sqlite3_reset(stmt_->statement_);
        return env.Undefined();
      }
      row_meta_ready = true;
    }

    Napi::Value row_value = stmt_->BuildRow(env, column_count, &keys);

    // Check if BuildRow threw an error
    if (env.IsExceptionPending()) {
      return env.Undefined();
    }

    arr.Set(idx++, row_value);
  }

  return arr;
}

// Session Implementation
Napi::Object Session::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func =
      DefineClass(env, "Session",
                  {InstanceMethod("changeset", &Session::Changeset),
                   InstanceMethod("patchset", &Session::Patchset),
                   InstanceMethod("close", &Session::Close),
                   InstanceMethod("dispose", &Session::Dispose)});

  // Store constructor in per-instance addon data instead of static variable
  AddonData *addon_data = GetAddonData(env);
  if (addon_data) {
    addon_data->sessionConstructor = Napi::Reference<Napi::Function>::New(func);
  }

  // Add Symbol.dispose to the prototype (Node.js v25+ compatibility)
  Napi::Value symbolDispose =
      env.Global().Get("Symbol").As<Napi::Object>().Get("dispose");
  if (!symbolDispose.IsUndefined()) {
    func.Get("prototype")
        .As<Napi::Object>()
        .Set(symbolDispose,
             Napi::Function::New(
                 env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                   Session *session =
                       Session::Unwrap(info.This().As<Napi::Object>());
                   return session->Dispose(info);
                 }));
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
  // Note: Keep database_ non-null so we can check if db is open vs session
  // closed
  if (database_) {
    database_->RemoveSession(this);
  }

  // Now it's safe to delete the SQLite session
  sqlite3session_delete(session_to_delete);
}

template <int (*sqliteChangesetFunc)(sqlite3_session *, int *, void **)>
Napi::Value Session::GenericChangeset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Check database first - if db was closed, that's the primary error
  // Note: database_ is preserved in Delete(), so we can check IsOpen()
  if (database_ && !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  // Then check if session was explicitly closed
  if (session_ == nullptr) {
    node::THROW_ERR_INVALID_STATE(env, "session is not open");
    return env.Undefined();
  }

  if (!database_) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "create changeset")) {
    return env.Undefined();
  }

  int nChangeset = 0;
  void *pChangeset = nullptr;

  // Session changeset generation runs internal SAVEPOINT and SELECT SQL that
  // can invoke the authorizer. Start a fresh deferred-error scope for it.
  database_->ClearDeferredAuthorizerException();
  database_->SetIgnoreNextSQLiteError(false);

  int r = sqliteChangesetFunc(session_, &nChangeset, &pChangeset);

  if (database_->HasDeferredAuthorizerException()) {
    // A RELEASE failure can be ignored by SQLite after it has already produced
    // an allocation, so ownership must be discharged before rethrowing.
    if (pChangeset != nullptr) {
      sqlite3_free(pChangeset);
    }
    database_->RethrowDeferredAuthorizerException();
    return env.Undefined();
  }

  if (r != SQLITE_OK) {
    // Use sqlite3_errstr(r) to get a description of the error code,
    // rather than sqlite3_errmsg() which returns the last error on the
    // connection (which may not be related to this session operation)
    const char *errStr = sqlite3_errstr(r);
    Napi::Error::New(env,
                     std::string("Failed to generate changeset: ") + errStr)
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Create a Uint8Array from the changeset data (matches node:sqlite API)
  //
  // A session with no recorded changes returns SQLITE_OK with nChangeset == 0
  // and pChangeset == NULL, and Napi::ArrayBuffer::New(env, 0) hands back a
  // NULL Data() pointer. memcpy() declares both of its pointer parameters
  // __attribute__((nonnull)), so passing NULL is undefined behavior *even when
  // the length is zero* -- and the optimizer is entitled to use that nonnull
  // promise to delete subsequent null checks. Skip the copy for the empty case.
  //
  // Caught by UndefinedBehaviorSanitizer (scripts/sanitizers-test.sh):
  //   sqlite_impl.cpp: runtime error: null pointer passed as argument 1,
  //   which is declared to never be null
  Napi::ArrayBuffer arrayBuffer = Napi::ArrayBuffer::New(env, nChangeset);
  if (nChangeset > 0 && pChangeset != nullptr) {
    std::memcpy(arrayBuffer.Data(), pChangeset, nChangeset);
  }

  // Free the changeset allocated by SQLite
  sqlite3_free(pChangeset);

  return Napi::Uint8Array::New(env, nChangeset, arrayBuffer, 0);
}

Napi::Value Session::Changeset(const Napi::CallbackInfo &info) {
  return GenericChangeset<sqlite3session_changeset>(info);
}

Napi::Value Session::Patchset(const Napi::CallbackInfo &info) {
  return GenericChangeset<sqlite3session_patchset>(info);
}

Napi::Value Session::Close(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Check database first - if db was closed, that's the primary error
  // Note: database_ is preserved in Delete(), so we can check IsOpen()
  if (database_ && !database_->IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  // Then check if session was explicitly closed
  if (session_ == nullptr) {
    node::THROW_ERR_INVALID_STATE(env, "session is not open");
    return env.Undefined();
  }

  if (!database_) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (database_->ThrowIfInAuthorizerCallback(env, "close session")) {
    return env.Undefined();
  }

  Delete();
  return env.Undefined();
}

Napi::Value Session::Dispose(const Napi::CallbackInfo &info) {
  if (database_ && database_->IsOpen() && session_ != nullptr &&
      database_->ThrowIfInAuthorizerCallback(info.Env(), "close session")) {
    return info.Env().Undefined();
  }

  // Try to close, but ignore errors during disposal (matches Node.js v25
  // behavior)
  try {
    if (session_ != nullptr) {
      Delete();
    }
  } catch (...) {
    // Ignore errors during disposal
  }
  return info.Env().Undefined();
}

// Static members for tracking active jobs
std::atomic<int> BackupJob::active_jobs_(0);
std::mutex BackupJob::active_jobs_mutex_;
std::set<BackupJob *> BackupJob::active_job_instances_;

void BackupJob::CleanupHook(void *arg) {
  // Called before environment teardown - safe to Reset() references here
  auto *self = static_cast<BackupJob *>(arg);
  // Signal Execute() on the worker thread to break out of sqlite3_backup_step
  // so we don't drag teardown out, and so OnOK/OnError can short-circuit
  // touching the deferred (which can throw a C++ exception if the env is
  // already torn down).
  self->shutting_down_.store(true, std::memory_order_release);
  if (!self->progress_func_.IsEmpty()) {
    self->progress_func_.Reset();
  }
  // Release the strong reference to the source database now; during teardown
  // the implicit ~ObjectReference in ~BackupJob would be unsafe.
  if (!self->source_ref_.IsEmpty()) {
    self->source_ref_.Reset();
  }
}

// BackupJob Implementation
BackupJob::BackupJob(Napi::Env env, DatabaseSync *source,
                     Napi::Object source_object, std::string destination_path,
                     std::string source_db, std::string dest_db, int pages,
                     Napi::Function progress_func,
                     Napi::Promise::Deferred deferred)
    : Napi::AsyncProgressWorker<BackupProgress>(
          !progress_func.IsEmpty() && !progress_func.IsUndefined()
              ? progress_func
              : Napi::Function::New(env, [](const Napi::CallbackInfo &) {})),
      source_(source),
      // Strong reference keeps the source database (and thus its connection,
      // captured below) alive for the whole backup, even if the caller drops
      // its last JS reference and the GC runs mid-backup.
      source_ref_(Napi::Persistent(source_object)),
      // Capture connection pointer now while we know it's valid
      // This prevents use-after-free if database is closed during backup
      source_connection_(source->connection()),
      destination_path_(std::move(destination_path)),
      source_db_(std::move(source_db)), dest_db_(std::move(dest_db)),
      pages_(pages), has_progress_callback_(!progress_func.IsEmpty() &&
                                            !progress_func.IsUndefined()),
      deferred_(deferred), env_(env) {
  if (has_progress_callback_) {
    progress_func_ = Napi::Reference<Napi::Function>::New(progress_func);
  }

  // Register cleanup hook to Reset() reference before environment teardown.
  // This is required for worker thread support per Node-API best practices.
  // See:
  // https://nodejs.github.io/node-addon-examples/special-topics/context-awareness/
  napi_add_env_cleanup_hook(env_, CleanupHook, this);

  active_jobs_++;
  // Register with database for proper cleanup coordination
  source_->AddBackup(this);
}

BackupJob::~BackupJob() {
  // Remove cleanup hook if still registered
  napi_remove_env_cleanup_hook(env_, CleanupHook, this);

  // Don't call progress_func_.Reset() here - CleanupHook already handled it,
  // or the environment is being torn down and Reset() would be unsafe.

  active_jobs_--;
  // Unregister from database
  // Note: source_ may be null if FinalizeBackups was called
  if (source_) {
    source_->RemoveBackup(this);
  }
}

void BackupJob::Execute(const ExecutionProgress &progress) {
  // This method is executed on a worker thread, not the main thread
  // Note: SQLite backup operations are thread-safe when the source database
  // is only being read. The backup API creates its own read transaction
  // and can safely operate across threads.

  backup_status_ = sqlite3_open_v2(
      destination_path_.c_str(), &dest_,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI, nullptr);

  if (backup_status_ != SQLITE_OK) {
    // Let OnOK reject after its shutdown guard. SetError() would route through
    // node-addon-api's Error::New(env, ...) path before BackupJob sees
    // teardown.
    return;
  }

  // Initialize backup using the connection pointer captured at construction
  // This prevents use-after-free if database is closed during backup
  backup_ = sqlite3_backup_init(dest_, dest_db_.c_str(), source_connection_,
                                source_db_.c_str());

  if (!backup_) {
    // Let OnOK reject after its shutdown guard. sqlite3_backup_init errors are
    // stored on dest_ and will be read before Cleanup().
    return;
  }

  // Initial page count may be 0 until first step
  total_pages_ = 0; // Will be updated after first step
  bool is_first_step = true;

  while (backup_status_ == SQLITE_OK) {
    if (shutting_down_.load(std::memory_order_acquire)) {
      // Env is tearing down; abandon the backup so FreeEnvironment can finish.
      // Don't SetError - that would route through the parent's OnWorkComplete
      // -> Error::New(env, ...) -> WrapCallback path, which still touches the
      // env. Returning with empty _error sends us through OnOK, where our
      // shutting_down_ guard skips deferred_ before it can throw.
      return;
    }
    // If pages_ is negative, use -1 to copy all remaining pages
    int pages_to_copy = pages_ < 0 ? -1 : pages_;
    backup_status_ = sqlite3_backup_step(backup_, pages_to_copy);
    // Re-check after the long-running step; CleanupHook may have flipped the
    // flag and called progress_func_.Reset() while we were inside SQLite.
    if (shutting_down_.load(std::memory_order_acquire)) {
      return;
    }

    // Update total pages after first step (when SQLite knows the actual count)
    if (is_first_step) {
      total_pages_ = sqlite3_backup_pagecount(backup_);
      is_first_step = false;
    }

    if (backup_status_ == SQLITE_OK) {
      // More steps remaining - send progress update
      int remaining_pages = sqlite3_backup_remaining(backup_);
      int current_page = total_pages_ - remaining_pages;

      // Send progress update to main thread
      // Node.js only calls progress when there are still pages remaining.
      // Use the plain bool snapshot (not progress_func_.IsEmpty()) - the
      // FunctionReference is owned by the main thread and may be Reset() by
      // CleanupHook concurrently.
      if (has_progress_callback_ && total_pages_ > 0 && remaining_pages > 0) {
        BackupProgress prog = {current_page, total_pages_};
        progress.Send(&prog, 1);
      }
    } else if (backup_status_ == SQLITE_DONE) {
      // Backup complete - don't send progress for remaining:0
      break;
    } else if (backup_status_ == SQLITE_BUSY ||
               backup_status_ == SQLITE_LOCKED) {
      // These are retryable errors - continue
      backup_status_ = SQLITE_OK;
    } else {
      // Fatal error
      break;
    }
  }

  // OnOK handles SQLITE_DONE and expected SQLite failures. Avoid SetError() for
  // expected failures so teardown cannot reach node-addon-api's OnError path.
}

void BackupJob::OnProgress(const BackupProgress *data, size_t count) {
  // This runs on the main thread
  if (!progress_func_.IsEmpty() && count > 0 && !progress_error_.has_value()) {
    Napi::HandleScope scope(Env());
    Napi::Function progress_fn = progress_func_.Value();
    Napi::Object progress_info = Napi::Object::New(Env());
    progress_info.Set("totalPages", Napi::Number::New(Env(), data->total));
    progress_info.Set("remainingPages",
                      Napi::Number::New(Env(), data->total - data->current));

    try {
      progress_fn.Call(Env().Null(), {progress_info});
    } catch (const Napi::Error &e) {
      // Capture error from progress callback - backup should fail with this
      progress_error_ = e.Message();
    } catch (...) {
      // Unknown error
      progress_error_ = "Unknown error in progress callback";
    }
  }
}

void BackupJob::OnOK() {
  // This runs on the main thread after Execute completes successfully
  Napi::HandleScope scope(Env());

  // Save error info BEFORE cleanup nulls the pointers. Normal SQLite backup
  // failures are handled here instead of via AsyncWorker::SetError() so the
  // shutdown guard below runs before any JS Error construction.
  int saved_status = backup_status_;
  std::string saved_errmsg;
  if (dest_) {
    saved_errmsg = sqlite3_errmsg(dest_);
    int dest_err = sqlite3_errcode(dest_);
    if (dest_err != SQLITE_OK && saved_status == SQLITE_OK) {
      saved_status = dest_err;
    }
  }
  const bool backup_failed = backup_status_ != SQLITE_DONE;
  if (backup_failed &&
      (saved_status == SQLITE_OK || saved_status == SQLITE_DONE)) {
    saved_status = SQLITE_ERROR;
  }

  // Cleanup SQLite resources
  Cleanup();

  if (shutting_down_.load(std::memory_order_acquire)) {
    // Env teardown already started; deferred_ rejection can throw a C++
    // Napi::Error out of this libuv cleanup-hook frame. The JS-side promise
    // is going away with the env anyway.
    return;
  }

  // If progress callback threw an error, reject with that error
  if (progress_error_.has_value()) {
    Napi::Error error = Napi::Error::New(Env(), *progress_error_);
    try {
      deferred_.Reject(error.Value());
    } catch (...) {
    }
    return;
  }

  if (backup_failed) {
    std::string err_message;
    if (!saved_errmsg.empty() && saved_errmsg != "not an error") {
      err_message = saved_errmsg;
    } else {
      err_message = sqlite3_errstr(saved_status);
    }

    Napi::Error detailed_error = Napi::Error::New(Env(), err_message);
    detailed_error.Set("code", Napi::String::New(Env(), "ERR_SQLITE_ERROR"));
    detailed_error.Set("errcode", Napi::Number::New(Env(), saved_status));
    detailed_error.Set("errstr",
                       Napi::String::New(Env(), sqlite3_errstr(saved_status)));
    try {
      deferred_.Reject(detailed_error.Value());
    } catch (...) {
    }
    return;
  }

  // Resolve the promise with the total number of pages
  try {
    deferred_.Resolve(Napi::Number::New(Env(), total_pages_));
  } catch (...) {
  }
}

void BackupJob::OnError(const Napi::Error &error) {
  // This runs on the main thread if Execute encounters an error
  Napi::HandleScope scope(Env());

  // Save error info BEFORE cleanup nulls the pointers
  int saved_status = backup_status_;
  std::string saved_errmsg;
  if (dest_) {
    saved_errmsg = sqlite3_errmsg(dest_);
    // Capture any final error code from dest
    int dest_err = sqlite3_errcode(dest_);
    if (dest_err != SQLITE_OK && saved_status == SQLITE_OK) {
      saved_status = dest_err;
    }
  }

  // Now safe to cleanup
  Cleanup();

  if (shutting_down_.load(std::memory_order_acquire)) {
    return;
  }

  // Use saved values for error details (matching node:sqlite property names)
  if (saved_status != SQLITE_OK && saved_status != SQLITE_DONE) {
    // Prefer the detailed error message from sqlite3_errmsg(dest_) if it's
    // useful, otherwise fall back to sqlite3_errstr(status) which is the
    // generic message. sqlite3_errmsg can return "not an error" if the error
    // wasn't stored in dest.
    std::string err_message;
    if (!saved_errmsg.empty() && saved_errmsg != "not an error") {
      err_message = saved_errmsg;
    } else {
      err_message = sqlite3_errstr(saved_status);
    }

    Napi::Error detailed_error = Napi::Error::New(Env(), err_message);
    detailed_error.Set("code", Napi::String::New(Env(), "ERR_SQLITE_ERROR"));
    detailed_error.Set("errcode", Napi::Number::New(Env(), saved_status));
    detailed_error.Set("errstr",
                       Napi::String::New(Env(), sqlite3_errstr(saved_status)));
    try {
      deferred_.Reject(detailed_error.Value());
    } catch (...) {
    }
  } else {
    try {
      deferred_.Reject(error.Value());
    } catch (...) {
    }
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
// Note: Validation errors are thrown synchronously (matching Node.js behavior).
// Only the actual backup operation returns a promise.
Napi::Value DatabaseSync::Backup(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Validation errors throw synchronously (matching Node.js behavior)
  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "backup database")) {
    return env.Undefined();
  }

  // ValidateDatabasePath throws synchronously with ERR_INVALID_ARG_TYPE
  // Use "path" as argument name to match Node.js
  std::optional<std::string> dest_path =
      ValidateDatabasePath(env, info[0], "path");
  if (!dest_path.has_value()) {
    // Exception already thrown by ValidateDatabasePath
    return env.Undefined();
  }

  // Default options matching Node.js API
  int rate = 100;
  std::string source_db = "main";
  std::string target_db = "main";
  Napi::Function progress_func;

  // Parse options if provided
  if (info.Length() > 1) {
    if (!info[1].IsObject()) {
      node::THROW_ERR_INVALID_ARG_TYPE(
          env, "The \"options\" argument must be an object.");
      return env.Undefined();
    }

    Napi::Object options = info[1].As<Napi::Object>();

    // Get rate option (number of pages per step)
    Napi::Value rate_value = options.Get("rate");
    if (!rate_value.IsUndefined()) {
      // Check if it's a number and an integer (not fractional)
      if (!rate_value.IsNumber()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.rate\" argument must be an integer.");
        return env.Undefined();
      }
      double rate_double = rate_value.As<Napi::Number>().DoubleValue();
      if (rate_double != std::trunc(rate_double)) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.rate\" argument must be an integer.");
        return env.Undefined();
      }
      rate = rate_value.As<Napi::Number>().Int32Value();
      // Note: Node.js allows negative values for rate
    }

    // Get source database option
    Napi::Value source_value = options.Get("source");
    if (!source_value.IsUndefined()) {
      if (!source_value.IsString()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.source\" argument must be a string.");
        return env.Undefined();
      }
      source_db = source_value.As<Napi::String>().Utf8Value();
    }

    // Get target database option
    Napi::Value target_value = options.Get("target");
    if (!target_value.IsUndefined()) {
      if (!target_value.IsString()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.target\" argument must be a string.");
        return env.Undefined();
      }
      target_db = target_value.As<Napi::String>().Utf8Value();
    }

    // Get progress callback
    Napi::Value progress_value = options.Get("progress");
    if (!progress_value.IsUndefined()) {
      if (!progress_value.IsFunction()) {
        node::THROW_ERR_INVALID_ARG_TYPE(
            env, "The \"options.progress\" argument must be a function.");
        return env.Undefined();
      }
      progress_func = progress_value.As<Napi::Function>();
    }
  }

  // Create promise for async backup operation
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

  // Create and schedule backup job. Pass the database's JS object so the job
  // can hold a strong reference and keep the source alive for the whole
  // backup (see BackupJob::source_ref_).
  BackupJob *job =
      new BackupJob(env, this, info.This().As<Napi::Object>(),
                    std::move(*dest_path), std::move(source_db),
                    std::move(target_db), rate, progress_func, deferred);

  // Queue the async work - AsyncWorker will delete itself when complete
  job->Queue();

  return deferred.Promise();
}

// Helper function to convert nullable C string to JavaScript value
static Napi::Value NullableSQLiteStringToValue(Napi::Env env, const char *str) {
  if (str == nullptr) {
    return env.Null();
  }
  return Napi::String::New(env, str);
}

// DatabaseSync::SetAuthorizer implementation
Napi::Value DatabaseSync::SetAuthorizer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "set authorizer")) {
    return env.Undefined();
  }

  // Handle null to clear the authorizer
  if (info.Length() > 0 && info[0].IsNull()) {
    sqlite3_set_authorizer(connection_, nullptr, nullptr);
    authorizer_callback_.reset();
    return env.Undefined();
  }

  // Validate callback argument
  if (info.Length() < 1 || !info[0].IsFunction()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The \"callback\" argument must be a function or null.");
    return env.Undefined();
  }

  // Store the JavaScript callback
  Napi::Function fn = info[0].As<Napi::Function>();
  authorizer_callback_ =
      std::make_unique<Napi::FunctionReference>(Napi::Persistent(fn));

  // Set the SQLite authorizer with our static callback
  int r = sqlite3_set_authorizer(connection_, AuthorizerCallback, this);

  if (r != SQLITE_OK) {
    authorizer_callback_.reset();
    ThrowEnhancedSqliteErrorWithDB(env, this, connection_, r,
                                   "Failed to set authorizer");
    return env.Undefined();
  }

  return env.Undefined();
}

// Static callback for SQLite authorization
int DatabaseSync::AuthorizerCallback(void *user_data, int action_code,
                                     const char *param1, const char *param2,
                                     const char *param3, const char *param4) {
  DatabaseSync *db = static_cast<DatabaseSync *>(user_data);

  // If no callback is set, allow everything
  if (!db->authorizer_callback_ || db->authorizer_callback_->IsEmpty()) {
    return SQLITE_OK;
  }

  Napi::Env env(db->env_);
  Napi::HandleScope scope(env);
  auto authorizer_guard = db->EnterAuthorizerCallback();

  try {
    // Convert SQLite authorizer parameters to JavaScript values
    std::vector<napi_value> args;
    args.push_back(Napi::Number::New(env, action_code));
    args.push_back(NullableSQLiteStringToValue(env, param1));
    args.push_back(NullableSQLiteStringToValue(env, param2));
    args.push_back(NullableSQLiteStringToValue(env, param3));
    args.push_back(NullableSQLiteStringToValue(env, param4));

    // Call the JavaScript callback
    Napi::Value result = db->authorizer_callback_->Call(env.Undefined(), args);

    // Handle JavaScript exceptions - must clear before returning to SQLite
    if (env.IsExceptionPending()) {
      Napi::Error error = env.GetAndClearPendingException();
      db->SetDeferredAuthorizerException(error);
      db->SetIgnoreNextSQLiteError(true);
      return SQLITE_DENY;
    }

    // Match V8's IsInt32() check in node:sqlite. Node-API's Int32Value()
    // coerces NaN, negative zero, fractions, and wrapping values such as 2^32
    // to zero, which would otherwise turn a malformed result into SQLITE_OK.
    bool is_int32 = false;
    if (result.IsNumber()) {
      const double value = result.As<Napi::Number>().DoubleValue();
      is_int32 = std::isfinite(value) && !(value == 0 && std::signbit(value)) &&
                 std::trunc(value) == value && value >= INT32_MIN &&
                 value <= INT32_MAX;
    }
    if (!is_int32) {
      Napi::TypeError error = Napi::TypeError::New(
          env, "Authorizer callback must return an integer authorization code");
      db->SetDeferredAuthorizerException(error);
      db->SetIgnoreNextSQLiteError(true);
      return SQLITE_DENY;
    }

    int32_t int_result = result.As<Napi::Number>().Int32Value();

    // Validate the return code - don't throw in callback context
    if (int_result != SQLITE_OK && int_result != SQLITE_DENY &&
        int_result != SQLITE_IGNORE) {
      Napi::RangeError error = Napi::RangeError::New(
          env, "Authorizer callback returned a invalid authorization code");
      db->SetDeferredAuthorizerException(error);
      db->SetIgnoreNextSQLiteError(true);
      return SQLITE_DENY;
    }

    return int_result;
  } catch (const Napi::Error &e) {
    // JavaScript exception occurred - clear any pending exception and store
    if (env.IsExceptionPending()) {
      Napi::Error error = env.GetAndClearPendingException();
      db->SetDeferredAuthorizerException(error);
    } else {
      db->SetDeferredAuthorizerException(e);
    }
    db->SetIgnoreNextSQLiteError(true);
    return SQLITE_DENY;
  } catch (const std::exception &e) {
    // C++ exception - clear any pending JS exception and preserve it. If the
    // exception did not originate in JavaScript, create an Error now and defer
    // that exact object until the surrounding SQLite call returns.
    if (env.IsExceptionPending()) {
      Napi::Error error = env.GetAndClearPendingException();
      db->SetDeferredAuthorizerException(error);
    } else {
      Napi::Error error = Napi::Error::New(env, e.what());
      db->SetDeferredAuthorizerException(error);
    }
    db->SetIgnoreNextSQLiteError(true);
    return SQLITE_DENY;
  } catch (...) {
    // Unknown error - clear any pending JS exception and deny
    if (env.IsExceptionPending()) {
      Napi::Error error = env.GetAndClearPendingException();
      db->SetDeferredAuthorizerException(error);
    } else {
      Napi::Error error =
          Napi::Error::New(env, "Unknown error in authorizer callback");
      db->SetDeferredAuthorizerException(error);
    }
    db->SetIgnoreNextSQLiteError(true);
    return SQLITE_DENY;
  }
}

Napi::Value DatabaseSync::GetLimit(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "read database limits")) {
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsNumber()) {
    node::THROW_ERR_INVALID_ARG_TYPE(env,
                                     "The limit ID argument must be a number.");
    return env.Undefined();
  }

  int limit_id = info[0].As<Napi::Number>().Int32Value();
  int current_value = sqlite3_limit(connection_, limit_id, -1);
  return Napi::Number::New(env, current_value);
}

Napi::Value DatabaseSync::SetLimit(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!IsOpen()) {
    node::THROW_ERR_INVALID_STATE(env, "database is not open");
    return env.Undefined();
  }

  if (ThrowIfInAuthorizerCallback(env, "set database limits")) {
    return env.Undefined();
  }

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    node::THROW_ERR_INVALID_ARG_TYPE(
        env, "The limit ID and value arguments must be numbers.");
    return env.Undefined();
  }

  int limit_id = info[0].As<Napi::Number>().Int32Value();
  int new_value = info[1].As<Napi::Number>().Int32Value();
  int old_value = sqlite3_limit(connection_, limit_id, new_value);
  return Napi::Number::New(env, old_value);
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

} // namespace photostructure::sqlite
