# P02: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI on Alpine/musl across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes on Alpine

## Current Status: 🔴 UNRESOLVED (Feb 2, 2026)

**Root Cause Identified**: Memory corruption occurs on Alpine/musl during N-API operations. This manifests as:
1. SIGSEGV/SIGABRT during process exit
2. String corruption during normal test execution (e.g., `'Updated${i}'` becomes `'UpdatedheH��'`)

**Workaround Attempted**: `--runInBand` reduces but does NOT eliminate crashes.

**CI Run Evidence**: https://github.com/photostructure/node-sqlite/actions/runs/21609574822
- 5 Alpine jobs failed even WITH `--runInBand`
- Failures include both SIGSEGV at exit AND memory corruption during tests

---

## Investigation Summary (Feb 2, 2026)

### Key Findings

1. **Memory corruption is happening during normal operation, not just at exit**
   - Test failure shows corrupted string: `unrecognized token: "'UpdatedheH��"`
   - This is NOT a cleanup race condition - it's active memory corruption

2. **The same test passes on glibc (Ubuntu), fails on musl (Alpine)**
   - Test: "should not leak memory when callbacks throw repeatedly"
   - Ubuntu Node 20: PASS
   - Alpine Node 20: FAIL with corrupted memory

3. **`--runInBand` does NOT fix all crashes**
   - Prevents parallel worker termination races
   - Does NOT prevent single-process memory corruption
   - Does NOT prevent SIGSEGV during process exit

4. **Prior analysis was incorrect**
   - Previous claim: "0% crash rate WITH fix" was false
   - Previous claim: "nodejs/node-addon-api#660 was fixed" - that fix was for a different issue
   - The `--runInBand` workaround was never committed for weeks

### Crash Patterns Observed

| Scenario | glibc (Ubuntu) | musl (Alpine) |
|----------|----------------|---------------|
| Single test file | PASS | Usually PASS |
| Full suite parallel | PASS | ~50% crash rate |
| Full suite --runInBand | PASS | ~30% crash rate |
| Process exit cleanup | PASS | SIGSEGV/SIGABRT |

### What better-sqlite3 Does Differently

Analysis of better-sqlite3 shows they avoid N-API references entirely:

1. **Uses `v8::Global<>` instead of `Napi::Reference`**
   - V8's Global has different cleanup semantics
   - Works correctly with environment teardown on musl

2. **Uses `node::AddEnvironmentCleanupHook()`**
   - Explicit cleanup before environment teardown
   - Avoids automatic destructor issues

3. **SQLite callbacks use `xDestroy`**
   - Called by SQLite, not by GC
   - Deterministic cleanup order

---

## Technical Analysis

### N-API References in Our Code

| Class | Member | Risk |
|-------|--------|------|
| `UserDefinedFunction` | `fn_` (FunctionReference) | Destructor calls `napi_delete_reference` |
| `CustomAggregate` | `step_fn_`, `inverse_fn_`, `result_fn_`, etc. | Multiple destructors |
| `BackupJob` | `progress_func_` (FunctionReference) | Destructor during async completion |
| `ValueStorage` | `storage_` map of References | Was calling explicit Reset() - FIXED |
| `AddonData` | Constructor references | Lives for addon lifetime |

### The Fundamental Problem

`Napi::FunctionReference` and `Napi::Reference` destructors call `napi_delete_reference()` internally. On musl libc, this appears to corrupt V8's memory/JIT during:
1. Garbage collection
2. Process exit
3. Possibly during high-frequency allocation/deallocation

This is NOT just a cleanup issue - the string corruption proves memory is being corrupted during normal operation.

### Relevant Upstream Issues

