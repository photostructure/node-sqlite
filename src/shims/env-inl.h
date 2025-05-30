#ifndef SRC_SHIMS_ENV_INL_H_
#define SRC_SHIMS_ENV_INL_H_

#include <napi.h>

namespace node {

// Environment stubs
class Environment {
public:
  static Environment *GetCurrent(Napi::Env env) {
    static Environment instance;
    return &instance;
  }
};

} // namespace node

#endif // SRC_SHIMS_ENV_INL_H_