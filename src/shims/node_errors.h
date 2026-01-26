#ifndef SRC_SHIMS_NODE_ERRORS_H_
#define SRC_SHIMS_NODE_ERRORS_H_

#include <napi.h>

#include <string>

namespace node {

// Error throwing utilities matching Node.js patterns
inline void THROW_ERR_INVALID_STATE(Napi::Env env,
                                    const char *message = nullptr) {
  const char *msg = message ? message : "Invalid state";
  Napi::Error error = Napi::Error::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_INVALID_STATE"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_ARG_TYPE(Napi::Env env,
                                       const char *message = nullptr) {
  const char *msg = message ? message : "Invalid argument type";
  Napi::TypeError error = Napi::TypeError::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_INVALID_ARG_TYPE"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_OUT_OF_RANGE(Napi::Env env,
                                   const char *message = nullptr) {
  const char *msg = message ? message : "Value out of range";
  Napi::RangeError error = Napi::RangeError::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_OUT_OF_RANGE"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_ARG_VALUE(Napi::Env env,
                                        const char *message = nullptr) {
  const char *msg = message ? message : "Invalid argument value";
  Napi::Error error = Napi::Error::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_INVALID_ARG_VALUE"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_SQLITE_ERROR(Napi::Env env,
                                   const char *message = nullptr) {
  // Check for both null and empty string - on Windows (MSVC),
  // std::exception::what() can sometimes return an empty string
  const char *msg = (message && message[0] != '\0') ? message : "SQLite error";
  Napi::Error error = Napi::Error::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_SQLITE_ERROR"));
  error.ThrowAsJavaScriptException();
}

// Database-aware version available when sqlite_impl.h is included
// This will be specialized in sqlite_impl.cpp to avoid forward declaration
// issues

inline void THROW_ERR_CONSTRUCT_CALL_REQUIRED(Napi::Env env) {
  Napi::TypeError error = Napi::TypeError::New(
      env, "Class constructor cannot be invoked without 'new'");
  error.Set("code", Napi::String::New(env, "ERR_CONSTRUCT_CALL_REQUIRED"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_ILLEGAL_CONSTRUCTOR(Napi::Env env) {
  Napi::TypeError error = Napi::TypeError::New(env, "Illegal constructor");
  error.Set("code", Napi::String::New(env, "ERR_ILLEGAL_CONSTRUCTOR"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_INVALID_URL_SCHEME(Napi::Env env,
                                         const char * /*scheme*/ = nullptr) {
  // Message must match Node.js exactly
  Napi::TypeError error =
      Napi::TypeError::New(env, "The URL must be of scheme file:");
  error.Set("code", Napi::String::New(env, "ERR_INVALID_URL_SCHEME"));
  error.ThrowAsJavaScriptException();
}

inline void THROW_ERR_LOAD_SQLITE_EXTENSION(Napi::Env env,
                                            const char *message = nullptr) {
  const char *msg = message ? message : "Failed to load SQLite extension";
  Napi::Error error = Napi::Error::New(env, msg);
  error.Set("code", Napi::String::New(env, "ERR_LOAD_SQLITE_EXTENSION"));
  error.ThrowAsJavaScriptException();
}

// Macro wrappers for compatibility (removed to avoid conflicts)

} // namespace node

#endif // SRC_SHIMS_NODE_ERRORS_H_