- [nodejs/node-addon-api#660](https://github.com/nodejs/node-addon-api/issues/660) - ObjectWrap destructor crashes (fixed 2020, different issue)
- [nodejs/node#37236](https://github.com/nodejs/node/issues/37236) - Crash on node-api add-on finalization (fixed, different issue)
- [nodejs/node-addon-api#591](https://github.com/nodejs/node-addon-api/issues/591) - Fatal error with async code from exit hooks

---

## Fixes Applied (Partial)

### 1. ValueStorage::Remove() - Committed

Removed explicit `Reset()` call:

```cpp
// Before (problematic):
void ValueStorage::Remove(int32_t id) {
  auto it = storage_.find(id);
  if (it != storage_.end()) {
    it->second.Reset();  // Explicit Reset() - DANGEROUS
    storage_.erase(it);
  }
}

// After (fixed):
void ValueStorage::Remove(int32_t id) {
  auto it = storage_.find(id);
  if (it != storage_.end()) {
    // Let destructor handle cleanup
    storage_.erase(it);
  }
}
```

**Impact**: Reduced crash frequency but did NOT eliminate crashes.

### 2. --runInBand for Alpine CI - Committed

Added to `.github/workflows/build.yml`:
```yaml
npm test -- --runInBand
```

**Impact**: Prevents parallel worker termination races but crashes still occur during single-process execution and exit.

---

## Attempted Fixes That Did NOT Work

### 1. SuppressDestruct() on Addon References

Tried calling `SuppressDestruct()` on addon-level `FunctionReference` members:

```cpp
addon_data->databaseSyncConstructor.SuppressDestruct();
```

**Result**: No improvement. Crashes come from per-function/per-aggregate references, not addon-level ones.

### 2. Removing All Explicit Reset() Calls

Previous commit `c86810b` removed Reset() calls from destructors.

**Result**: Crashes continued because `Napi::Reference` destructors IMPLICITLY call `napi_delete_reference`.

---

## Potential Solutions (NOT Implemented)

### Option 1: Switch to v8::Global<> (Recommended, Major Refactor)

Replace all `Napi::FunctionReference` with `v8::Global<v8::Function>`:

```cpp
// Current (problematic):
Napi::FunctionReference fn_;

// Better (like better-sqlite3):
v8::Global<v8::Function> fn_;
```

**Pros**:
- Eliminates N-API reference issues entirely
- Proven to work (better-sqlite3 uses this)

**Cons**:
- Major refactoring effort
- Breaks N-API abstraction
- Need to capture `v8::Isolate*` in constructors

### Option 2: Mark Alpine Tests as Allowed-to-Fail

```yaml
test-alpine:
  continue-on-error: true
```

**Pros**: Unblocks CI immediately

**Cons**: Loses Alpine test coverage, may ship broken Alpine builds

### Option 3: Skip Problematic Tests on Alpine

```typescript
const describeOrSkip = process.platform === 'linux' && isMusl() ? describe.skip : describe;
```

**Pros**: Other tests still run

**Cons**: Reduced coverage, doesn't fix root cause

### Option 4: Explicit Teardown Before Exit

Register cleanup via `process.on('beforeExit')` or `napi_add_env_cleanup_hook`:

```cpp
napi_add_env_cleanup_hook(env, CleanupAllReferences, data);
```

**Pros**: May allow safe cleanup ordering

**Cons**: Requires significant restructuring, may not fix all cases

---

## Reproduction Steps

### Reproduce on Alpine (crashes ~50% of time):

```bash
docker run --rm -v $(pwd):/tmp/project --platform linux/amd64 node:20-alpine sh -c "
  cd /tmp/project &&
  apk add build-base git python3 py3-setuptools &&
  rm -f build/Release/*.node &&
  npx node-gyp rebuild &&
  npm run build:dist &&
  npm test -- --maxWorkers=4
"
```

### Verify same test passes on Ubuntu:

```bash
docker run --rm -v $(pwd):/tmp/project --platform linux/amd64 node:20-bullseye sh -c "
  cd /tmp/project &&
  apt-get update && apt-get install -y build-essential python3 &&
  rm -f build/Release/*.node &&
  npx node-gyp rebuild &&
  npm run build:dist &&
  npm test -- --maxWorkers=4
"
```

---

## Handoff Notes for Next Engineer

### What's Been Done

1. ✅ Identified that crashes are musl-specific (glibc works fine)
2. ✅ Identified that it's memory corruption, not just cleanup races
3. ✅ Removed explicit Reset() call in ValueStorage::Remove()
4. ✅ Added --runInBand workaround (partial fix)
5. ✅ Analyzed better-sqlite3 approach (uses v8::Global<>)
6. ✅ Tested SuppressDestruct() (didn't help)

### What Needs To Be Done

1. ❌ Implement proper fix (likely Option 1: switch to v8::Global<>)
2. ❌ OR accept Alpine as unsupported/best-effort
3. ❌ Update documentation if Alpine support is dropped

### Key Files

- `src/user_function.cpp` - UserDefinedFunction with FunctionReference
- `src/aggregate_function.cpp` - CustomAggregate with multiple References
- `src/sqlite_impl.cpp` - BackupJob with FunctionReference
- `src/binding.cpp` - AddonData cleanup
- `.github/workflows/build.yml` - CI configuration

### Questions to Research

1. Why does musl trigger this but glibc doesn't?
2. Is there a way to detect musl at runtime and avoid the problematic code paths?
3. Could we use a hybrid approach (N-API on glibc, v8::Global on musl)?

---

## References

- [nodejs/node-addon-api#660](https://github.com/nodejs/node-addon-api/issues/660) - ObjectWrap destructor crashes
- [nodejs/node#37236](https://github.com/nodejs/node/issues/37236) - Crash on node-api add-on finalization
- [nodejs/node-addon-api#591](https://github.com/nodejs/node-addon-api/issues/591) - Fatal error with N-API async from exit hooks
- [better-sqlite3 source](https://github.com/WiseLibs/better-sqlite3) - Uses v8::Global<> instead of N-API references
