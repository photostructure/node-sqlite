#ifndef SRC_SHIMS_NODE_MEM_H_
#define SRC_SHIMS_NODE_MEM_H_

#include <memory>
#include <cstdlib>

namespace node {

// Memory allocation wrappers
template<typename T>
T* Malloc(size_t count) {
  return static_cast<T*>(std::malloc(sizeof(T) * count));
}

template<typename T>
T* Realloc(T* ptr, size_t count) {
  return static_cast<T*>(std::realloc(ptr, sizeof(T) * count));
}

inline void Free(void* ptr) {
  std::free(ptr);
}

// Memory tracker stub
class MemoryTracker {
 public:
  template<typename T>
  void TrackField(const char*, const T&) {}
  
  template<typename T>
  void TrackFieldWithSize(const char*, const T&, size_t) {}
};

} // namespace node

#endif // SRC_SHIMS_NODE_MEM_H_