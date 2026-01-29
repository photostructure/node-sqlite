# TPP: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes

## Current Status: FINAL FIX IMPLEMENTED

**Five distinct root causes found and fixed.** Testing shows no crashes in local Alpine Docker tests.

### Evidence of Original Flakiness

Same commit (`80fa40d`) showed different failures across runs:

| Run ID      | Time     | Failed Alpine Jobs    |
| ----------- | -------- | --------------------- |
| 21346776312 | 4:56:24Z | **None - all passed** |
| 21346793811 | 4:57:29Z | x64/23, arm64/24      |
| 21347456610 | 5:36:26Z | x64/20, arm64/23      |

Crash signals: `SIGSEGV` (segfault), `SIGTRAP` (assertion), `SIGABRT` (abort)
Affected tests: Various, shifting between runs due to Jest worker assignment

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

## Root Cause #2: Session Lifecycle Issues (Fixed 2026-01-27/28)

**Five related bugs** in Session handling caused crashes specifically on Alpine/musl:

### Bug 2a: Session Database Use-After-Free

**The bug**: `Session` stored raw `DatabaseSync*` without preventing database from being garbage collected.

**Fix**: Added `Napi::ObjectReference database_ref_` to Session (matching StatementSync pattern).

**Commit**: `a151cb6`

### Bug 2b: DeleteAllSessions Bypassed Reference Release

**The bug**: When `db.close()` calls `DeleteAllSessions()`, it directly sets `session->session_ = nullptr`, causing `Session::Delete()` to return early and never call `database_ref_.Reset()`.

**Fix**: Call `database_ref_.Reset()` in `DeleteAllSessions()` after cleaning up each session.

**Commit**: `fb283df`

### Bug 2c: Mutex Deadlock Causing SIGSEGV

**The bug**: `DeleteAllSessions()` held `sessions_mutex_` while calling `database_ref_.Reset()`. Reset can trigger GC, which finalizes other Session objects, which call `Delete()` → `RemoveSession()` → tries to lock already-held mutex → **undefined behavior**.

**Fix**: Release mutex before the cleanup loop.

**Commit**: `dadbb86`

### Bug 2d: Dangling Pointers During Iteration

**The bug**: Calling `database_ref_.Reset()` during iteration could trigger GC, which may finalize Session JS objects still in the iteration list, creating dangling pointers.

**Initial fix attempt**: Removed `Reset()` calls entirely from `DeleteAllSessions()`.

**Commit**: `e1a3fcb`

### Bug 2e: V8 JIT Corruption on Alpine During Jest Cleanup (FINAL FIX)

**The bug**: When Sessions are GC'd during Jest cleanup (process exit), their `Napi::ObjectReference` destructors call `Reset()`. On Alpine/musl, this corrupts V8's JIT page allocations.

**How it manifested**:

1. Tests pass, Jest begins cleanup
2. V8 runs GC, finalizing Session objects
3. Session destructors trigger `Napi::ObjectReference` cleanup
4. V8 JIT corruption: `Check failed: it != jit_page_->allocations_.end()`
5. **SIGSEGV** or **SIGABRT**

**Why it only happened on Alpine/musl**:

- Different GC timing during process exit
- musl's allocator behavior differs from glibc
- V8's JIT page management is more sensitive in this environment

**Key Insight**: The crash happens during Jest cleanup, NOT during normal test execution. Tests pass with `--forceExit` (which skips cleanup).

**The Fix**: Hold strong references to Session JS objects during `DeleteAllSessions()` cleanup, preventing GC from destroying them while we iterate. Then explicitly clear `database_ref_` for all sessions. When the temporary references are released, Sessions can be GC'd with already-empty `database_ref_`.

```cpp
void DatabaseSync::DeleteAllSessions() {
  std::set<Session *> sessions_copy;
  {
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    sessions_copy = sessions_;
    sessions_.clear();
  }

  // Hold strong references to prevent GC during iteration
  std::vector<Napi::ObjectReference> session_refs;
  session_refs.reserve(sessions_copy.size());
  for (auto *session : sessions_copy) {
    session_refs.push_back(Napi::Persistent(session->Value()));
  }

  // Pass 1: Clear SQLite sessions
  for (auto *session : sessions_copy) {
    if (session->GetSession()) {
      sqlite3session_delete(session->GetSession());
      session->session_ = nullptr;
    }
  }

  // Pass 2: Clear database references (might trigger GC, but safe)
  for (auto *session : sessions_copy) {
    if (!session->database_ref_.IsEmpty()) {
      session->database_ref_.Reset();
    }
  }
  // session_refs released here - Sessions can be GC'd with empty database_ref_
}
```

**Commit**: (pending)

---

## Reproduction Steps

