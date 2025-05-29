#ifndef SRC_SHIMS_BASE_OBJECT_H_
#define SRC_SHIMS_BASE_OBJECT_H_

#include <napi.h>
#include <memory>

namespace node {

// Forward declarations
class Environment;
class MemoryTracker;

// BaseObject implementation for N-API - simplified for compatibility
class BaseObject {
 public:
  // Internal field count for V8 compatibility
  static constexpr int kInternalFieldCount = 1;
  
  explicit BaseObject(Napi::Env env) : env_(env) {}
  virtual ~BaseObject() = default;
  
  Napi::Env env() const { return env_; }
  Environment* env_ptr() const;
  
  // Memory tracking interface
  virtual void MemoryInfo(MemoryTracker* tracker) const {}
  virtual size_t SelfSize() const { return sizeof(*this); }
  
  // Weak reference management
  void MakeWeak() {
    // N-API handles this automatically
  }
  
  void ClearWeak() {
    // N-API handles this automatically  
  }
  
 protected:
  Napi::Env env_;
};

// Smart pointer types for BaseObject
template<typename T>
using BaseObjectPtr = std::shared_ptr<T>;

template<typename T>
using BaseObjectWeakPtr = std::weak_ptr<T>;

} // namespace node

#endif // SRC_SHIMS_BASE_OBJECT_H_