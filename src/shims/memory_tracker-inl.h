#ifndef SRC_SHIMS_MEMORY_TRACKER_INL_H_
#define SRC_SHIMS_MEMORY_TRACKER_INL_H_

namespace node {

// Memory tracking stubs
class MemoryTracker {
public:
  template <typename T> void TrackField(const char *, const T &) {}

  template <typename T>
  void TrackFieldWithSize(const char *, const T &, size_t) {}
};

} // namespace node

#endif // SRC_SHIMS_MEMORY_TRACKER_INL_H_