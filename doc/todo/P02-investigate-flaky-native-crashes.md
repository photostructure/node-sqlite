# TPP: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes

## Current Status: ROOT CAUSE IDENTIFIED - REVERT REQUIRED

**The "fixes" since commit `a151cb6` have made things WORSE.** The root cause is adding `Napi::ObjectReference database_ref_` to Session class. This causes N-API reference manipulation during GC finalization, which corrupts V8 on Alpine/musl.

**CI was stable at commit `50354e1` (Dec 17, 2025 through Jan 12, 2026).** The crashes started after Session "fix" commits began on Jan 26, 2026.

---

## Critical Research Findings

### 1. Node.js Upstream Uses WEAK References for Session

From `src/upstream/node_sqlite.h`:
```cpp
class Session : public BaseObject {
  Session(Environment* env,
          v8::Local<v8::Object> object,
          BaseObjectWeakPtr<DatabaseSync> database,  // WEAK pointer!
          sqlite3_session* session);
```

Node.js uses `BaseObjectWeakPtr` (weak reference), NOT a strong reference. This means:
- Session does NOT keep database alive
- Session checks if database is still valid before operations
- If database is GC'd, Session operations fail gracefully

### 2. better-sqlite3 Uses Raw Pointers

From `/home/mrm/src/better-sqlite3/src/objects/statement.cpp`:
```cpp
Statement::Statement(Database* db, ...) : db(db) { ... }  // Raw pointer
Statement::~Statement() {
  if (alive) db->RemoveStatement(this);  // Just uses raw pointer
  CloseHandles();
}
```

better-sqlite3 relies on JavaScript to maintain references (Statement JS object has `.database` property). The C++ side uses raw pointers.

### 3. N-API Reference Manipulation During GC Causes Crashes

From GitHub issues:
- [nodejs/node-addon-api#660](https://github.com/nodejs/node-addon-api/issues/660): ObjectWrap destructor crashes due to double napi delete calls
- [nodejs/node#37236](https://github.com/nodejs/node/issues/37236): Crash on node-api add-on finalization - double-free of RefBase
- [nodejs/node#27085](https://github.com/nodejs/node/pull/27085): GC finalization stress issues

**Key insight**: Calling `Napi::ObjectReference::Reset()` during GC finalization (destructor path) is NOT safe on Alpine/musl. Even the ObjectReference destructor calling `napi_delete_reference` can cause issues.

### 4. The Stable Version Had No `database_ref_`

At commit `50354e1` (stable), Session class was simple:
```cpp
class Session : public Napi::ObjectWrap<Session> {
  sqlite3_session *session_ = nullptr;
  DatabaseSync *database_ = nullptr;  // Just a raw pointer, NO ObjectReference
};
```

---

## Timeline of Changes

| Date | Commit | Description | CI Status |
|------|--------|-------------|-----------|
| Dec 17 | `50354e1` | Stable release 0.3.0 | ✅ Green |
| Jan 12 | - | Last confirmed green CI | ✅ Green |
| Jan 26 | `a151cb6` | Added `database_ref_` to Session | ❌ Crashes started |
| Jan 26 | `fb283df` | Release database_ref_ in DeleteAllSessions | ❌ Still crashing |
| Jan 27 | `dadbb86` | Release mutex before GC operations | ❌ Still crashing |
| Jan 27 | `3a6aaff` | Prevent double-free in DeleteAllSessions | ❌ Still crashing |
| Jan 27 | `e1a3fcb` | Prevent dangling pointers | ❌ Still crashing |
| Jan 29 | `413c93f` | Hold refs during cleanup | ❌ Still crashing |
| Jan 29 | `611d330` | Skip Reset() in destructor | ❌ Still crashing |

**Every "fix" commit has failed to resolve the issue because they all keep `database_ref_`.**

---

## Recommended Fix: Revert to Simple Design

### Option 1: Full Revert (Recommended)

Revert Session-related changes back to `b5835fa` (before `a151cb6`):

```bash
git checkout b5835fa -- src/sqlite_impl.cpp src/sqlite_impl.h
```

The simple design:
- Session uses raw `DatabaseSync*` pointer (no ObjectReference)
- `DeleteAllSessions()` just cleans up SQLite sessions
- Session::Delete() removes from database's session list
- No N-API reference manipulation in destructors

### Option 2: Match Node.js Upstream Pattern

If we want Session to survive database GC, implement weak reference pattern:
1. Don't hold strong reference to database
2. Check if database is still valid before operations
3. Return error if database was closed/GC'd

### Why Raw Pointers Are OK

The stable version used raw pointers and worked because:
1. `db.close()` calls `DeleteAllSessions()` which cleans up SQLite sessions
2. Session operations check `database_->IsOpen()` before proceeding
3. If user GC's database without calling close() while holding sessions, that's undefined behavior (same as better-sqlite3)

---

## Files Changed by Session "Fixes"

All these changes should be reverted:

**src/sqlite_impl.h:**
- Added `Napi::ObjectReference database_ref_;` to Session class
- Added `bool in_destructor_ = false;` flag

**src/sqlite_impl.cpp:**
- `Session::SetSession()`: Added `database_ref_ = Napi::Persistent(database->Value());`
- `Session::Delete()`: Added `database_ref_.Reset()` calls with complex conditional logic
- `Session::~Session()`: Added `in_destructor_` flag and `SuppressDestruct()` attempts
- `DeleteAllSessions()`: Changed from simple loop to complex two-pass with session_refs vector

---

## Current Working Directory State

The code has been reverted to `b5835fa` state:
```bash
git checkout b5835fa -- src/sqlite_impl.cpp src/sqlite_impl.h
```

**Pending:**
1. Rebuild: `npm run build:native:rebuild`
2. Test locally: `npm test`
3. Test in Alpine Docker
4. Commit and push

---

## Reproduction Commands

```bash
# Reproduces crash (with current broken code)
docker run --rm -v "$(pwd)":/host:ro node:24-alpine sh -c '
  cp -r /host /work && cd /work &&
  apk add --no-cache build-base python3 py3-setuptools &&
  npm ci --ignore-scripts && npx node-gyp rebuild &&
  npm run build:dist &&
  node --expose-gc node_modules/jest/bin/jest.js --no-coverage
'

# Should pass after revert
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

## References

- [nodejs/node-addon-api#660](https://github.com/nodejs/node-addon-api/issues/660) - ObjectWrap destructor crashes
- [nodejs/node#37236](https://github.com/nodejs/node/issues/37236) - Crash on node-api add-on finalization
- [nodejs/node#27085](https://github.com/nodejs/node/pull/27085) - GC finalization stress
- [lovell/sharp#2570](https://github.com/lovell/sharp/issues/2570) - Segfault on Alpine/musl
- Node.js upstream: `src/upstream/node_sqlite.h` - Uses `BaseObjectWeakPtr` for Session
- better-sqlite3: Uses raw pointers, JavaScript manages lifetime

---

## Completion Checklist

- [x] Root cause identified: `database_ref_` ObjectReference added in `a151cb6`
- [x] Research completed: Node.js upstream and better-sqlite3 patterns documented
- [x] Code reverted to simple design (b5835fa state)
- [x] Rebuild and test locally (793 tests passed)
- [x] Test in Alpine Docker (5 consecutive runs - all passed)
- [x] Commit revert with clear explanation (4da0638)
- [x] Push and validate CI (5 workflows started - monitoring)
- [ ] Move TPP to `doc/done/`
