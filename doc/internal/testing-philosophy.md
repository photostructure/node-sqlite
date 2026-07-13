# Testing philosophy

This document outlines the testing approach for @photostructure/sqlite.

## Core principle: exact node:sqlite compatibility

Our goal is to be a **drop-in replacement** for Node.js's built-in `node:sqlite` module. This means:

- **Exact same error messages** - Users switching from node:sqlite should see identical errors
- **Exact same error codes** - ERR_INVALID_ARG_TYPE, ERR_SQLITE_ERROR, etc.
- **Exact same behavior** - Pass the Node.js SQLite test suite

### Why exact compatibility matters

1. **Drop-in replacement**: Users should be able to swap imports without any code changes
2. **Test suite compatibility**: We sync and run Node.js's own SQLite tests
3. **Error handling code**: User code that catches and parses errors must work identically
4. **Documentation accuracy**: Node.js docs should apply to our package

## Node.js test suite synchronization

We sync test files from the Node.js repository and adapt them to use our package:

```bash
npm run sync:tests     # Sync from Node.js repo
node --test test/node-compat/   # Run adapted tests
```

These tests verify exact compatibility with node:sqlite behavior, including error messages.

## Error message requirements

When implementing error handling, always match Node.js's exact error messages:

```cpp
// CORRECT - matches Node.js exactly
Napi::TypeError::New(env,
    "The \"name\" argument must be a string.").ThrowAsJavaScriptException();

// WRONG - different message
Napi::TypeError::New(env,
    "Expected name to be a string").ThrowAsJavaScriptException();
```

Reference the upstream Node.js source (`src/upstream/node_sqlite.cc`) to find exact error messages.

## SQLite error properties

SQLite errors must include all standard properties:

```javascript
{
  code: 'ERR_SQLITE_ERROR',
  errcode: 19,
  errstr: 'constraint failed',
  sqliteCode: 19,
  sqliteExtendedCode: 2067,
  sqliteCodeName: 'SQLITE_CONSTRAINT_UNIQUE',
  sqliteErrorString: 'UNIQUE constraint failed: users.email'
}
```

## Platform considerations

### CI environment differences

- GitHub Actions runners vary significantly in performance
- Alpine Linux ARM64 emulation is 5-20x slower
- Windows process operations are 4x slower
- Use adaptive timeouts from `test-timeout-config.cjs`

### Test isolation

The node-compat tests share a temp directory and must run with `--test-concurrency=1` to avoid database locking conflicts.

## Test organization

- `test/*.test.ts` - Jest-based unit and integration tests
- `test/node-compat/*.test.js` - Adapted Node.js test suite (node:test runner)
- `test/upstream/` - Original unmodified Node.js tests (reference only)
- `test/common/` - Shared test utilities

## Memory, UB, and race detection

`npm run memory:check` (run in CI by `.github/workflows/memory-tests.yml`) layers
three detectors on Linux:

| Tool                       | Script                       | Finds                                                     |
| -------------------------- | ---------------------------- | --------------------------------------------------------- |
| AddressSanitizer + LeakSan | `scripts/sanitizers-test.sh` | Heap/stack overflow, use-after-free, double free, leaks   |
| UndefinedBehaviorSanitizer | `scripts/sanitizers-test.sh` | Signed overflow, bad casts/shifts, null passed as nonnull |
| Valgrind Memcheck          | `scripts/valgrind-test.sh`   | Uninitialized reads, leaks (a different, overlapping set) |

**How this gates a release.** Memory Tests is a _separate workflow_, and GitHub
Actions `needs:` only works within a single workflow, so `publish` in `build.yml`
does not depend on it mechanically. This is intentional: the release gate is
**procedural** — we do not cut a release while any workflow is red for that
commit. Releases are `workflow_dispatch`-triggered by a human who checks CI
first, so a machine-enforced dependency would buy little and couple the release
path to a slow (ASan + Valgrind) job. Don't "fix" this by wiring
`workflow_call` into `publish` without discussing it.

Two rules keep these honest:

1. **Never wildcard first-party frames in a suppression file.** `.lsan-suppressions.txt`
   and `.valgrind.supp` deliberately do **not** suppress `napi_*` / `Napi::*` /
   `node_modules/`. Essentially every allocation this addon makes passes through
   an N-API frame, so those patterns would silence exactly the reference and
   handle leaks the job exists to catch. Audit which rules actually fire with
   `VERBOSE=1 npm run memory:asan` (`print_suppressions=1`).
2. **`_FORTIFY_SOURCE` is off under ASan.** Its libc interceptors collide with
   ASan's. The release build sets `-D_FORTIFY_SOURCE=2` in `binding.gyp`; the
   sanitizer script undefines it.

UBSan is worth its keep: it is what caught the empty-changeset
`memcpy(NULL, NULL, 0)` in `Session::Changeset` — undefined behavior that every
functional test passed straight through, because a zero-length copy "works" right
up until the optimizer uses the `nonnull` promise to delete a null check.

### Race detection: why there is no ThreadSanitizer job

`BackupJob` (a `Napi::AsyncProgressWorker`) runs `sqlite3_backup_step` on a libuv
worker thread while the main thread can set `shutting_down_`, so a race detector
is genuinely applicable. We nonetheless do **not** ship a TSan job, and this is a
considered tradeoff rather than an oversight:

- TSan requires the **whole process** to be instrumented. Node is not. Preloading
  `libclang_rt.tsan` into stock `node` does load, but TSan then cannot see the
  synchronization performed inside uninstrumented Node/V8/libuv and immediately
  reports races in Node's own allocator. Both false positives (our correctly
  libuv-synchronized handoffs look unsynchronized) and false negatives follow.
- Suppressing all of Node to quiet it would suppress essentially everything —
  a green job that proves nothing, which is worse than no job.
- Doing this properly means building Node itself with TSan and running the suite
  against that. That is the correct fix if race coverage becomes critical.

What we rely on instead: shared state is `std::atomic` or mutex-guarded (see
`doc/internal/threading.md`), ASan catches the use-after-free that a lost race
usually manifests as, and `test/concurrent-access.test.ts`,
`test/worker-threads-*.test.ts` and `test/backup.test.ts` exercise the
concurrent paths.

## Contributing

When implementing or fixing features:

1. Check Node.js's implementation in `src/upstream/node_sqlite.cc`
2. Match error messages and behavior exactly
3. Run `node --test --test-concurrency=1 test/node-compat/` to verify compatibility
4. Add Jest tests for additional coverage as needed
