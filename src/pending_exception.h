#ifndef SRC_PENDING_EXCEPTION_H_
#define SRC_PENDING_EXCEPTION_H_

#include <napi.h>

namespace photostructure {
namespace sqlite {

// JavaScript that SQLite calls back into, such as an authorizer, a changeset
// filter, or a virtual table's iterator, is called through raw Node-API
// (napi_call_function, ...) with its status checked, rather than through
// node-addon-api's Function::Call(). That turns a JavaScript exception into a
// C++ exception, which must not unwind through SQLite's C frames; a failed raw
// call instead leaves the exception pending for the caller to rethrow.
//
// Once process.exit() or terminate() has stopped a worker's JavaScript,
// node-addon-api would abort the process when a failed call becomes an Error.
// The build defines NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS (see
// doc/build-flags.md), so it drops that error instead.

// False once the environment disallows JavaScript, as during teardown or after
// process.exit() in a worker: Node-API calls that may run JavaScript, such as
// napi_has_named_property, then fail. They also fail while an exception is
// pending, so this is false then too.
inline bool CanRunJavaScript(napi_env env) {
  napi_value object;
  bool has_property;
  return napi_create_object(env, &object) == napi_ok &&
         napi_has_named_property(env, object, "", &has_property) == napi_ok;
}

// Clears and drops the pending exception, if there is one.
inline void ClearPendingException(napi_env env) {
  napi_value discarded;
  napi_get_and_clear_last_exception(env, &discarded);
}

} // namespace sqlite
} // namespace photostructure

#endif // SRC_PENDING_EXCEPTION_H_
