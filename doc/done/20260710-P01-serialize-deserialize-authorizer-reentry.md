# TPP: Enforce authorizer reentry contract during serialize/deserialize

**Status: COMPLETE (archived).** Implemented, double-reviewed, and validated on
2026-07-10.

The intern's original “code complete” conclusion was rejected after an independent
audit of Node-API, Node, SQLite, repository history, and runtime behavior. The
replacement implementation completed the validation and review checklist below.

## Goal definition

- **Bug**: An authorizer invoked by `serialize()` or `deserialize()` can re-enter
  the invoking `DatabaseSync`, including `close()`, while SQLite still has native
  frames on the stack. This can close/finalize live SQLite state (UAF/SIGSEGV).
  The wrapper also silently loses some thrown authorizer values.
- **Root cause**: The old fix tracked the surrounding prepare/step call, not the
  authorizer callback itself. That only protected operations already checking
  `IsExecutingStatement()` and did not enforce SQLite's stricter authorizer rule.
- **Solution**: Track authorizer callback depth per connection with an RAII guard,
  reject same-connection SQLite operations while the callback is active, and
  preserve/rethrow the exact JavaScript value after the outer SQLite call returns.
- **Success validation**: The focused tests in `authorizer.test.ts` and
  `close-from-user-function.test.ts` pass; the full CJS/ESM and Node compatibility
  suites remain green.
- **Key constraint**: Keep the existing UDF/aggregate and per-statement guards.
  UDF callbacks may step a different statement on the same connection; authorizer
  callbacks may not. The two policies must not be conflated.

## TDD evidence

The revised regression tests were run against the intern patch before replacing
the implementation:

```bash
npx jest close-from-user-function authorizer --runInBand --no-coverage
```

Expected red result: 5 failures, 41 passes. The failures proved that:

1. nested prepare/exec/step/serialize/setAuthorizer still succeeded;
2. serialize/deserialize recreated a generic `Error` instead of preserving the
   thrown `TypeError` object; and
3. empty-database authorizer failures on internal `BEGIN` and `COMMIT` were
   silently ignored.

After the replacement implementation, the same command is green: 47 passes.

The first post-implementation review found three additional deferred-error
paths. Regression tests were added before fixing them; the focused result was
7 expected failures and 47 passes:

1. repeated primitive throws during empty-database serialization became
   `Error: Invalid argument`;
2. `all()`, iterator `next()`/`toArray()`, session `changeset()`/`patchset()`,
   and `applyChangeset()` replaced the thrown value with a generic SQLite
   error; and
3. the missed statement handoff left deferred state that poisoned a later,
   unrelated constraint error.

After those fixes and two further compatibility corrections from the final
double-review gate, the affected CJS and ESM suites are green: 110 passes each.

## Audit corrections to the original plan

### These APIs are upstream Node APIs

