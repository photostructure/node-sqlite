#ifndef SRC_SHIMS_UTIL_H_
#define SRC_SHIMS_UTIL_H_

#include <napi.h>

#include <algorithm>
#include <string>
#include <unordered_map>

namespace node {

// Environment class for Node.js context
// Note: This class is a shim for upstream Node.js code compatibility.
// It's not actively used in our implementation but provides the interface.
class Environment {
private:
  using InstanceMap =
      std::unordered_map<napi_env, std::unique_ptr<Environment>>;

  // Thread-local storage accessor - the thread_local is on the variable, not
  // the return type
  static InstanceMap &GetInstances() {
    static thread_local InstanceMap instances;
    return instances;
  }

  // Cleanup hook called when napi_env is destroyed
  static void CleanupHook(void *arg) {
    napi_env env = static_cast<napi_env>(arg);
    InstanceMap &instances = GetInstances();
    auto it = instances.find(env);
    if (it != instances.end()) {
      instances.erase(it);
    }
  }

public:
  static Environment *GetCurrent(Napi::Env env) {
    InstanceMap &instances = GetInstances();
    auto it = instances.find(env);
    if (it == instances.end()) {
      auto result = instances.emplace(env, std::make_unique<Environment>(env));

      // Register cleanup hook to remove this entry when env is destroyed
      // This prevents memory leaks when worker threads terminate
      napi_add_env_cleanup_hook(env, CleanupHook, static_cast<void *>(env));

      return result.first->second.get();
    }
    return it->second.get();
  }

  explicit Environment(Napi::Env env) : env_(env) {}

  Napi::Env env() const { return env_; }
  napi_env raw_env() const { return env_; }

  // String caching for common strings (simplified)
  Napi::String href_string() const { return Napi::String::New(env_, "href"); }
  Napi::String timeout_string() const {
    return Napi::String::New(env_, "timeout");
  }
  Napi::String backup_string() const {
    return Napi::String::New(env_, "backup");
  }
  Napi::String constants_string() const {
    return Napi::String::New(env_, "constants");
  }

  // Permission system stub
  class Permission {
  public:
    bool is_granted() const { return true; }
  };

  Permission *permission() {
    static Permission perm;
    return &perm;
  }

private:
  Napi::Env env_;
};

// String utilities
inline std::string ToLower(const std::string &str) {
  std::string result = str;
  std::transform(result.begin(), result.end(), result.begin(), ::tolower);
  return result;
}

// Template helpers for setting constructor functions
template <typename T>
void SetConstructorFunction(Napi::Env env, Napi::Object target,
                            const char *name, Napi::Function constructor) {
  target.Set(name, constructor);
}

// Template helpers for setting prototype methods
template <typename T>
void SetProtoMethod(napi_env env, Napi::Function constructor, const char *name,
                    napi_callback callback) {
  // This would need more sophisticated implementation for full compatibility
  // For now, we'll handle this in the class definitions
}

template <typename T>
void SetProtoMethodNoSideEffect(napi_env env, Napi::Function constructor,
                                const char *name, napi_callback callback) {
  SetProtoMethod<T>(env, constructor, name, callback);
}

// Getter helpers
template <typename T>
void SetSideEffectFreeGetter(napi_env env, Napi::Function constructor,
                             Napi::String name, napi_callback callback) {
  // Simplified implementation
}

// Error throwing helpers
void THROW_ERR_INVALID_ARG_TYPE(Napi::Env env, const char *message);
void THROW_ERR_OUT_OF_RANGE(Napi::Env env, const char *message);

} // namespace node

#endif // SRC_SHIMS_UTIL_H_