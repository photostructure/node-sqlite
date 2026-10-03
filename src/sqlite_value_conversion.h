#ifndef SRC_SQLITE_VALUE_CONVERSION_H_
#define SRC_SQLITE_VALUE_CONVERSION_H_

#include <napi.h>
#include <sqlite3.h>

namespace photostructure {
namespace sqlite {

// Converts a value SQLite passes to a callback (a function argument or a
// virtual table constraint) to JavaScript. An integer outside the safe range
// becomes a BigInt when use_bigint_args is true; otherwise this sets
// ERR_OUT_OF_RANGE pending and returns undefined. Text longer than a
// JavaScript string can hold sets ERR_STRING_TOO_LONG pending the same way.
// Callers must check env.IsExceptionPending().
Napi::Value SqliteValueToJS(Napi::Env env, sqlite3_value *value,
                            bool use_bigint_args);

// Sets the result of `ctx` from a JavaScript value returned by a callback.
// Values SQLite cannot store become a SQLite error on `ctx`; a BigInt outside
// the int64 range sets ERR_OUT_OF_RANGE pending instead, so callers must check
// env.IsExceptionPending().
void JSValueToSqliteResult(Napi::Env env, sqlite3_context *ctx,
                           Napi::Value value);

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_VALUE_CONVERSION_H_
