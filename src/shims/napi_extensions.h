#ifndef SRC_SHIMS_NAPI_EXTENSIONS_H_
#define SRC_SHIMS_NAPI_EXTENSIONS_H_

#include <napi.h>

#include <string>
#include <vector>

namespace node {

// V8 to N-API conversion utilities
class LocalVector {
public:
  explicit LocalVector(Napi::Env env) : env_(env) {}

  void push_back(Napi::Value value) { values_.push_back(value); }

  size_t size() const { return values_.size(); }

  Napi::Value operator[](size_t index) const { return values_[index]; }

private:
  Napi::Env env_;
  std::vector<Napi::Value> values_;
};

// String utilities
inline Napi::String FIXED_ONE_BYTE_STRING(Napi::Env env, const char *str) {
  return Napi::String::New(env, str);
}

// Utf8Value replacement
class Utf8Value {
public:
  explicit Utf8Value(Napi::Value value) {
    if (value.IsString()) {
      str_ = value.As<Napi::String>().Utf8Value();
    }
  }

  const char *operator*() const { return str_.c_str(); }
  size_t length() const { return str_.length(); }

private:
  std::string str_;
};

// Assertion macros
#define CHECK_EQ(a, b)                                                         \
  do {                                                                         \
    if ((a) != (b)) {                                                          \
      throw std::runtime_error("Assertion failed: " #a " == " #b);             \
    }                                                                          \
  } while (0)

// BaseObject unwrapping
template <typename T> T *ASSIGN_OR_RETURN_UNWRAP(Napi::Value value) {
  if (!value.IsObject())
    return nullptr;
  return T::Unwrap(value.As<Napi::Object>());
}

// Memory info macros (no-op for now)
#define SET_MEMORY_INFO_NAME(tracker, name)                                    \
  do {                                                                         \
  } while (0)
#define SET_SELF_SIZE(tracker, size)                                           \
  do {                                                                         \
  } while (0)

} // namespace node

#endif // SRC_SHIMS_NAPI_EXTENSIONS_H_