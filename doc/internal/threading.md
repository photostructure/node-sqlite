# Node-addon-api threading and promise handling guide

This document summarizes key concepts from Node-addon-api documentation for handling threads, promises, and async operations in native addons.

## References

- [ThreadSafeFunction Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe_function.md)
- [Thread Safety Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe.md)
- [Promises Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/promises.md)
- [Async Operations Documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/async_operations.md)
- [Node-addon-api Main Documentation](https://github.com/nodejs/node-addon-api/tree/main/doc)

## ThreadSafeFunction

### Key concepts

1. **Purpose**: Allows calling JavaScript functions from any thread
2. **Lifecycle**:
   - Created with `ThreadSafeFunction::New()` with initial thread count
   - Threads call `Acquire()` when starting to use it
   - Threads call `Release()` when done
   - Destroyed when all threads have released

### Best practices

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

### Key concepts

1. **Creation**: Use `Promise::Deferred` objects
2. **Resolution**: Must explicitly call `Resolve()` or `Reject()`
3. **Thread Safety**: Promise operations must happen on the main thread

### Best practices

```cpp
Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
// Store promise for return
Napi::Promise promise = deferred.Promise();

// Later, resolve or reject
deferred.Resolve(result);  // or
deferred.Reject(error);
```

## Thread safety rules

1. **Main Thread Only**:
   - All operations requiring `Napi::Env`, `Napi::Value`, or `Napi::Reference`
   - Promise resolution/rejection
   - JavaScript function calls (except via ThreadSafeFunction)

2. **Any Thread**:
   - ThreadSafeFunction `Acquire()`, `Release()`, `BlockingCall()`
   - Pure C++ operations

## Common pitfalls and solutions

### Problem: hanging process on exit

**Cause**: ThreadSafeFunction not properly released or threads still running

**Solution**:

1. Implement proper finalizer that joins threads
2. Always pair `Acquire()` with `Release()`
3. Handle `napi_closing` status gracefully

### Problem: unresolved promises

**Cause**: Async operation fails to resolve/reject promise before shutdown

**Solution**:

1. Track all Deferred objects
2. In error paths, always reject promises
3. Consider implementing cleanup in destructors

### Problem: use-after-free with detached threads

**Cause**: Object deleted while detached thread still running

**Solution**:

1. Use shared_ptr to manage object lifetime
2. Ensure proper synchronization between threads
3. Join threads in finalizers when possible

## AsyncWorker pattern

### Key concepts

1. **Purpose**: Provides a clean abstraction for running CPU-intensive tasks on worker threads
2. **Thread Management**: Automatically handles thread creation, joining, and cleanup
3. **Lifecycle**:
   - `Execute()`: Runs on worker thread (no Node.js API access)
   - `OnOK()`: Called on main thread when work completes successfully
   - `OnError()`: Called on main thread if an error occurs
   - Destructor automatically handles cleanup

### Basic AsyncWorker example

```cpp
class MyWorker : public Napi::AsyncWorker {
public:
  MyWorker(Napi::Function& callback, std::string data)
    : AsyncWorker(callback), data_(data) {}

  void Execute() override {
    // This runs on a worker thread
    // Do NOT use any Napi:: methods here
    result_ = ProcessData(data_);
  }

  void OnOK() override {
    // This runs on the main thread
    Callback().Call({Env().Null(), String::New(Env(), result_)});
  }

  void OnError(const Napi::Error& error) override {
    // This runs on the main thread
    Callback().Call({error.Value()});
  }

private:
  std::string data_;
  std::string result_;
};
```

### AsyncProgressWorker for progress updates

```cpp
class ProgressWorker : public Napi::AsyncProgressWorker<int> {
public:
  ProgressWorker(Napi::Function& callback, Napi::Function& progress)
    : AsyncProgressWorker(callback), progress_callback_(Napi::Persistent(progress)) {}

  void Execute(const ExecutionProgress& progress) override {
    for (int i = 0; i < 100; i++) {
      // Send progress update
      progress.Send(&i, 1);
      // Do work...
    }
  }

  void OnProgress(const int* data, size_t count) override {
    // Called on main thread with progress data
    if (!progress_callback_.IsEmpty()) {
      progress_callback_.Call({Napi::Number::New(Env(), *data)});
    }
  }

private:
  Napi::FunctionReference progress_callback_;
};
```

## SQLite backup implementation

`BackupJob` runs each `sqlite3_backup_step()` in its own `BackupStep`
(`Napi::AsyncWorker`) and queues the next step from the main thread after the
previous one completes, as `node:sqlite`'s `BackupJob` does. Do not fold the
steps back into one worker loop:

- Each step holds the source connection's mutex (serialized mode). A loop of
  steps in one threadpool job re-acquires it immediately, and glibc mutexes are
  not fair, so a statement on the same `DatabaseSync` waited for most of the
  backup: 204 ms of a 208 ms backup of a 128 MB WAL database. Returning to the
  main thread between steps bounds that wait to one step (under 1 ms at the
  default `rate: 100`). `std::this_thread::yield()` or a sleep between steps
  does not guarantee the waiting thread gets the mutex.
- The cost is one main-thread round trip per step. On tmpfs, backing up
  128 MB took 132–150 ms at `rate: 100` (124–132 ms as one loop) and
  580–690 ms at `rate: 1` (195–210 ms as one loop), the same as `node:sqlite`.
- Node-API does not allow re-queuing a `napi_async_work`, so every step creates
  a new async resource. `FreeEnvironment()` disallows JavaScript and then runs
  pending async work to completion before it runs env cleanup hooks, so
  `OnStepComplete()` checks whether JavaScript can still run and stops instead
  of queuing another step. Creating an async resource there makes any
  `async_hooks` init callback fail as a fatal exception.
- `close()` releases the backup through `Abandon()`, which takes the lock that
  `Step()` holds for a whole step. It waits for a running step (which also
  holds the source connection's mutex, so `close()` waited for it anyway), and
  a step that runs afterwards returns without touching SQLite. Without the
  lock, a step used a `sqlite3_backup` that `close()` had finished, or attached
  to a source connection that `close()` had freed.
- A step that returns `SQLITE_BUSY` or `SQLITE_LOCKED` is retried from a
  timer, 1 ms at first and doubling to 100 ms, rather than queued at once,
  which kept one CPU core busy for as long as another connection held the
  lock (`node:sqlite` still does). The timer is `setTimeout()` from
  `node:timers`, passed in by `src/index.ts`: a raw `uv_timer_t` callback runs
  without an entered V8 context, and the global `setTimeout` is replaced by
  fake timers. No step is queued while a retry waits, and the timer cannot fire
  once teardown disallows JavaScript, so `BackupJob::CleanupHook` finishes a
  job whose retry is pending.

### Why detached threads are problematic

A thread started with `std::thread(...).detach()` has these problems:

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
