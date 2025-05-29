#include <napi.h>
#include "sqlite_impl.h"

namespace photostructure {
namespace sqlite {

// Initialize the SQLite module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  DatabaseSync::Init(env, exports);
  StatementSync::Init(env, exports);
  StatementSyncIterator::Init(env, exports);
  Session::Init(env, exports);
  
  // Add SQLite constants
  Napi::Object constants = Napi::Object::New(env);
  constants.Set("SQLITE_OPEN_READONLY", Napi::Number::New(env, SQLITE_OPEN_READONLY));
  constants.Set("SQLITE_OPEN_READWRITE", Napi::Number::New(env, SQLITE_OPEN_READWRITE));
  constants.Set("SQLITE_OPEN_CREATE", Napi::Number::New(env, SQLITE_OPEN_CREATE));
  constants.Set("SQLITE_OPEN_DELETEONCLOSE", Napi::Number::New(env, SQLITE_OPEN_DELETEONCLOSE));
  constants.Set("SQLITE_OPEN_EXCLUSIVE", Napi::Number::New(env, SQLITE_OPEN_EXCLUSIVE));
  constants.Set("SQLITE_OPEN_AUTOPROXY", Napi::Number::New(env, SQLITE_OPEN_AUTOPROXY));
  constants.Set("SQLITE_OPEN_URI", Napi::Number::New(env, SQLITE_OPEN_URI));
  constants.Set("SQLITE_OPEN_MEMORY", Napi::Number::New(env, SQLITE_OPEN_MEMORY));
  constants.Set("SQLITE_OPEN_MAIN_DB", Napi::Number::New(env, SQLITE_OPEN_MAIN_DB));
  constants.Set("SQLITE_OPEN_TEMP_DB", Napi::Number::New(env, SQLITE_OPEN_TEMP_DB));
  constants.Set("SQLITE_OPEN_TRANSIENT_DB", Napi::Number::New(env, SQLITE_OPEN_TRANSIENT_DB));
  constants.Set("SQLITE_OPEN_MAIN_JOURNAL", Napi::Number::New(env, SQLITE_OPEN_MAIN_JOURNAL));
  constants.Set("SQLITE_OPEN_TEMP_JOURNAL", Napi::Number::New(env, SQLITE_OPEN_TEMP_JOURNAL));
  constants.Set("SQLITE_OPEN_SUBJOURNAL", Napi::Number::New(env, SQLITE_OPEN_SUBJOURNAL));
  constants.Set("SQLITE_OPEN_SUPER_JOURNAL", Napi::Number::New(env, SQLITE_OPEN_SUPER_JOURNAL));
  constants.Set("SQLITE_OPEN_NOMUTEX", Napi::Number::New(env, SQLITE_OPEN_NOMUTEX));
  constants.Set("SQLITE_OPEN_FULLMUTEX", Napi::Number::New(env, SQLITE_OPEN_FULLMUTEX));
  constants.Set("SQLITE_OPEN_SHAREDCACHE", Napi::Number::New(env, SQLITE_OPEN_SHAREDCACHE));
  constants.Set("SQLITE_OPEN_PRIVATECACHE", Napi::Number::New(env, SQLITE_OPEN_PRIVATECACHE));
  constants.Set("SQLITE_OPEN_WAL", Napi::Number::New(env, SQLITE_OPEN_WAL));
  
  // Changeset/session constants
  constants.Set("SQLITE_CHANGESET_OMIT", Napi::Number::New(env, SQLITE_CHANGESET_OMIT));
  constants.Set("SQLITE_CHANGESET_REPLACE", Napi::Number::New(env, SQLITE_CHANGESET_REPLACE));
  constants.Set("SQLITE_CHANGESET_ABORT", Napi::Number::New(env, SQLITE_CHANGESET_ABORT));
  
  constants.Set("SQLITE_CHANGESET_DATA", Napi::Number::New(env, SQLITE_CHANGESET_DATA));
  constants.Set("SQLITE_CHANGESET_NOTFOUND", Napi::Number::New(env, SQLITE_CHANGESET_NOTFOUND));
  constants.Set("SQLITE_CHANGESET_CONFLICT", Napi::Number::New(env, SQLITE_CHANGESET_CONFLICT));
  constants.Set("SQLITE_CHANGESET_CONSTRAINT", Napi::Number::New(env, SQLITE_CHANGESET_CONSTRAINT));
  constants.Set("SQLITE_CHANGESET_FOREIGN_KEY", Napi::Number::New(env, SQLITE_CHANGESET_FOREIGN_KEY));
  
  exports.Set("constants", constants);
  
  // TODO: Add backup function
  
  return exports;
}

} // namespace sqlite
} // namespace photostructure

// Module initialization function
Napi::Object InitSqlite(Napi::Env env, Napi::Object exports) {
  return photostructure::sqlite::Init(env, exports);
}

// Register the module
NODE_API_MODULE(sqlite, InitSqlite)