The crash is **only reproducible in Alpine Docker containers running Jest**:

```bash
# This command reproduces the crash intermittently
docker run --rm -v "$(pwd)":/host:ro node:24-alpine sh -c '
  cp -r /host /work && cd /work &&
  apk add --no-cache build-base python3 py3-setuptools &&
  npm ci --ignore-scripts && npx node-gyp rebuild &&
  npm run build:dist &&
  # Run full suite multiple times - crashes during cleanup
  for i in $(seq 1 10); do
    node --expose-gc node_modules/jest/bin/jest.js --no-coverage
  done
'

# This does NOT crash (skips cleanup):
node --expose-gc node_modules/jest/bin/jest.js --no-coverage --forceExit

# This does NOT crash (not in Jest):
node --expose-gc -e '
  const { DatabaseSync } = require("./dist/index.cjs");
  for (let i = 0; i < 1000; i++) {
    const db = new DatabaseSync(":memory:");
    db.createSession();
    db.close();
  }
  if (global.gc) global.gc();
  console.log("Success");
'
```

---

## Tribal Knowledge

### Pattern: Preventing GC of Parent Objects

When a child object (Session, Statement) holds a pointer to a parent (DatabaseSync), you **must** also hold a reference to prevent GC:

```cpp
DatabaseSync *database_;              // For fast access
Napi::ObjectReference database_ref_;  // Prevents GC
```

### Pattern: Safe Bulk Cleanup with GC

When cleaning up multiple Napi objects that hold ObjectReferences:

```cpp
// BAD: GC can destroy objects during iteration
for (auto* obj : objects_copy) {
  obj->ref_.Reset();  // May trigger GC, destroying other objects in list
}

// GOOD: Hold references to prevent GC during iteration
std::vector<Napi::ObjectReference> refs;
for (auto* obj : objects_copy) {
  refs.push_back(Napi::Persistent(obj->Value()));
}
// Now safe to clean up
for (auto* obj : objects_copy) {
  obj->ref_.Reset();
}
// refs destructor releases, objects can be GC'd safely
```

### Why Only Alpine/musl?

1. **Different GC timing**: musl's allocator triggers GC at different points
2. **V8 JIT sensitivity**: musl's memory layout affects JIT page management
3. **Process exit behavior**: Cleanup phase differs from glibc
4. **No recursive mutex protection**: glibc may be more forgiving

### Files to Study

| File                            | What to Look For                    |
| ------------------------------- | ----------------------------------- |
| `src/sqlite_impl.cpp:1516-1560` | DeleteAllSessions final fix         |
| `src/sqlite_impl.cpp:2980-3020` | Session::Delete cleanup             |
| `src/sqlite_impl.cpp:1845-1853` | StatementSync reference pattern     |

---

## Validation

- [x] Root causes identified and documented
- [x] Session fixes implemented
- [x] Local tests pass: `npm t` (793 tests)
- [x] Alpine Docker tests pass without crashes (5+ runs)
- [x] Linting passes: `npm run lint`
- [ ] **REMAINING: CI validation on Alpine**

### Test Commands

```bash
# Full test suite
npm run build:native:rebuild && npm run build:dist && npm test

# Local Alpine test (the definitive test)
docker run --rm -v "$(pwd)":/host:ro node:24-alpine sh -c '
  cp -r /host /work && cd /work &&
  apk add --no-cache build-base python3 py3-setuptools &&
  npm ci --ignore-scripts && npx node-gyp rebuild &&
  npm run build:dist &&
  for i in $(seq 1 5); do
    echo "=== Run $i ==="
    node --expose-gc node_modules/jest/bin/jest.js --no-coverage
  done
'
```

---

## Commits Summary

| Commit    | Description                                               |
| --------- | --------------------------------------------------------- |
| `a151cb6` | Add `database_ref_` to Session                            |
| `fb283df` | Release `database_ref_` in DeleteAllSessions              |
| `dadbb86` | Release mutex before GC-triggering operations             |
| `e1a3fcb` | Remove Reset() from DeleteAllSessions (incomplete fix)    |
| (pending) | Hold refs during cleanup to prevent V8 JIT corruption     |

---

## Remaining Work

### Task: Push and Validate CI

**Success**: CI runs pass without SIGSEGV on Alpine

**Implementation**:

1. Commit the final fix (session_refs approach)
2. Push to trigger CI
3. Monitor Alpine test jobs

**Completion checklist**:

- [ ] Commit pushed
- [ ] test-alpine jobs pass for all Node versions (20, 22, 23, 24)
- [ ] test-alpine jobs pass for both architectures (x64, arm64)
- [ ] No SIGSEGV/SIGABRT crashes in 5+ consecutive runs
- [ ] Move TPP to `doc/done/`
