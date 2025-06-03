# Node-addon-api Threading and Promise Handling Guide

This document summarizes key concepts from Node-addon-api documentation for handling threads, promises, and async operations in native addons.

## References

- [ThreadSafeFunction Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe_function.md)
- [Thread Safety Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe.md)
- [Promises Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/promises.md)
- [Async Operations Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/async_operations.md)
- [Node-addon-api Main Documentation](https://github.com/nodejs/node-addon-api/tree/main/doc)

## ThreadSafeFunction

### Key Concepts

1. **Purpose**: Allows calling JavaScript functions from any thread
2. **Lifecycle**:
   - Created with `ThreadSafeFunction::New()` with initial thread count
   - Threads call `Acquire()` when starting to use it
   - Threads call `Release()` when done
   - Destroyed when all threads have released

### Best Practices

1. **Creation**:

```cpp
ThreadSafeFunction tsfn = ThreadSafeFunction::New(
  env,
  callback,
  "Resource Name",
  0,  // Unlimited queue
  1,  // Initial thread count
  []( Napi::Env ) {  // Finalizer
    // Clean up after threads
    nativeThread.join();
  }
);
```

2. **Thread Management**:

   - Always check return status of `Acquire()` and `BlockingCall()`
   - Handle `napi_closing` status during shutdown
   - Ensure `Release()` is the last call from a thread

3. **Shutdown Handling**:
   - The finalizer must ensure "no threads left using the thread-safe function after the finalize callback completes"
   - Use `Abort()` to signal no more calls can be made
   - The queue is emptied before destruction

## Promises

### Key Concepts

1. **Creation**: Use `Promise::Deferred` objects
2. **Resolution**: Must explicitly call `Resolve()` or `Reject()`
3. **Thread Safety**: Promise operations must happen on the main thread

### Best Practices

```cpp
Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
// Store promise for return
Napi::Promise promise = deferred.Promise();

// Later, resolve or reject
deferred.Resolve(result);  // or
deferred.Reject(error);
```

## Thread Safety Rules

1. **Main Thread Only**:

   - All operations requiring `Napi::Env`, `Napi::Value`, or `Napi::Reference`
   - Promise resolution/rejection
   - JavaScript function calls (except via ThreadSafeFunction)

2. **Any Thread**:
   - ThreadSafeFunction `Acquire()`, `Release()`, `BlockingCall()`
   - Pure C++ operations

## Common Pitfalls and Solutions

### Problem: Hanging Process on Exit

**Cause**: ThreadSafeFunction not properly released or threads still running

**Solution**:

1. Implement proper finalizer that joins threads
2. Always pair `Acquire()` with `Release()`
3. Handle `napi_closing` status gracefully

### Problem: Unresolved Promises

**Cause**: Async operation fails to resolve/reject promise before shutdown

**Solution**:

1. Track all Deferred objects
2. In error paths, always reject promises
3. Consider implementing cleanup in destructors

### Problem: Use-After-Free with Detached Threads

**Cause**: Object deleted while detached thread still running

**Solution**:

1. Use shared_ptr to manage object lifetime
2. Ensure proper synchronization between threads
3. Join threads in finalizers when possible

## Recommendations for SQLite Backup Implementation

Based on this analysis, the current BackupJob implementation has several issues:

1. **Missing Finalizer**: ThreadSafeFunction should have a finalizer to ensure cleanup
2. **Detached Threads**: Using detached threads makes it impossible to join them during shutdown
3. **Promise Lifecycle**: Unresolved promises during shutdown can cause hangs

### Proposed Fixes:

1. Add a finalizer to ThreadSafeFunction that ensures the BackupJob is properly cleaned up
2. Track active BackupJobs to ensure promises are resolved/rejected during shutdown
3. Consider using AsyncWorker pattern instead of custom ThreadPoolWork implementation

### Why Detached Threads Are Problematic

The current implementation uses `std::thread(...).detach()` which means:
- The thread cannot be joined
- The process cannot wait for the thread to complete
- Jest must force-exit because it cannot wait for detached threads
- This is fundamentally incompatible with clean shutdown

**Anti-pattern Example:**
```cpp
std::thread([work]() {
  // Do work
}).detach(); // BAD: Cannot join this thread
```

**Correct Pattern:**
```cpp
// Store thread handle and join in destructor/finalizer
std::thread worker([work]() {
  // Do work
});
// Later, in cleanup:
worker.join(); // Wait for thread to complete
```

**Note**: Adding arbitrary timeouts or forcing garbage collection in tests is NOT a solution. These are band-aids that mask the underlying design flaw.
