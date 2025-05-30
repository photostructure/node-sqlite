#ifndef SRC_SHIMS_UTIL_INL_H_
#define SRC_SHIMS_UTIL_INL_H_

#include "util.h"

namespace node {

inline void THROW_ERR_INVALID_ARG_TYPE(Napi::Env env, const char *message) {
  Napi::TypeError::New(env, message).ThrowAsJavaScriptException();
}

inline void THROW_ERR_OUT_OF_RANGE(Napi::Env env, const char *message) {
  Napi::RangeError::New(env, message).ThrowAsJavaScriptException();
}

} // namespace node

#endif // SRC_SHIMS_UTIL_INL_H_