#ifndef SRC_USER_FUNCTION_H_
#define SRC_USER_FUNCTION_H_

#include <napi.h>
#include <sqlite3.h>

#include <string>

namespace photostructure {
namespace sqlite {

// Forward declaration
class DatabaseSync;

// User-defined function wrapper for SQLite callbacks
class UserDefinedFunction {
public:
  UserDefinedFunction(Napi::Env env, Napi::Function fn, DatabaseSync *db,
                      bool use_bigint_args);
  ~UserDefinedFunction();

  // SQLite callback functions
  static void xFunc(sqlite3_context *ctx, int argc, sqlite3_value **argv);
  static void xDestroy(void *self);

private:
  Napi::Env env_;
  Napi::FunctionReference fn_;
  DatabaseSync *db_;
  bool use_bigint_args_;

  // Helper methods
  Napi::Value SqliteValueToJS(sqlite3_value *value);
  void JSValueToSqliteResult(sqlite3_context *ctx, Napi::Value value);
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_USER_FUNCTION_H_