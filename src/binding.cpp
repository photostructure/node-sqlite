#include <mutex>
#include <napi.h>
#include <set>

#include "sqlite_impl.h"

namespace photostructure::sqlite {

// Cleanup function for worker termination
void CleanupAddonData([[maybe_unused]] napi_env env, void *finalize_data,
                      [[maybe_unused]] void *finalize_hint) {
  auto *addon_data = static_cast<AddonData *>(finalize_data);

  // Clean up any remaining database connections
  {
    const std::lock_guard<std::mutex> mutex_lock(addon_data->mutex);
    addon_data->databases.clear();
  }

  // Let Napi::FunctionReference destructors handle cleanup naturally.
  // Explicitly calling Reset() during worker termination causes JIT corruption
  // on Alpine/musl. The references will be cleaned up when addon_data is deleted.
  // See: nodejs/node-addon-api#660, P02-investigate-flaky-native-crashes.md

  delete addon_data;
}

// Helper to get addon data for current environment
AddonData *GetAddonData(napi_env env) {
  void *data = nullptr;
  const napi_status status = napi_get_instance_data(env, &data);
  if (status != napi_ok || data == nullptr) {
    return nullptr;
  }
  return static_cast<AddonData *>(data);
}

// Register a database instance for cleanup tracking
void RegisterDatabaseInstance(Napi::Env env, DatabaseSync *database) {
  AddonData *addon_data = GetAddonData(env);
  if (addon_data != nullptr) {
    const std::lock_guard<std::mutex> mutex_lock(addon_data->mutex);
    addon_data->databases.insert(database);
  }
}

// Unregister a database instance
void UnregisterDatabaseInstance(Napi::Env env, DatabaseSync *database) {
  AddonData *addon_data = GetAddonData(env);
  if (addon_data != nullptr) {
    const std::lock_guard<std::mutex> mutex_lock(addon_data->mutex);
    addon_data->databases.erase(database);
  }
}

// Initialize the SQLite module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Set up per-worker instance data
  AddonData *addon_data = new AddonData();
  napi_status status =
      napi_set_instance_data(env, addon_data, CleanupAddonData, nullptr);
  if (status != napi_ok) {
    delete addon_data;
    Napi::Error::New(env, "Failed to set instance data")
        .ThrowAsJavaScriptException();
    return exports;
  }

  // Cache Object.create for creating objects with null prototype
  Napi::Object global_object = env.Global().Get("Object").As<Napi::Object>();
  Napi::Function object_create =
      global_object.Get("create").As<Napi::Function>();
  addon_data->objectCreateFn =
      Napi::Reference<Napi::Function>::New(object_create);

  DatabaseSync::Init(env, exports);
  StatementSync::Init(env, exports);
  StatementSyncIterator::Init(env, exports);
  Session::Init(env, exports);

  // Add SQLite constants
  Napi::Object constants = Napi::Object::New(env);
  constants.Set("SQLITE_OPEN_READONLY",
                Napi::Number::New(env, SQLITE_OPEN_READONLY));
  constants.Set("SQLITE_OPEN_READWRITE",
                Napi::Number::New(env, SQLITE_OPEN_READWRITE));
  constants.Set("SQLITE_OPEN_CREATE",
                Napi::Number::New(env, SQLITE_OPEN_CREATE));
  constants.Set("SQLITE_OPEN_DELETEONCLOSE",
                Napi::Number::New(env, SQLITE_OPEN_DELETEONCLOSE));
  constants.Set("SQLITE_OPEN_EXCLUSIVE",
                Napi::Number::New(env, SQLITE_OPEN_EXCLUSIVE));
  constants.Set("SQLITE_OPEN_AUTOPROXY",
                Napi::Number::New(env, SQLITE_OPEN_AUTOPROXY));
  constants.Set("SQLITE_OPEN_URI", Napi::Number::New(env, SQLITE_OPEN_URI));
  constants.Set("SQLITE_OPEN_MEMORY",
                Napi::Number::New(env, SQLITE_OPEN_MEMORY));
  constants.Set("SQLITE_OPEN_MAIN_DB",
                Napi::Number::New(env, SQLITE_OPEN_MAIN_DB));
  constants.Set("SQLITE_OPEN_TEMP_DB",
                Napi::Number::New(env, SQLITE_OPEN_TEMP_DB));
  constants.Set("SQLITE_OPEN_TRANSIENT_DB",
                Napi::Number::New(env, SQLITE_OPEN_TRANSIENT_DB));
  constants.Set("SQLITE_OPEN_MAIN_JOURNAL",
                Napi::Number::New(env, SQLITE_OPEN_MAIN_JOURNAL));
  constants.Set("SQLITE_OPEN_TEMP_JOURNAL",
                Napi::Number::New(env, SQLITE_OPEN_TEMP_JOURNAL));
  constants.Set("SQLITE_OPEN_SUBJOURNAL",
                Napi::Number::New(env, SQLITE_OPEN_SUBJOURNAL));
  constants.Set("SQLITE_OPEN_SUPER_JOURNAL",
                Napi::Number::New(env, SQLITE_OPEN_SUPER_JOURNAL));
  constants.Set("SQLITE_OPEN_NOMUTEX",
                Napi::Number::New(env, SQLITE_OPEN_NOMUTEX));
  constants.Set("SQLITE_OPEN_FULLMUTEX",
                Napi::Number::New(env, SQLITE_OPEN_FULLMUTEX));
  constants.Set("SQLITE_OPEN_SHAREDCACHE",
                Napi::Number::New(env, SQLITE_OPEN_SHAREDCACHE));
  constants.Set("SQLITE_OPEN_PRIVATECACHE",
                Napi::Number::New(env, SQLITE_OPEN_PRIVATECACHE));
  constants.Set("SQLITE_OPEN_WAL", Napi::Number::New(env, SQLITE_OPEN_WAL));

