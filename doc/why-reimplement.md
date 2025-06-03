# Why We Had to Reimplement Node.js's SQLite Code

This document explains why we couldn't directly use Node.js's C++ SQLite implementation and instead had to create a compatibility layer.

## The Core Problem: Node.js Internals

Node.js's SQLite implementation (`node_sqlite.cc`) is deeply integrated with Node.js internals that are not accessible to addon developers. These internals include:

### 1. BaseObject Class Hierarchy

```cpp
// Node.js internal code
class DatabaseSync : public BaseObject {
  // Uses internal lifecycle management
};
```

- All Node.js built-in objects inherit from `BaseObject`
- Provides automatic memory management and handle wrapping
- Not exposed in Node.js public headers

### 2. Environment Class

```cpp
// Extensive use of Environment throughout
Environment* env = Environment::GetCurrent(args);
env->isolate()
env->context()
env->sqlite_*_string()  // Cached strings
```

- Per-isolate context management
- String caching for performance
- Permission system integration
- Not available to addons

### 3. Internal Headers

The implementation requires headers that aren't installed with Node.js:

- `node_internals.h`
- `base_object-inl.h`
- `env-inl.h`
- `node_mem-inl.h`
- `util-inl.h`

### 4. Error Handling System

```cpp
// Internal error macros
THROW_ERR_INVALID_ARG_TYPE(env, "Database must be a string");
CHECK_ERROR_OR_THROW(env, r, SQLITE_OK, void());
```

- Custom error throwing macros
- Integrated with Node.js error codes
- Not available in public API

### 5. Memory Tracking

```cpp
void MemoryInfo(MemoryTracker* tracker) const override {
  tracker->TrackField("stmt", stmt_);
}
```

- Integrates with heap snapshot system
- Required for all BaseObject derivatives
- Not relevant for addons

### 6. ThreadPoolWork Integration

```cpp
class NodeSqliteWork : public ThreadPoolWork {
  // Uses internal libuv thread pool
};
```

- Direct integration with libuv thread pool
- Not exposed to addon developers

## Our Solution: Shim Layer

Instead of rewriting from scratch, we created a shim layer (`src/shims/`) that provides minimal implementations of these Node.js internals:

### 1. BaseObject → Napi::ObjectWrap

```cpp
// Our shim
template <typename T>
class BaseObject : public Napi::ObjectWrap<T> {
  // Simplified using N-API patterns
};
```

### 2. Environment → Minimal Implementation

```cpp
// Our shim provides just what SQLite needs
class Environment {
  Napi::Env env_;
  std::unordered_map<std::string, napi_ref> string_cache_;
  // Basic functionality only
};
```

### 3. Error Handling → N-API

```cpp
// Convert internal macros to N-API
#define THROW_ERR_INVALID_ARG_TYPE(env, msg) \
  Napi::TypeError::New(env, msg).ThrowAsJavaScriptException()
```

### 4. Memory Tracking → Stub

```cpp
// Stub implementation since we don't need heap snapshots
class MemoryTracker {
  template<typename T> void TrackField(const char*, T) {}
};
```

### 5. ThreadPoolWork → std::thread

```cpp
// Use standard C++ threading with ThreadSafeFunction
void QueueWork(std::function<void()> work) {
  std::thread([work]() { work(); }).detach();
}
```

## Key Adaptations Made

1. **V8 API → N-API**: Converted all direct V8 API usage to N-API equivalents
2. **Internal Classes → N-API Patterns**: Replaced BaseObject with Napi::ObjectWrap
3. **Error System → N-API Exceptions**: Adapted error handling to use N-API
4. **String Caching → Local Implementation**: Created simple string cache for performance
5. **Memory Tracking → Removed**: Not needed for addon use case

## Benefits of This Approach

1. **Maintains Compatibility**: Same API surface as Node.js built-in
2. **Preserves Logic**: SQLite usage patterns remain identical
3. **Easier Updates**: Can sync with upstream changes
4. **Cross-Version Support**: Works with any Node.js version that has N-API

## Alternative Approaches Considered

1. **Complete Rewrite**: Would lose compatibility and require extensive testing
2. **Fork Node.js**: Would require users to use custom Node.js build
3. **Wait for Public API**: Node.js SQLite is still experimental

## Conclusion

The shim layer approach allows us to ship a standalone npm package that:

- Works across all Node.js versions
- Doesn't require Node.js source code
- Maintains full API compatibility
- Can track upstream improvements

While this required significant effort to create the compatibility layer, it provides the best balance between compatibility, maintainability, and usability.
