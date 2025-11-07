# Critical Fixes Technical Project Plan

This document outlines critical issues discovered during comprehensive code review and their planned fixes following TDD methodology and Simple Design principles.

**Status**: Planning Phase
**Created**: 2025-11-06
**Priority**: Critical issues must be fixed before production use

---

## Issue 1: Backup Job Database Handle Leak

**Severity**: CRITICAL
**File**: `src/sqlite_impl.cpp`
**Lines**: 2523-2539
**Category**: Resource Management

### Problem Description

When `sqlite3_open_v2()` succeeds but `sqlite3_backup_init()` fails, the destination database handle (`dest_`) is not closed before returning, creating a database handle leak.

```cpp
backup_status_ = sqlite3_open_v2(
    destination_path_.c_str(), &dest_,
    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI, nullptr);

if (backup_status_ != SQLITE_OK) {
  SetError("Failed to open destination database");
  return;  // dest_ is nullptr here, OK
}

// Initialize backup
backup_ = sqlite3_backup_init(dest_, dest_db_.c_str(), source_->connection(),
                              source_db_.c_str());

if (!backup_) {
  SetError("Failed to initialize backup");
  return;  // LEAK: dest_ is open but never closed!
}
```

### Proposed Solution

Add cleanup code when `backup_` initialization fails:

```cpp
if (!backup_) {
  SetError("Failed to initialize backup");
  if (dest_) {
    sqlite3_close_v2(dest_);
    dest_ = nullptr;
  }
  return;
}
```

### Test Strategy

1. Create test that attempts backup with invalid source database name
2. Test should trigger `sqlite3_backup_init()` failure after successful `sqlite3_open_v2()`
3. Verify no resource leak (may need valgrind or manual validation)
4. Confirm proper error message is returned

### Acceptance Criteria

- [ ] Test reproduces the leak condition
- [ ] Test fails before fix (if leak detection available)
- [ ] Fix applied cleanly
- [ ] Test passes after fix
- [ ] Full test suite passes (`npm test`)
- [ ] No regressions in backup functionality

---

## Issue 2: NULL Pointer from sqlite3_column_text()

**Severity**: CRITICAL
**File**: `src/sqlite_impl.cpp`
**Lines**: 2117-2118, 2174-2175
**Category**: SQLite API Usage

### Problem Description

`sqlite3_column_text()` can return NULL on memory allocation failure or encoding errors. The code does not check for NULL before passing to `Napi::String::New()`, which could cause a crash.

```cpp
case SQLITE_TEXT: {
  const unsigned char *text = sqlite3_column_text(statement_, i);
  return Napi::String::New(env, reinterpret_cast<const char *>(text));
  // No NULL check - will crash if text is NULL
}
```

This appears in two locations:
- Array mode CreateResult (line 2117-2118)
- Object mode CreateResult (line 2174-2175)

### Proposed Solution

Add NULL checks before creating strings:

```cpp
case SQLITE_TEXT: {
  const unsigned char *text = sqlite3_column_text(statement_, i);
  if (!text) {
    value = Napi::String::New(env, "");  // or env.Null() if appropriate
  } else {
    value = Napi::String::New(env, reinterpret_cast<const char *>(text));
  }
  break;
}
```

### Test Strategy

1. Create test with zero-length TEXT column
2. Create test with NULL TEXT column
3. Test both array and object return modes
4. Verify no crash and appropriate value returned

### Acceptance Criteria

- [ ] Test with zero-length string passes
- [ ] Test with NULL value passes
- [ ] Both array and object modes tested
- [ ] No crashes on edge cases
- [ ] Full test suite passes

---

## Issue 3: NULL Pointer from sqlite3_column_blob()

**Severity**: CRITICAL
**File**: `src/sqlite_impl.cpp`
**Lines**: 2122-2130, 2179-2187
**Category**: SQLite API Usage

### Problem Description

`sqlite3_column_blob()` returns NULL for zero-length BLOBs or in OOM conditions. While the code handles `blob_size == 0`, it still passes potentially NULL `blob_data` to `Napi::Buffer::Copy()` which is undefined behavior.

