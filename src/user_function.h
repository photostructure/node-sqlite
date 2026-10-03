#ifndef SRC_USER_FUNCTION_H_
#define SRC_USER_FUNCTION_H_

#include <napi.h>
#include <sqlite3.h>

#include <string>

namespace photostructure {
namespace sqlite {

// Forward declaration
class DatabaseSync;

// Call only from a catch block in a function SQLite calls for a user-defined
// function or aggregate (xFunc, xStep, xInverse, xValue, xFinal), which must
// not let a C++ exception unwind into SQLite. Fails the call the way a
// throwing JavaScript callback does: the caught exception becomes the pending
// JavaScript exception, and the statement throws it instead of the SQLite
// error. Once JavaScript can no longer run, as during environment teardown,
// the call fails with a SQLite error instead.
void FailWithCaughtException(napi_env env, DatabaseSync *db,
                             sqlite3_context *ctx) noexcept;

// User-defined function wrapper for SQLite callbacks
class UserDefinedFunction {
public:
  UserDefinedFunction(Napi::Env env, Napi::Function fn, DatabaseSync *db,
                      bool use_bigint_args);
  ~UserDefinedFunction() noexcept;

  // SQLite callback functions
  static void xFunc(sqlite3_context *ctx, int argc, sqlite3_value **argv);
  static void xDestroy(void *self);

private:
  // Environment cleanup hook - called before environment teardown
  static void CleanupHook(void *arg);

  // xFunc's body, which may throw.
  static void Invoke(sqlite3_context *ctx, int argc, sqlite3_value **argv);

  Napi::Env env_;
  Napi::FunctionReference fn_;
  DatabaseSync *db_;
  bool use_bigint_args_;
  napi_async_context async_context_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_USER_FUNCTION_H_