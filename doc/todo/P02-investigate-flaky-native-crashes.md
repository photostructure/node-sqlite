# TPP: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes

## Current Status: MULTIPLE FIXES IMPLEMENTED

**Two distinct root causes found and fixed.** CI validation ongoing.

### Evidence of Original Flakiness

Same commit (`80fa40d`) showed different failures across runs:

| Run ID      | Time     | Failed Alpine Jobs    |
| ----------- | -------- | --------------------- |
| 21346776312 | 4:56:24Z | **None - all passed** |
| 21346793811 | 4:57:29Z | x64/23, arm64/24      |
| 21347456610 | 5:36:26Z | x64/20, arm64/23      |

Crash signals: `SIGSEGV` (segfault), `SIGTRAP` (assertion)
Affected tests: `extension-loading.test.ts`, `session-lifecycle.test.ts`, `session-callback-error-handling.test.ts`

---

## Root Cause #1: BackupJob Use-After-Free (Fixed 2026-01-26)

**The bug**: `BackupJob` held a raw pointer to `DatabaseSync*` but nothing prevented the database from closing while backup ran on worker thread.

**How it manifested**:

1. User starts backup (`db.backup(...)`)
2. `BackupJob::Execute()` runs on worker thread
3. Database closes (test cleanup, GC, etc.)
4. Worker thread accesses `source_->connection()` → **SIGSEGV**

**Fix**: Capture connection pointer at construction, track backups in database, finalize before close.

---

## Root Cause #2: Session Lifecycle Issues (Fixed 2026-01-27)

**Three related bugs** in Session handling caused SIGSEGV specifically on Alpine/musl:

### Bug 2a: Session Database Use-After-Free

**The bug**: `Session` stored raw `DatabaseSync*` without preventing database from being garbage collected.

**How it manifested**:

1. Session is created, holds raw `database_` pointer
2. JavaScript loses reference to database object
3. GC runs and frees DatabaseSync
4. Session accesses `database_->RemoveSession(this)` → **SIGSEGV**

**Fix**: Added `Napi::ObjectReference database_ref_` to Session (matching StatementSync pattern).

**Commit**: `a151cb6`

### Bug 2b: DeleteAllSessions Bypassed Reference Release

**The bug**: When `db.close()` calls `DeleteAllSessions()`, it directly sets `session->session_ = nullptr`, causing `Session::Delete()` to return early and never call `database_ref_.Reset()`.

**How it manifested**: Reference leak, potential issues during environment teardown.

**Fix**: Call `database_ref_.Reset()` in `DeleteAllSessions()` after cleaning up each session.

**Commit**: `fb283df`

### Bug 2c: Mutex Deadlock Causing SIGSEGV

**The bug**: `DeleteAllSessions()` held `sessions_mutex_` while calling `database_ref_.Reset()`. Reset can trigger GC, which finalizes other Session objects, which call `Delete()` → `RemoveSession()` → tries to lock already-held mutex → **undefined behavior**.

**How it manifested**:

1. `DeleteAllSessions()` acquires `sessions_mutex_`
2. Calls `database_ref_.Reset()` on a Session
3. GC is triggered and finalizes another Session
4. That Session's destructor calls `Delete()` → `RemoveSession()`
5. `RemoveSession()` tries to lock `sessions_mutex_` (same thread!)
6. `std::mutex` is NOT recursive → **undefined behavior** → SIGSEGV on musl

**Why only Alpine/musl?**: musl's more aggressive GC timing and different memory layout made this race condition more likely to trigger than on glibc.

**Fix**: Release mutex before the cleanup loop. Since `sessions_` is cleared first, any `RemoveSession()` calls become no-ops.

**Commit**: `dadbb86`

### Bug 2d: Double-Free in DeleteAllSessions During GC

**The bug**: `DeleteAllSessions()` interleaved SQLite cleanup and `database_ref_.Reset()` calls in a single loop. When `Reset()` triggers GC, other Session objects in the iteration list may be finalized, causing their destructors to call `sqlite3session_delete()` on sessions that the loop will later process.

