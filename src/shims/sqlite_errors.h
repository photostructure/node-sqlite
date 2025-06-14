#ifndef SRC_SHIMS_SQLITE_ERRORS_H_
#define SRC_SHIMS_SQLITE_ERRORS_H_

#include "../sqlite_exception.h"
#include <napi.h>
#include <sqlite3.h>
#include <string>

namespace node {

// Helper function to get SQLite error code name
inline const char *GetSqliteErrorCodeName(int code) {
  switch (code) {
  case SQLITE_OK:
    return "SQLITE_OK";
  case SQLITE_ERROR:
    return "SQLITE_ERROR";
  case SQLITE_INTERNAL:
    return "SQLITE_INTERNAL";
  case SQLITE_PERM:
    return "SQLITE_PERM";
  case SQLITE_ABORT:
    return "SQLITE_ABORT";
  case SQLITE_BUSY:
    return "SQLITE_BUSY";
  case SQLITE_LOCKED:
    return "SQLITE_LOCKED";
  case SQLITE_NOMEM:
    return "SQLITE_NOMEM";
  case SQLITE_READONLY:
    return "SQLITE_READONLY";
  case SQLITE_INTERRUPT:
    return "SQLITE_INTERRUPT";
  case SQLITE_IOERR:
    return "SQLITE_IOERR";
  case SQLITE_CORRUPT:
    return "SQLITE_CORRUPT";
  case SQLITE_NOTFOUND:
    return "SQLITE_NOTFOUND";
  case SQLITE_FULL:
    return "SQLITE_FULL";
  case SQLITE_CANTOPEN:
    return "SQLITE_CANTOPEN";
  case SQLITE_PROTOCOL:
    return "SQLITE_PROTOCOL";
  case SQLITE_EMPTY:
    return "SQLITE_EMPTY";
  case SQLITE_SCHEMA:
    return "SQLITE_SCHEMA";
  case SQLITE_TOOBIG:
    return "SQLITE_TOOBIG";
  case SQLITE_CONSTRAINT:
    return "SQLITE_CONSTRAINT";
  case SQLITE_MISMATCH:
    return "SQLITE_MISMATCH";
  case SQLITE_MISUSE:
    return "SQLITE_MISUSE";
  case SQLITE_NOLFS:
    return "SQLITE_NOLFS";
  case SQLITE_AUTH:
    return "SQLITE_AUTH";
  case SQLITE_FORMAT:
    return "SQLITE_FORMAT";
  case SQLITE_RANGE:
    return "SQLITE_RANGE";
  case SQLITE_NOTADB:
    return "SQLITE_NOTADB";
  case SQLITE_NOTICE:
    return "SQLITE_NOTICE";
  case SQLITE_WARNING:
    return "SQLITE_WARNING";
  case SQLITE_ROW:
    return "SQLITE_ROW";
  case SQLITE_DONE:
    return "SQLITE_DONE";
  default:
    // For extended error codes, get the base error code
    int baseCode = code & 0xFF;
    return GetSqliteErrorCodeName(baseCode);
  }
}

// Enhanced SQLite error that includes system errno information
inline void ThrowEnhancedSqliteError(Napi::Env env, sqlite3 *db,
                                     int sqlite_code,
                                     const std::string &message) {
  Napi::Error error = Napi::Error::New(env, message);

  // Add SQLite error code information
  error.Set("sqliteCode", Napi::Number::New(env, sqlite_code));

  if (db) {
    // Get extended error code (more specific than basic error code)
    int extended_code = sqlite3_extended_errcode(db);
    error.Set("sqliteExtendedCode", Napi::Number::New(env, extended_code));

    // Get system errno if available (for I/O errors)
    int sys_errno = sqlite3_system_errno(db);
    if (sys_errno != 0) {
      error.Set("systemErrno", Napi::Number::New(env, sys_errno));
    }
  }

  // Set a standard error code property for compatibility
  const char *code_name = GetSqliteErrorCodeName(sqlite_code);
  error.Set("code", Napi::String::New(env, code_name));

  // Also set the human-readable error string
  const char *err_str = sqlite3_errstr(sqlite_code);
  if (err_str) {
    error.Set("sqliteErrorString", Napi::String::New(env, err_str));
  }

  error.ThrowAsJavaScriptException();
}

// Helper to create enhanced error from just a message (when we have the db
// handle)
inline void ThrowSqliteError(Napi::Env env, sqlite3 *db,
                             const std::string &message) {
  if (db) {
    int errcode = sqlite3_errcode(db);
    ThrowEnhancedSqliteError(env, db, errcode, message);
  } else {
    // Fallback to simple error when no db handle available
    Napi::Error::New(env, message).ThrowAsJavaScriptException();
  }
}

// Helper to throw from a SqliteException with captured error info
inline void
ThrowFromSqliteException(Napi::Env env,
                         const photostructure::sqlite::SqliteException &ex) {
  Napi::Error error = Napi::Error::New(env, ex.what());

  // Add all captured error information
  error.Set("sqliteCode", Napi::Number::New(env, ex.sqlite_code()));
  error.Set("sqliteExtendedCode", Napi::Number::New(env, ex.extended_code()));

  if (ex.system_errno() != 0) {
    error.Set("systemErrno", Napi::Number::New(env, ex.system_errno()));
  }

  // Set the error code name
  const char *code_name = GetSqliteErrorCodeName(ex.sqlite_code());
  error.Set("code", Napi::String::New(env, code_name));

  // Also set the human-readable error string
  if (!ex.error_string().empty()) {
    error.Set("sqliteErrorString", Napi::String::New(env, ex.error_string()));
  }

  error.ThrowAsJavaScriptException();
}

} // namespace node

#endif // SRC_SHIMS_SQLITE_ERRORS_H_