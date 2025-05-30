#ifndef SRC_SHIMS_DEBUG_UTILS_INL_H_
#define SRC_SHIMS_DEBUG_UTILS_INL_H_

#include <cstdio>

namespace node {

// Debug utilities
class Debug {
public:
  static bool enabled(const char *name) { return false; }
};

// Debug logging macro
#define DEBUG_LOG(...)                                                         \
  do {                                                                         \
    if (false)                                                                 \
      std::fprintf(stderr, __VA_ARGS__);                                       \
  } while (0)

} // namespace node

#endif // SRC_SHIMS_DEBUG_UTILS_INL_H_