**How it manifested**:

1. `DeleteAllSessions()` iterates over `sessions_copy`
2. For session X: `sqlite3session_delete(X)`, `X->session_ = nullptr`, `X->database_ref_.Reset()`
3. `Reset()` triggers GC which finalizes session Y (also in `sessions_copy`, not yet processed)
4. Y's destructor calls `Delete()` → `sqlite3session_delete(Y->session_)` (Y's session_ is still valid!)
5. Loop continues to Y → calls `sqlite3session_delete(Y)` again → **double-free → SIGABRT**

**Fix**: Split cleanup into two passes:
1. Pass 1: Delete all SQLite sessions and clear all `session_` pointers
2. Pass 2: Release database references (can trigger GC, but Delete() is now a no-op for all sessions)

**Commit**: `3a6aaff`

---

## Fixes Implemented

### Session Fixes (Commits: a151cb6, fb283df, dadbb86, 3a6aaff)

**[src/sqlite_impl.h](../../src/sqlite_impl.h)**:

```cpp
// Added to Session class (matching StatementSync pattern)
Napi::ObjectReference database_ref_;
```

**[src/sqlite_impl.cpp](../../src/sqlite_impl.cpp)**:

1. `Session::SetSession()` - Create persistent reference:

   ```cpp
   database_ref_ = Napi::Persistent(database->Value());
   ```

2. `Session::Delete()` - Release reference:

   ```cpp
   if (!database_ref_.IsEmpty()) {
     database_ref_.Reset();
   }
   ```

3. `DeleteAllSessions()` - Two-pass cleanup to prevent double-free:

   ```cpp
   std::set<Session *> sessions_copy;
   {
     std::lock_guard<std::mutex> lock(sessions_mutex_);
     sessions_copy = sessions_;
     sessions_.clear();  // RemoveSession() becomes no-op
   }
   // Pass 1: Delete SQLite sessions and clear pointers
   for (auto *session : sessions_copy) {
     if (session->GetSession()) {
       sqlite3session_delete(session->GetSession());
       session->session_ = nullptr;  // Makes Delete() a no-op
     }
   }
   // Pass 2: Release references (can trigger GC safely now)
   for (auto *session : sessions_copy) {
     if (!session->database_ref_.IsEmpty()) {
       session->database_ref_.Reset();
     }
   }
   ```

### Verification Commands

```bash
# Find all session-related reference handling
grep -n "database_ref_" src/sqlite_impl.cpp src/sqlite_impl.h

# Verify mutex release pattern in DeleteAllSessions
grep -A30 "void DatabaseSync::DeleteAllSessions" src/sqlite_impl.cpp

# Verify similar pattern exists in StatementSync (known-good)
grep -n "database_ref_" src/sqlite_impl.cpp | grep -i statement
```

---

## Tribal Knowledge

### Pattern: Preventing GC of Parent Objects

When a child object (Session, Statement) holds a pointer to a parent (DatabaseSync), you **must** also hold a reference to prevent GC:

```cpp
// BAD: Raw pointer allows parent to be GC'd
DatabaseSync *database_;

// GOOD: Reference keeps parent alive
DatabaseSync *database_;              // For fast access
Napi::ObjectReference database_ref_;  // Prevents GC
```

**Why both?** The ObjectReference holds the parent alive, but calling methods via `database_ref_.Value()` on every access is expensive. Keep the raw pointer for performance.

### Pattern: Mutex and GC Don't Mix

**Never** hold a mutex while calling code that can trigger GC:

```cpp
// BAD: Reset() can trigger GC, which may try to acquire same mutex
std::lock_guard<std::mutex> lock(mutex_);
for (auto* obj : objects_) {
  obj->ref_.Reset();  // GC → destructor → tries to lock mutex_ → UB
}

// GOOD: Release mutex before operations that can trigger GC
std::set<Object*> copy;
{
  std::lock_guard<std::mutex> lock(mutex_);
  copy = objects_;
  objects_.clear();  // Makes RemoveObject() a no-op
}
// Now safe - no mutex held
for (auto* obj : copy) {
  obj->ref_.Reset();
}
```