```cpp
case SQLITE_BLOB: {
  const void *blob_data = sqlite3_column_blob(statement_, i);
  int blob_size = sqlite3_column_bytes(statement_, i);
  if (blob_size == 0) {
    value = Napi::Buffer<uint8_t>::New(env, 0);
  } else {
    // blob_data could be NULL here!
    value = Napi::Buffer<uint8_t>::Copy(
        env, static_cast<const uint8_t *>(blob_data), blob_size);
  }
  break;
}
```

### Proposed Solution

Add explicit NULL check:

```cpp
case SQLITE_BLOB: {
  const void *blob_data = sqlite3_column_blob(statement_, i);
  int blob_size = sqlite3_column_bytes(statement_, i);
  if (!blob_data || blob_size == 0) {
    value = Napi::Buffer<uint8_t>::New(env, 0);
  } else {
    value = Napi::Buffer<uint8_t>::Copy(
        env, static_cast<const uint8_t *>(blob_data), blob_size);
  }
  break;
}
```

### Test Strategy

1. Create test with zero-length BLOB column
2. Create test with NULL BLOB column
3. Test both array and object return modes
4. Verify correct buffer returned (empty for NULL/zero)

### Acceptance Criteria

- [ ] Zero-length BLOB test passes
- [ ] NULL BLOB test passes
- [ ] Both return modes tested
- [ ] Correct empty buffer returned
- [ ] Full test suite passes

---

## Issue 4: NULL Pointer from sqlite3_value_text() in User Functions

**Severity**: CRITICAL
**File**: `src/user_function.cpp`
**Lines**: 160-161
**Category**: SQLite API Usage

### Problem Description

User-defined functions don't check for NULL return from `sqlite3_value_text()`:

```cpp
case SQLITE_TEXT: {
  const unsigned char *text = sqlite3_value_text(value);
  return Napi::String::New(env_, reinterpret_cast<const char *>(text));
  // No NULL check
}
```

### Proposed Solution

```cpp
case SQLITE_TEXT: {
  const unsigned char *text = sqlite3_value_text(value);
  if (!text) {
    return env_.Null();  // or empty string
  }
  return Napi::String::New(env_, reinterpret_cast<const char *>(text));
}
```

### Test Strategy

1. Create user-defined function
2. Pass zero-length string as argument
3. Pass NULL as argument
4. Verify function handles both cases without crash

### Acceptance Criteria

- [ ] User function with NULL text argument works
- [ ] User function with zero-length string works
- [ ] Appropriate return value (null or empty string)
- [ ] Full test suite passes

---

## Issue 5: NULL Pointer from sqlite3_value_blob() in User Functions

**Severity**: CRITICAL
**File**: `src/user_function.cpp`
**Lines**: 165-168
**Category**: SQLite API Usage

### Problem Description

Similar to Issue 4, but for BLOB values:

```cpp
case SQLITE_BLOB: {
  const void *blob_data = sqlite3_value_blob(value);
  int blob_size = sqlite3_value_bytes(value);
  return Napi::Buffer<uint8_t>::Copy(
      env_, static_cast<const uint8_t *>(blob_data), blob_size);
  // No NULL check, undefined behavior if blob_data is NULL
}
```

### Proposed Solution

```cpp
case SQLITE_BLOB: {
  const void *blob_data = sqlite3_value_blob(value);
  int blob_size = sqlite3_value_bytes(value);
  if (!blob_data || blob_size == 0) {
    return Napi::Buffer<uint8_t>::New(env_, 0);
  }
  return Napi::Buffer<uint8_t>::Copy(
      env_, static_cast<const uint8_t *>(blob_data), blob_size);
}
```

### Test Strategy

1. Create user-defined function accepting BLOB
2. Pass zero-length BLOB as argument
3. Pass NULL as argument
4. Verify correct handling

### Acceptance Criteria

