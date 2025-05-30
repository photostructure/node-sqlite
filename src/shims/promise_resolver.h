#ifndef SRC_SHIMS_PROMISE_RESOLVER_H_
#define SRC_SHIMS_PROMISE_RESOLVER_H_

#include <napi.h>

namespace node {

// Promise resolver wrapper for N-API
class PromiseResolver {
public:
  static PromiseResolver Create(Napi::Env env) {
    auto deferred = Napi::Promise::Deferred::New(env);
    return PromiseResolver(deferred);
  }

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Resolve(Napi::Value value) { deferred_.Resolve(value); }

  void Reject(Napi::Value value) { deferred_.Reject(value); }

private:
  explicit PromiseResolver(Napi::Promise::Deferred deferred)
      : deferred_(deferred) {}

  Napi::Promise::Deferred deferred_;
};

} // namespace node

#endif // SRC_SHIMS_PROMISE_RESOLVER_H_