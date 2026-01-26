# TPP: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes

## Current Status: FIX IMPLEMENTED ✅

**Root cause found and fixed.** Remaining work is CI validation only.

### Evidence of Original Flakiness

Same commit (`80fa40d`) showed different failures across runs:

| Run ID      | Time     | Failed Alpine Jobs    |
| ----------- | -------- | --------------------- |
| 21346776312 | 4:56:24Z | **None - all passed** |
| 21346793811 | 4:57:29Z | x64/23, arm64/24      |
| 21347456610 | 5:36:26Z | x64/20, arm64/23      |

Crash signals: `SIGSEGV` (segfault), `SIGTRAP` (assertion)
Affected tests: `extension-loading.test.ts`, `session-lifecycle.test.ts`

## Root Cause: BackupJob Use-After-Free

**The bug**: `BackupJob` held a raw pointer to `DatabaseSync*` but nothing prevented the database from closing while backup ran on worker thread.

**How it manifested**:

1. User starts backup (`db.backup(...)`)
2. `BackupJob::Execute()` runs on worker thread
3. Database closes (test cleanup, GC, etc.)
4. Worker thread accesses `source_->connection()` → **SIGSEGV**

**Why flaky**: Only manifests when database closes during active backup. CI's higher resource pressure makes this timing more likely.

**Evidence found**:

- Upstream Node.js tracks backups via `AddBackup()`, `RemoveBackup()`, `FinalizeBackups()`
- Our implementation was **missing all backup tracking**
- See: `src/upstream/node_sqlite.cc:685-791`

## Fix Implemented (2026-01-26)

### Changes Made

**[src/sqlite_impl.h](../../src/sqlite_impl.h)**:

- Added forward declaration for `BackupJob`
- Added `std::set<BackupJob*> backups_` and `std::mutex backups_mutex_`
- Added `AddBackup()`, `RemoveBackup()`, `FinalizeBackups()` declarations
- Added `BackupJob::Cleanup()` (public) and `ClearSource()` methods
- Added `sqlite3* source_connection_` to capture connection at construction

**[src/sqlite_impl.cpp](../../src/sqlite_impl.cpp)**:

- `BackupJob` constructor captures `source_->connection()` and calls `source_->AddBackup(this)`
- `BackupJob` destructor calls `source_->RemoveBackup(this)` if source valid
- `BackupJob::Execute()` uses `source_connection_` (not `source_->connection()`)
- `DatabaseSync::InternalClose()` calls `FinalizeBackups()` before closing

### Key Safety Mechanisms

1. **Connection captured at construction** - while known valid on main thread
2. **Backup registration** - database tracks all active backups
3. **Cleanup on close** - `FinalizeBackups()` runs before database closes
4. **Deadlock prevention** - mutex released before calling `Cleanup()`

## Validation

- [x] Root cause identified and documented
- [x] Fix implemented
- [x] Local tests pass: `npm t` (793 tests)
- [x] Local Alpine x64 Docker test passes (780 tests)
- [x] Linting passes: `npm run lint`
- [ ] **REMAINING: 10 consecutive CI runs pass**

### Verification Commands

```bash
# Native rebuild and test
npm run build:native:rebuild && npm test

# Local Alpine test (faster than CI)
docker run --rm -v "$(pwd)":/host:ro node:20-alpine sh -c '\
  cp -r /host /work && cd /work && \
  apk add build-base python3 py3-setuptools && \
  npm ci --ignore-scripts && npx node-gyp rebuild && \
  npm run build:dist && npm test -- --no-coverage'

# Verify fix exists
grep -n "FinalizeBackups\|AddBackup\|source_connection_" src/sqlite_impl.cpp
```

## Tribal Knowledge

### What Didn't Work / Red Herrings

1. **"musl/glibc incompatibility"** - Previous engineer suspected this, but extension loading works fine on Alpine. The real issue was the race condition.

2. **Trying to reproduce with prebuilds** - Spent time on Task 1 (downloading CI prebuilds), but the bug reproduced even with source builds once we understood the timing.

3. **Looking for weak_ptr issues** - Searched for `weak_ptr` patterns but found none. The codebase uses raw pointers.

### Key Insights

1. **Compare with upstream** - The Node.js source (`src/upstream/node_sqlite.cc`) shows proper patterns. Our implementation was missing backup tracking that upstream has.

2. **Race conditions in AsyncProgressWorker** - The worker thread can outlive the main-thread objects. Any data accessed from `Execute()` must either be:
   - Copied at construction time, OR
   - Protected by tracking/synchronization

3. **Mutex ordering matters** - `FinalizeBackups()` must release the lock before calling `Cleanup()` to avoid deadlock when destructor calls `RemoveBackup()`.

### Files to Study

| File                                  | What to Look For                     |
| ------------------------------------- | ------------------------------------ |
| `src/upstream/node_sqlite.cc:685-791` | Upstream backup tracking pattern     |
| `src/sqlite_impl.cpp:1530-1560`       | Our new backup tracking              |
| `src/sqlite_impl.cpp:3097-3135`       | BackupJob constructor (registration) |
| `src/sqlite_impl.cpp:1001-1005`       | InternalClose calls FinalizeBackups  |

## Remaining Work

### Task: Validate CI Stability

**Success**: 10 consecutive CI runs pass without native crashes

**Implementation**:

1. Push the fix to trigger CI
2. Monitor CI runs for crashes
3. If crashes persist, they're a different bug (open new TPP)

**If crashes continue**:

- Check crash location (different from `source_->connection()`?)
- Look for other raw pointers in async contexts
- Grep: `grep -rn "AsyncProgressWorker\|AsyncWorker" src/*.cpp`

**Completion checklist**:

- [ ] Push changes
- [ ] 10 CI runs complete
- [ ] No SIGSEGV/SIGTRAP crashes
- [ ] Move TPP to `doc/done/`

## Notes

The fix is complete and tested locally. The only remaining step is CI validation to confirm the flaky crashes are resolved in the actual CI environment where they occurred.