- [ ] User function with NULL BLOB argument works
- [ ] User function with zero-length BLOB works
- [ ] Appropriate empty buffer returned
- [ ] Full test suite passes

---

## Issue 6: Missing Exception Checks in Aggregate Functions

**Severity**: CRITICAL
**File**: `src/aggregate_function.cpp`
**Lines**: 289-296, 433-439, 468-471
**Category**: N-API Usage

### Problem Description

After `napi_call_function()`, the code checks `status != napi_ok` but does NOT check for pending JavaScript exceptions. This violates N-API contract because N-API calls can succeed but still have pending exceptions.

```cpp
napi_status status =
    napi_call_function(self->env_, self->env_.Undefined(), func,
                       raw_args.size(), raw_args.data(), &result);

if (status != napi_ok) {
    sqlite3_result_error(ctx, "Error calling aggregate step function", -1);
    return;
}
// Missing: Check for pending exceptions!
```

The correct pattern exists in `user_function.cpp:100-108`.

### Proposed Solution

Add exception checking after EVERY `napi_call_function()`:

```cpp
napi_status status =
    napi_call_function(self->env_, self->env_.Undefined(), func,
                       raw_args.size(), raw_args.data(), &result);

if (status != napi_ok || self->env_.IsExceptionPending()) {
    if (self->env_.IsExceptionPending()) {
        self->env_.GetAndClearPendingException();
    }
    sqlite3_result_error(ctx, "Error calling aggregate step function", -1);
    return;
}
```

Apply to:
- `xStepBase()` around line 289-296
- `xInverseBase()` around line 433-439
- `xValueBase()` around line 468-471
- `xFinalBase()` (check for similar pattern)

### Test Strategy

1. Create aggregate function that throws JavaScript exception
2. Use aggregate in SQL query
3. Verify exception is caught and error propagated correctly
4. Verify no undefined behavior or crashes

### Acceptance Criteria

- [ ] Test with throwing aggregate function passes
- [ ] Exception properly caught and cleared
- [ ] Error returned to SQLite
- [ ] All four callback types fixed
- [ ] Full test suite passes

---

## Issue 7: Missing CallbackScope in Aggregate Functions

**Severity**: HIGH
**File**: `src/aggregate_function.cpp`
**Lines**: 154-296 (xStepBase), 370-446 (xValueBase), etc.
**Category**: N-API Usage

### Problem Description

Aggregate function callbacks create `HandleScope` but NOT `CallbackScope`, violating N-API best practices. This can cause async hooks to not fire correctly.

Current code:
```cpp
void CustomAggregate::xStepBase(...) {
    Napi::HandleScope scope(self->env_);
    // NO CallbackScope!
    // Calls into JavaScript...
}
```

Correct pattern from `user_function.cpp:57`:
```cpp
Napi::HandleScope scope(self->env_);
Napi::CallbackScope callback_scope(self->env_, self->async_context_);
```

### Proposed Solution

Add `CallbackScope` creation after `HandleScope` in:
- `xStepBase()` (line ~159)
- `xInverseBase()` (line ~313)
- `xValueBase()` (line ~375)
- `xFinalBase()` (line ~414)

```cpp
Napi::HandleScope scope(self->env_);
Napi::CallbackScope callback_scope(self->env_, self->async_context_);
```

Ensure `async_context_` is properly initialized (check constructor).

### Test Strategy

1. Test aggregate functions work correctly
2. Consider async_hooks test if feasible
3. Verify no regressions

### Acceptance Criteria

- [ ] All four callback functions updated
- [ ] async_context_ properly managed
- [ ] Pattern matches user functions
- [ ] Full test suite passes

---

## Issue 8: Thread Validation Missing in Database Methods

**Severity**: CRITICAL
**File**: `src/sqlite_impl.cpp`
**Lines**: 576-610 (LocationMethod, IsOpenGetter, IsTransactionGetter)
**Category**: Thread Safety

### Problem Description

