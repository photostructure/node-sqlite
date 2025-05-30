#ifndef SRC_SHIMS_NODE_ERRORS_H_
#define SRC_SHIMS_NODE_ERRORS_H_

#include <napi.h>

#include <string>

namespace node {

// Error throwing utilities matching Node.js patterns
inline void THROW_ERR_INVALID_STATE(Napi::Env env,
                                    const char *message = nullptr) {
  const char *msg = message ? message : "Invalid state";
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_ARG_TYPE(Napi::Env env,
                                       const char *message = nullptr) {
  const char *msg = message ? message : "Invalid argument type";
  Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_OUT_OF_RANGE(Napi::Env env,
                                   const char *message = nullptr) {
  const char *msg = message ? message : "Value out of range";
  Napi::RangeError::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_ARG_VALUE(Napi::Env env,
                                        const char *message = nullptr) {
  const char *msg = message ? message : "Invalid argument value";
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_SQLITE_ERROR(Napi::Env env,
                                   const char *message = nullptr) {
  const char *msg = message ? message : "SQLite error";
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_CONSTRUCT_CALL_REQUIRED(Napi::Env env) {
  Napi::TypeError::New(env, "Class constructor cannot be invoked without 'new'")
      .ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_URL_SCHEME(Napi::Env env,
                                         const char *scheme = nullptr) {
  std::string msg = "Invalid URL scheme";
  if (scheme) {
    msg += ": ";
    msg += scheme;
  }
  Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
}

inline void THROW_ERR_LOAD_SQLITE_EXTENSION(Napi::Env env,
                                            const char *message = nullptr) {
  const char *msg = message ? message : "Failed to load SQLite extension";
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

// Macro wrappers for compatibility (removed to avoid conflicts)

} // namespace node

#endif // SRC_SHIMS_NODE_ERRORS_H_