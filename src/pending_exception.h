#ifndef SRC_PENDING_EXCEPTION_H_
#define SRC_PENDING_EXCEPTION_H_

#include <napi.h>

namespace photostructure {
namespace sqlite {

// Code that may run when process.exit() in a worker has stopped JavaScript
// calls into JavaScript through raw Node-API (napi_call_function,
// napi_get_named_property, ...) and checks the status, rather than through
// node-addon-api's Function::Call() or Object::Get(). When the JavaScript
// throws, those convert the exception with Napi::Error::New(env), as
// env.GetAndClearPendingException() does: its Napi::Error wraps a thrown
// primitive in a new object via napi_define_properties and aborts the process
// if that fails, which it does for the termination exception that
// process.exit() in a worker leaves behind. Once JavaScript cannot run,
// throwing anything fails as well, with a C++ exception that ends the process,
// so nothing may be thrown then.

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

// Clears the pending exception, which a failed call into JavaScript left, and
// returns it. Nothing can be thrown once JavaScript cannot run, so the result
// is then empty.
inline Napi::Error TakePendingException(napi_env env) {
  napi_value exception;
  if (napi_get_and_clear_last_exception(env, &exception) != napi_ok ||
      !CanRunJavaScript(env)) {
    return Napi::Error(env, nullptr);
  }
  return Napi::Error(env, exception);
}

// Clears and drops the pending exception, if there is one.
inline void ClearPendingException(napi_env env) {
  napi_value discarded;
  napi_get_and_clear_last_exception(env, &discarded);
}

} // namespace sqlite
} // namespace photostructure

#endif // SRC_PENDING_EXCEPTION_H_