Several DatabaseSync methods access `connection_` pointer without validating the calling thread. While `ValidateThread()` method exists, it's not called in:
- `LocationMethod()` (line 576-600)
- `IsOpenGetter()` (line 602-604)
- `IsTransactionGetter()` (line 606-610)
- Potentially others

This allows cross-thread access to SQLite handles, causing crashes.

### Proposed Solution

Add `ValidateThread()` call at the start of each method:

```cpp
Napi::Value DatabaseSync::IsOpenGetter(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!ValidateThread(env)) {
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, IsOpen());
}
```

### Test Strategy

1. Identify all DatabaseSync methods that access `connection_` or other instance data
2. Audit which ones are missing `ValidateThread()`
3. Add validation to all of them
4. Test with worker threads if possible

### Acceptance Criteria

- [ ] All database methods have thread validation
- [ ] Audit completed and documented
- [ ] Thread validation consistent across class
- [ ] Full test suite passes

---

## Issue 9: Thread Validation Missing in Callback Functions

**Severity**: CRITICAL
**File**: `src/user_function.cpp`, `src/aggregate_function.cpp`
**Lines**: Various callback entry points
**Category**: Thread Safety

### Problem Description

User function and aggregate function callbacks access N-API objects (`env_`, `fn_`) without verifying they're on the correct thread. N-API objects are thread-specific and MUST only be accessed from the thread that created them.

SQLite in serialized mode allows connections to be used from multiple threads, which means callbacks could be invoked from ANY thread.

```cpp
void UserDefinedFunction::xFunc(sqlite3_context *ctx, int argc,
                                sqlite3_value **argv) {
  // CRITICAL: No thread validation before accessing N-API objects!
  Napi::HandleScope scope(self->env_);
  // If this runs on wrong thread, it will crash
}
```

### Proposed Solution

Add thread ID validation at callback entry:

```cpp
void UserDefinedFunction::xFunc(sqlite3_context *ctx, int argc,
                                sqlite3_value **argv) {
  void *user_data = sqlite3_user_data(ctx);
  if (!user_data) {
    sqlite3_result_error(ctx, "Invalid user data", -1);
    return;
  }

  UserDefinedFunction *self = static_cast<UserDefinedFunction *>(user_data);

  // Verify we're on the correct thread
  if (std::this_thread::get_id() != self->creation_thread_) {
    sqlite3_result_error(ctx,
      "User function called from wrong thread - not supported", -1);
    return;
  }

  // Now safe to proceed with N-API objects
  Napi::HandleScope scope(self->env_);
  // ...
}
```

Add `creation_thread_` member to classes if not already present.

Apply to:
- `UserDefinedFunction::xFunc()`
- `CustomAggregate::xStepBase()`
- `CustomAggregate::xInverseBase()`
- `CustomAggregate::xValueBase()`
- `CustomAggregate::xFinalBase()`

### Test Strategy

1. Test that functions work normally (single thread)
2. Document limitation that user functions are not thread-safe
3. Consider worker thread test to verify error message

### Acceptance Criteria

- [ ] All callbacks have thread validation
- [ ] Clear error message on wrong-thread access
- [ ] Documentation updated about thread safety
- [ ] Full test suite passes

---

## Issue 10: TOCTOU Race in ValueStorage::Get()

**Severity**: CRITICAL
**File**: `src/aggregate_function.cpp`
**Lines**: 34-38
**Category**: Thread Safety

### Problem Description

Time-of-check-time-of-use race between `find()` and `.Value()` access:

```cpp
Napi::Value ValueStorage::Get(Napi::Env env, int32_t id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  auto it = storage_.find(id);
  // RACE: Between this check and .Value(), another thread could Remove()
  return (it != storage_.end()) ? it->second.Value() : env.Undefined();
}
```

### Proposed Solution

Copy the reference while holding the lock:

```cpp
Napi::Value ValueStorage::Get(Napi::Env env, int32_t id) {
  Napi::Reference<Napi::Value> ref;
  {
    const std::lock_guard<std::mutex> lock(mutex_);
    auto it = storage_.find(id);
    if (it == storage_.end()) {
      return env.Undefined();
    }
    // Copy the reference while holding the lock
    ref = it->second;
  }
  // Access .Value() outside the lock (reference is valid)
  return ref.Value();
}
```

