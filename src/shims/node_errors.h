#ifndef SRC_SHIMS_NODE_ERRORS_H_
#define SRC_SHIMS_NODE_ERRORS_H_

#include <napi.h>

#include <cstdio>
#include <cstring>
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

// For a message that can contain NUL bytes, which the C string overload
// above would cut off.
inline void THROW_ERR_INVALID_STATE(Napi::Env env, const std::string &message) {
  Napi::Error error = Napi::Error::New(env, message);
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

// Node.js's ERR_STRING_TOO_LONG message names V8's String::kMaxLength, which
// Node-API does not expose. This copies its definition from
// include/v8-primitive.h for the message only: callers detect an oversized
// string from napi_create_string_utf8() failing, not from this value.
inline std::string ERR_STRING_TOO_LONG_MESSAGE() {
  constexpr unsigned int kMaxLength =
      sizeof(void *) == 4 ? (1u << 28) - 16 : (1u << 29) - 24;
  char message[64];
  snprintf(message, sizeof(message),
           "Cannot create a string longer than 0x%x characters", kMaxLength);
  return message;
}

inline void THROW_ERR_STRING_TOO_LONG(Napi::Env env) {
  Napi::Error error =
      Napi::Error::New(env, ERR_STRING_TOO_LONG_MESSAGE().c_str());
  error.Set("code", Napi::String::New(env, "ERR_STRING_TOO_LONG"));
  error.ThrowAsJavaScriptException();
}

// Creates an Error whose message is SQLite text. SQLite error messages embed
// the offending identifier or token, so they can exceed V8's maximum string
// length; this then returns an empty Error with ERR_STRING_TOO_LONG pending,
// as node:sqlite throws.
inline Napi::Error NewErrorFromSqliteText(Napi::Env env, const char *message) {
  napi_value js_message;
  if (napi_create_string_utf8(env, message, strlen(message), &js_message) !=
      napi_ok) {
    THROW_ERR_STRING_TOO_LONG(env);
    return Napi::Error();
  }
  napi_value error;
  NAPI_THROW_IF_FAILED(env, napi_create_error(env, nullptr, js_message, &error),
                       Napi::Error());
  return Napi::Error(env, error);
}

inline void THROW_ERR_SQLITE_ERROR(Napi::Env env,
                                   const char *message = nullptr) {
  // Check for both null and empty string - on Windows (MSVC),
  // std::exception::what() can sometimes return an empty string
  const char *msg = (message && message[0] != '\0') ? message : "SQLite error";
  Napi::Error error = NewErrorFromSqliteText(env, msg);
  if (error.IsEmpty()) {
    return; // ERR_STRING_TOO_LONG is pending
  }
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

inline void THROW_ERR_INVALID_URL(Napi::Env env, const char *message) {
  Napi::TypeError error = Napi::TypeError::New(env, message);
  error.Set("code", Napi::String::New(env, "ERR_INVALID_URL"));
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