  // Changeset/session constants
  constants.Set("SQLITE_CHANGESET_OMIT",
                Napi::Number::New(env, SQLITE_CHANGESET_OMIT));
  constants.Set("SQLITE_CHANGESET_REPLACE",
                Napi::Number::New(env, SQLITE_CHANGESET_REPLACE));
  constants.Set("SQLITE_CHANGESET_ABORT",
                Napi::Number::New(env, SQLITE_CHANGESET_ABORT));

  constants.Set("SQLITE_CHANGESET_DATA",
                Napi::Number::New(env, SQLITE_CHANGESET_DATA));
  constants.Set("SQLITE_CHANGESET_NOTFOUND",
                Napi::Number::New(env, SQLITE_CHANGESET_NOTFOUND));
  constants.Set("SQLITE_CHANGESET_CONFLICT",
                Napi::Number::New(env, SQLITE_CHANGESET_CONFLICT));
  constants.Set("SQLITE_CHANGESET_CONSTRAINT",
                Napi::Number::New(env, SQLITE_CHANGESET_CONSTRAINT));
  constants.Set("SQLITE_CHANGESET_FOREIGN_KEY",
                Napi::Number::New(env, SQLITE_CHANGESET_FOREIGN_KEY));

  // Authorization result codes
  constants.Set("SQLITE_OK", Napi::Number::New(env, SQLITE_OK));
  constants.Set("SQLITE_DENY", Napi::Number::New(env, SQLITE_DENY));
  constants.Set("SQLITE_IGNORE", Napi::Number::New(env, SQLITE_IGNORE));