### Test Strategy

1. May be difficult to test race condition directly
2. Verify correct behavior in single-threaded case
3. Code review validates fix

### Acceptance Criteria

- [ ] Fix applied correctly
- [ ] Reference semantics correct
- [ ] No deadlocks introduced
- [ ] Full test suite passes

---

## Issue 11: Missing Error Checks on sqlite3_bind_*()

**Severity**: HIGH
**File**: `src/sqlite_impl.cpp`
**Lines**: 1913-2040
**Category**: SQLite API Usage

### Problem Description

None of the `sqlite3_bind_*()` calls check return codes. These functions can fail with `SQLITE_RANGE`, `SQLITE_NOMEM`, or `SQLITE_TOOBIG`, leading to silent parameter binding failures.

```cpp
sqlite3_bind_null(statement_, param_index);
// No error checking - binding could fail silently!
```

### Proposed Solution

Add error checking to all bind operations:

```cpp
int result = sqlite3_bind_null(statement_, param_index);
if (result != SQLITE_OK) {
  std::string error = "Failed to bind parameter: ";
  error += sqlite3_errstr(result);
  throw std::runtime_error(error);
}
```

Or create a helper function to reduce duplication:

```cpp
void CheckBindResult(int result) {
  if (result != SQLITE_OK) {
    std::string error = "Failed to bind parameter: ";
    error += sqlite3_errstr(result);
    throw std::runtime_error(error);
  }
}
```

### Test Strategy

1. Test binding with out-of-range parameter index
2. Test binding very large values (SQLITE_TOOBIG)
3. Verify proper error propagation

### Acceptance Criteria

- [ ] All sqlite3_bind_*() calls have error checking
- [ ] Consistent error handling pattern
- [ ] Tests verify error detection
- [ ] Full test suite passes

---

## Issue 12: Unchecked sqlite3_exec() for PRAGMA foreign_keys

**Severity**: HIGH
**File**: `src/sqlite_impl.cpp`
**Lines**: 641-643
**Category**: SQLite API Usage

### Problem Description

The return value of `sqlite3_exec()` for enabling foreign keys is not checked:

```cpp
if (config_.get_enable_foreign_keys()) {
  sqlite3_exec(connection(), "PRAGMA foreign_keys = ON", nullptr, nullptr,
               nullptr);  // No error checking!
}
```

Foreign key constraints may silently fail to enable.

### Proposed Solution

Check return value and handle errors:

```cpp
if (config_.get_enable_foreign_keys()) {
  int result = sqlite3_exec(connection(), "PRAGMA foreign_keys = ON",
                           nullptr, nullptr, nullptr);
  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(connection());
    SqliteException ex(connection_, result,
                       "Failed to enable foreign keys: " + error);
    sqlite3_close(connection_);
    connection_ = nullptr;
    throw ex;
  }
}
```

### Test Strategy

1. Test that foreign keys are actually enabled
2. Test error handling if PRAGMA fails
3. Verify database closes on error

### Acceptance Criteria

- [ ] Error checking added
- [ ] Test verifies foreign keys enabled
- [ ] Error path tested
- [ ] Full test suite passes

---

## Issue 13: Unchecked sqlite3_busy_timeout()

**Severity**: HIGH
**File**: `src/sqlite_impl.cpp`
**Lines**: 646
**Category**: SQLite API Usage

### Problem Description

Return value not checked:

```cpp
if (config_.get_timeout() > 0) {
  sqlite3_busy_timeout(connection(), config_.get_timeout());
  // No error checking
}
```

### Proposed Solution

```cpp
if (config_.get_timeout() > 0) {
  int result = sqlite3_busy_timeout(connection(), config_.get_timeout());
  if (result != SQLITE_OK) {
    std::string error = sqlite3_errmsg(connection());
    SqliteException ex(connection_, result,
                       "Failed to set busy timeout: " + error);
    sqlite3_close(connection_);
    connection_ = nullptr;
    throw ex;
  }
}
```