### Why Only Alpine/musl?

1. **Different GC timing**: musl's allocator has different behavior
2. **Different memory layout**: Affects when/how freed memory gets reused
3. **Smaller default stack**: May affect call depth where crashes happen
4. **No recursive mutex protection**: glibc may be more forgiving of mistakes

### Files to Study

| File                            | What to Look For                    |
| ------------------------------- | ----------------------------------- |
| `src/sqlite_impl.cpp:1516-1545` | DeleteAllSessions mutex pattern     |
| `src/sqlite_impl.cpp:2977-2989` | Session::SetSession reference setup |
| `src/sqlite_impl.cpp:2991-3013` | Session::Delete cleanup             |
| `src/sqlite_impl.cpp:1787-1797` | StatementSync reference pattern     |

---

## Audit: Other Potential Issues

### Checked and Safe

| Component      | Has Reference? | Bulk Cleanup?    | Status |
| -------------- | -------------- | ---------------- | ------ |
| StatementSync  | Yes            | No bulk cleanup  | Safe   |
| Session        | Yes (fixed)    | DeleteAllSessions| Fixed  |
| BackupJob      | N/A (captures) | FinalizeBackups  | Safe   |

### How to Check for Similar Issues

```bash
# Find all ObjectReference members
grep -n "ObjectReference\|FunctionReference" src/sqlite_impl.h

# Find all bulk cleanup functions
grep -n "DeleteAll\|FinalizeAll\|ClearAll" src/sqlite_impl.cpp

# Find all mutex usages
grep -n "lock_guard\|mutex_" src/sqlite_impl.cpp
```

---

## Validation

- [x] Root causes identified and documented
- [x] Session fixes implemented (3 commits)
- [x] Local tests pass: `npm t` (793 tests)
- [x] Linting passes: `npm run lint`
- [ ] **REMAINING: CI validation on Alpine**

### Test Commands

```bash
# Full test suite
npm run build:native:rebuild && npm run build:dist && npm test

# Session-specific tests
npm test -- session-lifecycle session-callback

# Local Alpine test
docker run --rm -v "$(pwd)":/host:ro node:22-alpine sh -c '\
  cp -r /host /work && cd /work && \
  apk add build-base python3 py3-setuptools && \
  npm ci --ignore-scripts && npx node-gyp rebuild && \
  npm run build:dist && npm test -- --no-coverage'
```

---

## Remaining Work

### Task: Validate CI Stability

**Success**: CI runs pass without SIGSEGV on Alpine

**Implementation**:

1. Push fixes (already committed locally)
2. Monitor CI runs for Alpine test-alpine jobs
3. If crashes persist on different tests, investigate new location

**If crashes continue**:

1. Check which test file crashes (may shift around due to Jest worker assignment)
2. Look for pattern: Does crash always involve Session, Statement, or Backup?
3. Check for other `ObjectReference` cleanup paths: `grep -n "\.Reset()" src/*.cpp`

**Completion checklist**:

- [ ] Push changes
- [ ] test-alpine jobs pass for all Node versions (20, 22, 23, 24)
- [ ] test-alpine jobs pass for both architectures (x64, arm64)
- [ ] No SIGSEGV/SIGTRAP crashes in 5+ consecutive runs
- [ ] Move TPP to `doc/done/`

---

## Commits Summary

| Commit    | Description                                          |
| --------- | ---------------------------------------------------- |
| `a151cb6` | Add `database_ref_` to Session                       |
| `fb283df` | Release `database_ref_` in DeleteAllSessions         |
| `dadbb86` | Release mutex before GC-triggering operations        |
| `3a6aaff` | Two-pass cleanup to prevent double-free during GC    |
| `5d86172` | Fix multi-process test expected values (unrelated)   |