  // Authorization action codes
  constants.Set("SQLITE_CREATE_INDEX",
                Napi::Number::New(env, SQLITE_CREATE_INDEX));
  constants.Set("SQLITE_CREATE_TABLE",
                Napi::Number::New(env, SQLITE_CREATE_TABLE));
  constants.Set("SQLITE_CREATE_TEMP_INDEX",
                Napi::Number::New(env, SQLITE_CREATE_TEMP_INDEX));
  constants.Set("SQLITE_CREATE_TEMP_TABLE",
                Napi::Number::New(env, SQLITE_CREATE_TEMP_TABLE));
  constants.Set("SQLITE_CREATE_TEMP_TRIGGER",
                Napi::Number::New(env, SQLITE_CREATE_TEMP_TRIGGER));
  constants.Set("SQLITE_CREATE_TEMP_VIEW",
                Napi::Number::New(env, SQLITE_CREATE_TEMP_VIEW));
  constants.Set("SQLITE_CREATE_TRIGGER",
                Napi::Number::New(env, SQLITE_CREATE_TRIGGER));
  constants.Set("SQLITE_CREATE_VIEW",
                Napi::Number::New(env, SQLITE_CREATE_VIEW));
  constants.Set("SQLITE_DELETE", Napi::Number::New(env, SQLITE_DELETE));
  constants.Set("SQLITE_DROP_INDEX", Napi::Number::New(env, SQLITE_DROP_INDEX));
  constants.Set("SQLITE_DROP_TABLE", Napi::Number::New(env, SQLITE_DROP_TABLE));
  constants.Set("SQLITE_DROP_TEMP_INDEX",
                Napi::Number::New(env, SQLITE_DROP_TEMP_INDEX));
  constants.Set("SQLITE_DROP_TEMP_TABLE",
                Napi::Number::New(env, SQLITE_DROP_TEMP_TABLE));
  constants.Set("SQLITE_DROP_TEMP_TRIGGER",
                Napi::Number::New(env, SQLITE_DROP_TEMP_TRIGGER));
  constants.Set("SQLITE_DROP_TEMP_VIEW",
                Napi::Number::New(env, SQLITE_DROP_TEMP_VIEW));
  constants.Set("SQLITE_DROP_TRIGGER",
                Napi::Number::New(env, SQLITE_DROP_TRIGGER));
  constants.Set("SQLITE_DROP_VIEW", Napi::Number::New(env, SQLITE_DROP_VIEW));
  constants.Set("SQLITE_INSERT", Napi::Number::New(env, SQLITE_INSERT));
  constants.Set("SQLITE_PRAGMA", Napi::Number::New(env, SQLITE_PRAGMA));
  constants.Set("SQLITE_READ", Napi::Number::New(env, SQLITE_READ));
  constants.Set("SQLITE_SELECT", Napi::Number::New(env, SQLITE_SELECT));
  constants.Set("SQLITE_TRANSACTION",
                Napi::Number::New(env, SQLITE_TRANSACTION));
  constants.Set("SQLITE_UPDATE", Napi::Number::New(env, SQLITE_UPDATE));
  constants.Set("SQLITE_ATTACH", Napi::Number::New(env, SQLITE_ATTACH));
  constants.Set("SQLITE_DETACH", Napi::Number::New(env, SQLITE_DETACH));
  constants.Set("SQLITE_ALTER_TABLE",
                Napi::Number::New(env, SQLITE_ALTER_TABLE));
  constants.Set("SQLITE_REINDEX", Napi::Number::New(env, SQLITE_REINDEX));
  constants.Set("SQLITE_ANALYZE", Napi::Number::New(env, SQLITE_ANALYZE));
  constants.Set("SQLITE_CREATE_VTABLE",
                Napi::Number::New(env, SQLITE_CREATE_VTABLE));
  constants.Set("SQLITE_DROP_VTABLE",
                Napi::Number::New(env, SQLITE_DROP_VTABLE));
  constants.Set("SQLITE_FUNCTION", Napi::Number::New(env, SQLITE_FUNCTION));
  constants.Set("SQLITE_SAVEPOINT", Napi::Number::New(env, SQLITE_SAVEPOINT));
  constants.Set("SQLITE_COPY", Napi::Number::New(env, SQLITE_COPY));
  constants.Set("SQLITE_RECURSIVE", Napi::Number::New(env, SQLITE_RECURSIVE));

  exports.Set("constants", constants);

  // Add standalone backup() function (Node.js API compatibility)
  // Signature: backup(sourceDb, destination, options?) -> Promise
  Napi::Function backupFunc = Napi::Function::New(
      env,
      [](const Napi::CallbackInfo &info) -> Napi::Value {
        Napi::Env env = info.Env();

        // Validate and unwrap DatabaseSync instance
        DatabaseSync *db = nullptr;
        if (info.Length() >= 1 && info[0].IsObject()) {
          try {
            db = DatabaseSync::Unwrap(info[0].As<Napi::Object>());
          } catch (...) {
            // Fall through to error below
          }
        }
        if (db == nullptr) {
          Napi::TypeError error = Napi::TypeError::New(
              env, "The \"sourceDb\" argument must be an object.");
          error.Set("code", Napi::String::New(env, "ERR_INVALID_ARG_TYPE"));
          error.ThrowAsJavaScriptException();
          return env.Undefined();
        }

        // Validate path is provided and valid - delegates to
        // ValidateDatabasePath which will throw ERR_INVALID_ARG_TYPE with the
        // proper message

        // Delegate to instance method: db.backup(destination, options?)
        std::vector<napi_value> args;
        for (size_t i = 1; i < info.Length(); i++) {
          args.push_back(info[i]);
        }
        Napi::Function backupMethod =
            db->Value().Get("backup").As<Napi::Function>();
        return backupMethod.Call(db->Value(), args);
      },
      "backup");

  // Set function name and length properties (Node.js compatibility)
  backupFunc.DefineProperty(Napi::PropertyDescriptor::Value(
      "name", Napi::String::New(env, "backup"), napi_enumerable));
  backupFunc.DefineProperty(Napi::PropertyDescriptor::Value(
      "length", Napi::Number::New(env, 2), napi_enumerable));

  exports.Set("backup", backupFunc);

  return exports;
}

} // namespace photostructure::sqlite

// Module initialization function
Napi::Object InitSqlite(Napi::Env env, Napi::Object exports) {
  return photostructure::sqlite::Init(env, exports);
}

// Register the module
NODE_API_MODULE(phstr_sqlite, InitSqlite)