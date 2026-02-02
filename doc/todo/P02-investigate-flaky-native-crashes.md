# P02: Investigate Flaky Native Crashes in CI

## Goal Definition

- **What Success Looks Like**: CI passes reliably without random SIGSEGV/SIGTRAP crashes
- **Core Problem**: Native code crashes randomly in CI across different tests, Node versions, and architectures
- **Key Constraints**: Must identify root cause (memory corruption, race condition, or CI environment issue)
- **Success Validation**: 10 consecutive CI runs without native crashes

## Current Status: 🔧 WORKAROUND APPLIED (Feb 1, 2026)

**Root Cause**: N-API `Napi::Reference` destructors call `napi_delete_reference` during Jest worker process termination on Alpine/musl, which corrupts V8's JIT page allocations.

**Workaround Applied**: Added `--runInBand` to Alpine CI tests to prevent parallel worker termination.

**Why Full Fix Is Complex**: The fundamental issue is that `Napi::Reference` (including `FunctionReference`, `ObjectReference`) has an automatic destructor that calls `napi_delete_reference`. This happens even without explicit `Reset()` calls. Switching to `v8::Global<>` (like better-sqlite3 does) would require significant refactoring.

---

## Investigation Summary (Feb 1, 2026)

### Critical Discovery

Previous analysis claimed the fix was "committed" but **the `--runInBand` workaround was never actually committed to the workflow**. The local working directory had the change, but CI was running without it.

### Root Cause Analysis

1. **What Happens**: When a Jest worker process terminates, V8 runs garbage collection and finalizers
2. **The Problem**: `Napi::Reference` destructors call `napi_delete_reference` during this finalization
3. **Why musl Is Different**: musl libc handles thread-local storage cleanup differently than glibc, exposing a race condition in V8's JIT page allocations
4. **Reference**: nodejs/node-addon-api#660

### Reproduction Results (Local Testing)

| Configuration | Result |
|---------------|--------|
| Alpine Node 20 + parallel (maxWorkers=4) | ~80% crash rate |
| Alpine Node 20 + `--runInBand` | **0% crash rate** |
| Ubuntu/macOS + parallel | 0% crash rate |

### What better-sqlite3 Does Differently

Analysis of better-sqlite3 shows they use `v8::Global<>` instead of N-API's `Napi::Reference`. V8's `Global<>` has different cleanup semantics that work better with environment teardown:

1. Uses `v8::Global<>` for persistent references (not N-API refs)
2. Registers cleanup via `node::AddEnvironmentCleanupHook()`
3. Doesn't call `.Reset()` in destructors - lets destructor run naturally
4. SQLite function callbacks use `xDestroy` for cleanup (called by SQLite, not GC)

### Places Where N-API References Are Destroyed

| Class | Member | Destructor Behavior |
|-------|--------|-------------------|
| `UserDefinedFunction` | `fn_` | Automatic destructor calls `napi_delete_reference` |
| `CustomAggregate` | `step_fn_`, `inverse_fn_`, `result_fn_`, etc. | Automatic destructor calls `napi_delete_reference` |
| `BackupJob` | `progress_func_` | Automatic destructor calls `napi_delete_reference` |
| `ValueStorage` | `storage_` map | Was calling explicit `Reset()` - **fixed** |
| `AddonData` | `objectCreateFn`, constructors | Lives for addon lifetime |

---

## Fixes Applied

### 1. ValueStorage::Remove() Fix

Removed explicit `Reset()` call in `ValueStorage::Remove()` that was being called during aggregate cleanup:

```cpp
// Before (problematic):
void ValueStorage::Remove(int32_t id) {
  auto it = storage_.find(id);
  if (it != storage_.end()) {
    it->second.Reset();  // Explicit Reset() during cleanup - DANGEROUS
    storage_.erase(it);
  }
}

// After (fixed):
void ValueStorage::Remove(int32_t id) {
  auto it = storage_.find(id);
  if (it != storage_.end()) {
    // Let destructor handle cleanup naturally
    storage_.erase(it);
  }
}
```

### 2. CI Workflow Workaround

Added `--runInBand` to Alpine test job in `.github/workflows/build.yml`:

```yaml
npm test -- --runInBand
```

This prevents parallel Jest workers from terminating simultaneously, eliminating the race condition that triggers the crash.

---

## Why `--runInBand` Is Necessary

Even after removing all explicit `Reset()` calls, crashes still occur because:

1. `Napi::FunctionReference` destructor implicitly calls `napi_delete_reference`
2. When Jest worker processes terminate, multiple destructors run in parallel
3. On musl libc, this triggers a race condition in V8's JIT page allocations
4. The only safe workaround without major refactoring is to prevent parallel worker termination

---

## Alternative Solutions (Not Implemented)

### Option 1: Switch to v8::Global<> (Major Refactor)

Like better-sqlite3, use `v8::Global<>` instead of N-API references. This would require:
- Replacing all `Napi::FunctionReference` with `v8::Global<v8::Function>`
- Changing constructor patterns to capture `v8::Isolate*`
- Updating all callback registration code

**Pros**: Eliminates the issue entirely
**Cons**: Major refactoring, breaks N-API abstraction

### Option 2: Use Raw napi_ref with Manual Lifecycle

Replace `Napi::Reference` with raw `napi_ref` and manually check environment validity before calling `napi_delete_reference`:

```cpp
~MyClass() {
  napi_status status = napi_delete_reference(env_, ref_);
  // Ignore status - environment may already be torn down
}
```

**Pros**: Less invasive than v8::Global
**Cons**: More error-prone, requires manual memory management

### Option 3: Use SuppressDestruct() Selectively

Call `ref.SuppressDestruct()` on references that might outlive the environment:

**Pros**: Simple change
**Cons**: May leak memory in normal operation, only appropriate for addon-lifetime objects

---

## Validation

With both fixes applied:

1. ✅ `npm test -- --runInBand` passes 100% on Alpine Node 20
2. ✅ CI should pass with `--runInBand` in workflow
3. ✅ Other platforms (Ubuntu, macOS, Windows) unaffected

---

## Completion Checklist

- [x] Identified root cause: N-API reference cleanup during worker termination
- [x] Reproduced locally on Alpine Node 20
- [x] Removed explicit Reset() call in ValueStorage::Remove()
- [x] Added --runInBand to workflow for Alpine tests
- [x] Verified --runInBand fixes the issue locally
- [x] Analyzed better-sqlite3 approach for reference
- [x] Documented why full fix requires major refactoring
- [ ] Commit and push fixes
- [ ] Validate 10 consecutive CI runs
- [ ] Move document to `doc/done/`

---

## References

- [nodejs/node-addon-api#660](https://github.com/nodejs/node-addon-api/issues/660) - ObjectWrap destructor crashes
- [nodejs/node#37236](https://github.com/nodejs/node/issues/37236) - Crash on node-api add-on finalization
- [lovell/sharp#2570](https://github.com/lovell/sharp/issues/2570) - Segfault on Alpine/musl
- better-sqlite3 source code - uses v8::Global<> instead of N-API references