The original plan called serialize/deserialize project-only extensions. That is
false. Node added both in commit
[`4a41a002`](https://github.com/nodejs/node/commit/4a41a002f6b357d8400d7679ed53bd78aa21bbfe),
and this repository ported them in `776489546685fcd9e0b2405d48fa17234ca4efcb`.
The synced source is `src/upstream/node_sqlite.cc`; the local Node checkout has
the current implementation in `../node/src/node_sqlite.cc`.

### SQLite's contract is connection-wide

`src/upstream/sqlite3.h` states that an authorizer must not modify the invoking
connection and explicitly counts `sqlite3_prepare_v2()` and `sqlite3_step()` as
modification. Node issue
[#63207](https://github.com/nodejs/node/issues/63207) documents the same gap.

The authorizer therefore needs its own per-connection callback-depth counter. A
generic “SQLite call in progress” counter is too narrow for authorizers and would
be too broad for UDF callbacks.

### Ordinary in-memory serialization also runs internal SQL

The old plan said only file-backed serialization runs `PRAGMA page_count`.
SQLite 3.53.3 shows otherwise at `src/upstream/sqlite3.c:56056-56138`:

- ordinary `:memory:`, TEMP, attached-memory, and file databases use the PRAGMA
  path;
- only a database already installed through `sqlite3_deserialize()` normally
  uses the direct memdb-copy path; and
- `sqlite3_deserialize()` prepares an internal `ATTACH` at approximately
  `src/upstream/sqlite3.c:56177`.

### `sqlite3_serialize()` can return data after an authorizer throws

For a zero-page database, SQLite runs an internal
`BEGIN IMMEDIATE; COMMIT;`, ignores that exec's result, and checks page count
again (`src/upstream/sqlite3.c:56107-56114`). Empirical outcomes:

- denied/thrown `BEGIN`: null data with size 0;
- denied/thrown second PRAGMA: null data with size 0; and
- denied/thrown `COMMIT`: a non-null 4096-byte image and an open transaction.

Therefore deferred callback state must be checked immediately after
`sqlite3_serialize()`, before _all_ data/size branches. A returned allocation is
freed before rethrowing.

The wrapper intentionally does not silently roll back a transaction left by a
denied internal COMMIT. That would require temporarily bypassing the user's
authorizer and would add behavior not provided by SQLite or current Node. The
regression test cleans up the transaction explicitly after verifying propagation.

### Node-API preserves the original thrown value

This addon builds with C++ exceptions (`NAPI_CPP_EXCEPTIONS` and
`node_addon_api_except`). Official node-addon-api documentation says a JavaScript
throw from `Napi::Function::Call()` becomes a C++ `Napi::Error`; `Napi::Error` is
a persistent reference to the original thrown value, including its wrapper for
thrown primitives:

- https://github.com/nodejs/node-addon-api/blob/main/doc/error_handling.md
- https://nodejs.org/api/n-api.html#exceptions

Storing only `Error::Message()` discarded identity, subclass, `code`, stack,
custom properties, and primitive values. The deferred state now stores
`Napi::Error` and rethrows its exact value after SQLite unwinds.

## Implemented design

### 1. Dedicated authorizer scope

`DatabaseSync::AuthorizerGuard` increments/decrements a per-connection depth
counter around `DatabaseSync::AuthorizerCallback`. Tracking the callback itself
enforces the contract regardless of which SQLite entry point invoked it. The
counter keeps nested RAII scopes balanced; schema auto-reprepare can invoke the
authorizer repeatedly, but does not itself make those invocations recursive.

`ThrowIfInAuthorizerCallback()` produces `ERR_INVALID_STATE` before a prohibited
operation touches the connection. Operations on a different `DatabaseSync`
remain allowed.

### 2. Guarded entry points

The guard covers the native connection APIs represented in this implementation:

- database close/dispose, prepare/exec, serialize/deserialize;
- transaction/location/limit reads and configuration mutations;
- function/aggregate registration, extensions, defensive mode;
- sessions, changesets, backup, and authorizer replacement;
- statement execution and relevant SQLite-backed metadata; and
- iterator step/reset and session changeset/close operations.

The TypeScript SQL tag store delegates execution to guarded database/statement
methods. Its `clear()` only drops JavaScript `Map` references in this project and
does not synchronously call SQLite, unlike Node's native SQL tag store.

### 3. Exact deferred error handoff

`deferred_authorizer_exception_` holds `Napi::Error` rather than `std::string`.
All existing prepare/exec error paths now rethrow the original value as well as
the new serialize/deserialize paths. The environment cleanup hook clears any
unexpected residual reference while the environment is still valid.

Replacement uses `std::optional::emplace()`, not `Napi::Error` copy assignment.
node-addon-api's assignment operator unwraps a primitive before trying to create
a Node-API reference, which fails. Copy construction retains the wrapper safely
and preserves Node's observable last-authorizer-exception-wins behavior.

### 4. Serialize/deserialize post-call checks

Both wrappers check deferred state immediately after the SQLite C call.
Serialize frees a returned SQLite allocation before rethrowing. The old manual
`EnterStatementStep()` wrappers were removed: authorizer scope is the correct
abstraction, while existing statement-depth guards remain unchanged for UDFs.

### 5. Every reviewed outer SQLite call consumes deferred state

Statement `all()` and iterator `next()`/`toArray()` now route step errors through
the same database-aware handoff used by `run()`/`get()`. Session
`changeset()`/`patchset()` and database `applyChangeset()` establish a fresh
deferred scope and check it immediately after SQLite returns. Changeset output
allocated before a denied internal `RELEASE` is freed before rethrowing.

For `applyChangeset()`, SQLite cleanup SQL runs after filter/conflict callbacks.
A later authorizer throw takes precedence over an earlier callback throw,
matching Node v26.5. Invalid integer authorization codes use `RangeError` while
non-integer results use `TypeError`, also matching Node.

Extension initialization is another outer SQLite call: an extension entry point
may execute SQL and then ignore its return code. `loadExtension()` now starts a
fresh deferred-error scope and consumes it even if the extension reports success.
The fixture pins exact exception identity and verifies that no stale error poisons
the next operation.

## Rejected approaches

- **Keep the intern's two statement-depth wrappers**: fixes the demonstrated
  close/deserialize crash but still permits prepare, exec, step, serialize, and
  authorizer replacement from the callback.
- **Check deferred state only when serialize returns null**: wrong because the
  ignored internal COMMIT error can coexist with a valid returned image.
- **Store only the message**: loses observable JavaScript error semantics and
  diverges from Node's pending-exception behavior.
- **Cherry-pick old branch commits**: `backup/local-main-may` contains the same
  architectural direction in `5a0948e` and `2677a0f`, but it diverged before the
  current UDF/statement design. Its ideas and tests were reviewed; its hunks
  should not be mechanically applied.
- **Treat `../node` as landed upstream**: its branch
  `sqlite-63207-authorizer-reentrancy` contains an uncommitted prototype, useful
  as design evidence but not an upstream release guarantee.

## Validation

Completed this session:

- [x] Rebuilt native addon: `npm run build:native:rebuild`
- [x] Proved revised tests fail against intern patch (5 expected failures)
- [x] Focused tests pass: 47/47
- [x] Exact thrown `TypeError` identity is preserved
- [x] A thrown primitive is preserved
- [x] Empty-db BEGIN and COMMIT failures are surfaced
- [x] Same-connection prepare/exec/step/serialize/setAuthorizer are rejected
- [x] Cross-connection statement execution remains allowed
- [x] `npm run lint`
- [x] Native rebuild after final fixes: `npm run build:native:rebuild`
- [x] Affected CJS suites: 6 suites, 110 tests
- [x] Affected ESM suites: 6 suites, 110 tests
- [x] Existing session/callback suite coverage remains green
- [x] Node compatibility suite: 19/19 files
- [x] API type tests: 9/9
- [x] `clang-format --dry-run --Werror` on the native files
- [x] `clang-tidy`: all four native translation units clean
- [x] Review all `ThrowIfInAuthorizerCallback` placements against the public API
- [x] Double-review the scoped diff and empirically vet every finding
- [x] Full CJS suite after final fixes: 58 suites, 903 passed, 22 skipped
- [x] Focused ESM suites after final fixes: 5 suites, 102 passed
- [x] Final Node compatibility suite: 19/19 files
- [x] Final lint and benchmark TypeScript checks

Validation note: the final CJS run included and passed the multi-process suites.
The repository's `npm run all` is an interactive maintenance/update command
(dependency updates, upstream sync, whole-tree formatting), not a read-only test
aggregate, so it was intentionally not used as a validation shortcut.

## Double-review verdicts

- **Accepted and fixed**: repeated assignment of primitive-backed `Napi::Error`
  fails. Ground truth reproduced `Invalid argument`; `emplace()` now returns the
  same final primitive as Node.
- **Accepted and fixed**: statement and session outer calls missed deferred
  handoff. Ground truth reproduced generic errors and stale-state poisoning;
  every reviewed path now has identity and follow-on regression coverage.
- **Accepted and fixed**: `applyChangeset()` discarded a later cleanup
  authorizer exception. Node v26.5 returned the later exact `TypeError`; the
  wrapper now does the same.
- **Accepted and fixed**: invalid numeric authorization results used
  `TypeError`. Node v26.5 and `../node` use `RangeError`; the test now pins the
  observable subclass.
- **Accepted and fixed**: numeric callback values were coerced through
  `Int32Value()`, silently turning NaN, fractions, wrapping values, and negative
  zero into `SQLITE_OK`. Validation now matches V8 `IsInt32()` behavior.
- **Accepted and fixed**: `loadExtension()` did not consume an authorizer
  exception when extension initialization executed SQL but returned success.
  The exact thrown value is now handed off and stale state is cleared.
- **Vetoed**: first-authorizer-error-wins was proposed as a workaround for
  primitive assignment. Node v26.5 demonstrably uses last-error-wins, so safe
  reconstruction with `emplace()` was used instead.
- **No issue found**: the independent external Codex review reported no further
  verified bugs after inspecting the same scoped diff.

## Landing scope

Stage only the authorizer/native hunks in `src/sqlite_impl.{h,cpp}` plus
`test/authorizer.test.ts`, `test/close-from-user-function.test.ts`,
`test/extension-loading.test.ts`, the test-extension fixture, and this TPP.

## Landmine for future work

Do not generalize UDF and authorizer reentry into one policy. UDF/aggregate
callbacks may use a different statement on the same connection; authorizer
callbacks may not prepare or step anything on the invoking connection. Preserve
that distinction when adding new native entry points.