### Test Strategy

1. Test with valid timeout value
2. Test error handling
3. Verify timeout actually set

### Acceptance Criteria

- [ ] Error checking added
- [ ] Test verifies timeout setting
- [ ] Full test suite passes

---

## Issue 14: Session Creation Reference Leak

**Severity**: HIGH
**File**: `src/sqlite_impl.cpp`
**Lines**: 1081-1102
**Category**: Resource Management

### Problem Description

If `Session::Create()` throws an exception, the `pSession` handle is leaked:

```cpp
sqlite3_session *pSession;
int r = sqlite3session_create(connection(), db_name.c_str(), &pSession);

if (r != SQLITE_OK) {
  // ... properly cleaned up
}

r = sqlite3session_attach(pSession, table.empty() ? nullptr : table.c_str());

if (r != SQLITE_OK) {
  sqlite3session_delete(pSession);  // Properly cleaned up
  // ...
}

// Create and return the Session object
return Session::Create(env, this, pSession);  // If this throws, pSession leaks!
```

### Proposed Solution

Wrap in try-catch:

```cpp
try {
  return Session::Create(env, this, pSession);
} catch (...) {
  sqlite3session_delete(pSession);
  throw;
}
```

Or use RAII wrapper for session lifetime.

### Test Strategy

1. May be difficult to trigger exception in Create()
2. Code review validates fix
3. Verify normal path still works

### Acceptance Criteria

- [ ] Exception safety added
- [ ] Session tests pass
- [ ] No leaks in error paths
- [ ] Full test suite passes

---

## Implementation Order

Based on severity and dependencies, suggested order:

### Phase 1: Critical SQLite API Fixes (Low Risk, High Impact)
1. Issue 2: NULL checks for sqlite3_column_text()
2. Issue 3: NULL checks for sqlite3_column_blob()
3. Issue 4: NULL checks for sqlite3_value_text() in user functions
4. Issue 5: NULL checks for sqlite3_value_blob() in user functions

### Phase 2: Critical N-API Fixes
5. Issue 6: Exception checks in aggregate functions
6. Issue 7: Add CallbackScope to aggregates

### Phase 3: Critical Resource Leaks
7. Issue 1: Backup job database handle leak
8. Issue 14: Session creation reference leak

### Phase 4: Thread Safety (Most Complex)
9. Issue 10: TOCTOU race in ValueStorage::Get()
10. Issue 8: Thread validation in database methods
11. Issue 9: Thread validation in callbacks

### Phase 5: Additional SQLite API Hardening
12. Issue 11: Error checks on sqlite3_bind_*()
13. Issue 12: Check sqlite3_exec() for foreign keys
14. Issue 13: Check sqlite3_busy_timeout()

---

## Testing Strategy

Each issue should follow TDD principles:

1. **Write breaking test** - Reproduces the issue
2. **Validate test explodes** - Confirms it catches the bug
3. **Apply fix** - Minimal change to address issue
4. **Validate test passes** - Fix works
5. **Run full suite** - No regressions

After all fixes:
- Run full test suite on all platforms
- Run with Valgrind for leak detection
- Run with ThreadSanitizer for race detection
- Run with AddressSanitizer for memory safety

---

## Success Criteria

- [ ] All 14 issues addressed
- [ ] All new tests passing
- [ ] Full test suite passes (495+ tests)
- [ ] No new memory leaks (Valgrind clean)
- [ ] No race conditions (TSan clean)
- [ ] Documentation updated where needed
- [ ] Code review completed
- [ ] Changes follow Simple Design principles

---

## Notes

- Each fix should be minimal and focused
- Prefer extracting helpers over duplication (Rule 3)
- Ensure fixes match existing patterns (Rule 2)
- All changes must pass tests (Rule 1)
- No bogus defaults - fail visibly (Rule 5)
