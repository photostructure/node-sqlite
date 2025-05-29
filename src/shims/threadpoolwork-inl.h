#ifndef SRC_SHIMS_THREADPOOLWORK_INL_H_
#define SRC_SHIMS_THREADPOOLWORK_INL_H_

#include <napi.h>
#include <thread>
#include <memory>

namespace node {

// ThreadPoolWork implementation using std::thread
template<typename T>
class ThreadPoolWork {
 public:
  ThreadPoolWork(Napi::Env env, const char* name) 
    : env_(env), name_(name), tsfn_(nullptr) {
    // Create ThreadSafeFunction for async communication
    tsfn_ = Napi::ThreadSafeFunction::New(
      env,
      Napi::Function::New(env, [](const Napi::CallbackInfo&) {}),
      name,
      0, // queue_size
      1  // initial_thread_count
    );
  }
  
  virtual ~ThreadPoolWork() {
    if (tsfn_) {
      tsfn_.Release();
    }
  }
  
  // Pure virtual methods to be implemented by derived classes
  virtual void DoThreadPoolWork() = 0;
  virtual void AfterThreadPoolWork(int status) = 0;
  
  void ScheduleWork() {
    auto self = static_cast<T*>(this);
    
    // Create a shared pointer to keep this object alive
    auto shared_self = std::shared_ptr<T>(self, [](T*) {
      // Custom deleter that doesn't actually delete
      // (object is managed elsewhere)
    });
    
    // Launch background thread
    std::thread([shared_self, this]() {
      int status = 0;
      try {
        DoThreadPoolWork();
      } catch (...) {
        status = -1;
      }
      
      // Schedule completion callback on main thread
      auto callback = [shared_self, status](Napi::Env env, Napi::Function) {
        shared_self->AfterThreadPoolWork(status);
      };
      
      tsfn_.BlockingCall(callback);
    }).detach();
  }
  
 protected:
  Napi::Env env_;
  std::string name_;
  Napi::ThreadSafeFunction tsfn_;
};

} // namespace node

#endif // SRC_SHIMS_THREADPOOLWORK_INL_H_