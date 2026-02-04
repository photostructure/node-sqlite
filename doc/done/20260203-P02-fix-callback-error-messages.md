# TPP: Fix Callback Error Message Extraction in applyChangeset

## Goal Definition

- **What Success Looks Like**: When JS callbacks in `applyChangeset` throw errors, the thrown value is preserved in the re-thrown error message
- **Core Problem**: `throw "some error"` (primitive) becomes `"onConflict callback threw an exception"` instead of `"some error"`
- **Key Constraints**: Must handle both `throw new Error("msg")` and `throw "primitive"` - match node:sqlite behavior
- **Success Validation**: `npm run test:node -- --test-name-pattern="conflict resolution handler throws|filter handler throws"`

## ✅ COMPLETED

### Solution Summary

The issue was a misunderstanding of how `Napi::Error::Value()` works with `GetAndClearPendingException()`.

**Root Cause**: When JavaScript throws a primitive like `throw "string"`, `env.GetAndClearPendingException()` returns a `Napi::Error` where `err.Value()` IS the original primitive (a string), NOT an Error wrapper object.

**The Fix**: When `Message()` is empty (primitives don't have `.message`), call `err.Value().ToString()` directly instead of trying to access `ERROR_WRAP_VALUE` property.

The `ERROR_WRAP_VALUE` property only exists when you CATCH a `Napi::Error` as a C++ exception in a catch block - it's the node-addon-api mechanism for preserving primitives across the C++/JS boundary when exceptions are thrown. But when using `GetAndClearPendingException()`, the original value is already unwrapped.

### Key Insight from node-addon-api

From `node-addon-api/test/error.cc` line 306-310:

```cpp
Value CatchError(const CallbackInfo& info) {
  // ...
  if (env.IsExceptionPending()) {
    Error e = env.GetAndClearPendingException();
    return e.Value();  // Returns ORIGINAL exception value
  }
}
```

### Changes Made

**File**: `src/sqlite_impl.cpp` (lines 1589-1632)

```cpp
static std::string GetErrorMessage(const Napi::Error &err,
                                   const char *fallback) {
  // Try 1: Message() works for Error objects with .message property
  try {
    std::string msg = err.Message();
    if (!msg.empty()) {
      return msg;
    }
  } catch (...) {}

  // Try 2: For primitives, err.Value() IS the original thrown value
  try {
    Napi::Value val = err.Value();
    if (!val.IsEmpty() && !val.IsUndefined() && !val.IsNull()) {
      return val.ToString().Utf8Value();
    }
  } catch (...) {}

  // Try 3: ERROR_WRAP_VALUE property (for C++ catch blocks)
  try {
    Napi::Value val = err.Value();
    if (val.IsObject()) {
      Napi::Object errObj = val.As<Napi::Object>();
      static const char *ERROR_WRAP_VALUE =
          "4bda9e7e-4913-4dbc-95de-891cbf66598e-errorVal";
      Napi::Value wrapped = errObj.Get(ERROR_WRAP_VALUE);
      if (!wrapped.IsUndefined()) {
        return wrapped.ToString().Utf8Value();
      }
    }
  } catch (...) {}

  return fallback;
}
```

## Validation Results

All tests pass:

```bash
$ npm t -- --testNamePattern="string errors thrown"
# PASS - 2 tests passing

$ npm run test:node -- --test-name-pattern="conflict resolution handler throws|filter handler throws"
# ✔ conflict resolution handler throws
# ✔ filter handler throws

$ npm t
# 793 passed, 22 skipped

$ npm run lint
# 0 errors, 3 warnings
```

### Completion checklist

- [x] `throw new Error("msg")` preserves "msg"
- [x] `throw "primitive"` preserves "primitive"
- [x] `throw 42` preserves "42"
- [x] No regressions: `npm t` passes
- [x] Lint passes: `npm run lint`

## Tribal Knowledge

### ERROR_WRAP_VALUE vs GetAndClearPendingException

- `ERROR_WRAP_VALUE` property is only relevant when catching `Napi::Error` as a C++ exception
- When using `GetAndClearPendingException()`, `err.Value()` returns the original exception value directly
- The documentation about primitive wrapping in `node-addon-api/doc/error_handling.md` describes a different code path

### Why the Previous Implementation Failed

The old code assumed `err.Value()` was always an object and tried to access properties on it:

```cpp
Napi::Object errObj = err.Value();  // FAILS if Value() is a primitive!
```

When JavaScript throws `throw "string"`, `err.Value()` returns a Napi::Value that IS the string, not an object. Casting to Object silently fails.

## References

- `node-addon-api/test/error.cc:300-310` - CatchError example showing `e.Value()` returns original exception
- `node-addon-api/doc/error_handling.md` - Documentation on exception handling
- `src/upstream/node_sqlite.cc:1854-1862` - Node.js uses `TryCatch::ReThrow()` which preserves original exception
