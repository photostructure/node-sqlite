# TPP: Port `createModule()` (JavaScript-backed virtual tables) from node:sqlite

**Status:** planned 2026-10-02; decisions D1–D4 answered the same day (see
"Decisions"). Tasks 0–6 done the same day and uncommitted, pending the
maintainer's choice of commit split and CHANGELOG lines.

## Progress (2026-10-02)

- **Task 0 baseline**: `npm run test:node` 503 tests, 499 pass, 0 fail, 4
  skipped. Jest: 75 suites, 1156 pass, 22 skipped.
- **Task 1**: 45/45 new tests and the 2 un-skipped getter tests failed on
  `createModule is not a function`.
- **Task 1b**: `src/sqlite_value_conversion.{h,cpp}`; Jest and `test:node`
  results unchanged.
- **Tasks 2–3** (one pass): `src/virtual_table.{h,cpp}`,
  `DatabaseSync::CreateModule`, `DatabaseSync::DestructorScope`. All 45 upstream
  tests and 14/14 getter re-entry tests pass; `test:node` 548 tests, 546 pass,
  0 fail, 2 skipped. Disabling the Landmine 8 change makes "a SQLite error
  outranks a throwing cleanup" fail with `Error: cleanup boom`, as predicted.
- **Task 4**: `test/create-module.test.ts`, 17 tests at first, 47 after the
  review fixes. Removing the `DestructorScope` from `~StatementSync` makes the
  GC test fail (`return()` ran from the finalizer). Final `npm test`: 76
  suites, 1203 pass; `test:node`: 546 pass, 0 fail.
- **`memory:check`** passed before the review fixes and again on the final tree
  (ASan/UBSan over all of Jest, 1203 pass; Valgrind 0 bytes definitely lost).
- **`test:docker:alpine`** on the final tree: Node 22 1191 pass, Node 24 1203
  pass, Node 26 1203 pass. The three stale `node-sqlite-test-alpine-*`
  containers were removed first (with approval); their `/tmp/project/.git` was
  a directory, which fails the tar copy from a worktree.
- **Task 5**: types, `doc/api-reference.md`, `doc/migrating-from-better-sqlite3.md`,
  `README.md`. `npm run lint` and `npm run lint:full` pass.

### Discoveries

- **`close()` could leave a statement unfinalized.** `return()` runs while
  `FinalizeStatements()` drains its copy of the set, and a statement it
  prepares there was never finalized: `sqlite3_close` then fell back to
  `sqlite3_close_v2`, and the statement kept a `database_` pointer that
  `~StatementSync` would use after the `DatabaseSync` was freed.
  `FinalizeStatements()` now repeats until the set is empty (test "close()
  finalizes a statement that return() prepares", red before the fix). Upstream's
  `FinalizeStatements()` iterates `statements_` while `return()` can insert into
  it; not reported upstream yet.
- **Pre-existing, out of scope: eponymous virtual table + `deserialize()`
  segfaults.** Querying any eponymous table (`json_each`, `dbstat`,
  `pragma_function_list`) before and after `deserialize()` crashes in
  `sqlite3SchemaToIndex` from `sqlite3WhereBegin`, with or without
  `createModule()`. Reproduced in plain C against `src/upstream/sqlite3.c`: it
  needs `SQLITE_ENABLE_PREUPDATE_HOOK` plus one of `SQLITE_OMIT_SHARED_CACHE`,
  `SQLITE_ENABLE_DBSTAT_VTAB`, `SQLITE_ENABLE_FTS3/4/5`, `SQLITE_ENABLE_RTREE`.
  Node 24.21's `node:sqlite` does not crash. Handed to a separate task; the
  `deserialize()` test here does not query the table afterwards.
- `Napi::Value::IsObject()` is true for functions, like V8's `IsObject()`, so
  `createModule()`'s argument checks match upstream without extra cases.
- **The `deserialize()` crash is a SQLite bug** (the maintainer chose to report
  it and wait, 2026-10-02). `sqlite3VtabEponymousTableInit()` caches
  `db->aDb[0].pSchema`; `sqlite3_deserialize()` reopens `main` through
  `attachFunc()`, which frees that `Schema`. With SQLite's default options under
  ASan the C repro reports `heap-buffer-overflow` in `sqlite3SchemaToIndex`;
  builds that survive reuse the freed address. SQLite trunk (2026-10-02) has
  the same code. Clearing every module's eponymous table in the reopen branch
  fixed it in a scratch copy. A separate agent reports it on the SQLite forum
  and syncs the fix; `doc/api-reference.md` has a known-issue note under
  `deserialize()` until then.

### Cross-model review (Codex, 4 passes, session 01a0ff74-7125-72a0-b7b8-0048e84f4e5b)

Every accepted finding was reproduced before its fix and is pinned by tests in
`test/create-module.test.ts`.

| ID     | Finding                                                                              | Verdict                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R019-A | `return()` could close/step its statement while `close()`/`db.close()` finalized it  | Accepted: SIGSEGV or hang. Statements are marked finalized before `sqlite3_finalize`, as upstream's `unique_ptr::reset()` does.                                      |
| R019-B | Iterator `return()` reset its statement without `StepGuard`                          | Accepted: SIGSEGV or hang. Guarded. Stricter than upstream, whose `StatementIterator::Return` has the same gap.                                                      |
| R019-C | `exec()` bypassed the ignore flag and cleanup precedence                             | Accepted: wrong error, and `process.exit()` in a worker aborted (also for UDFs). `Exec()` uses `ThrowEnhancedSqliteErrorWithDB`.                                     |
| A-1    | `All()`/`Get()` reset in `catch` after `StepGuard` was gone (own read)               | Accepted on review only; no test can force a C++ exception there. Guard declared before `try`.                                                                       |
| R019-D | Statement reuse with named parameters replaced a throwing `return()`'s error         | Accepted: plain `Error` instead of the thrown value. `Reset()` returns false with the exception pending; callers return.                                             |
| R019-E | `process.exit()` in `return()` aborted via iterator `return()`/`next()`/`iterate()`  | Accepted, widened: also six failing-statement paths ("terminate called"). Pending checks after resets; the error helper stops when JS can't run.                     |
| R019-F | Same exit during `deserialize()` with an authorizer aborted                          | Accepted diagnosis; narrower fix than proposed: return only when JS can no longer run, so an ordinary throw keeps upstream's behavior. Not re-reviewed (4-pass cap). |
| R842-A | `db[Symbol.dispose]()` threw a throwing `return()`'s error (maintainer's review run) | Accepted: reproduced. Upstream `Database::Dispose` runs `Close()` under a `TryCatch` and drops the error; `Dispose()` now clears it with raw Node-API calls.         |

### Moved to `main` (2026-10-02)

The work moved from the worktree branch `claude/sharp-leakey-28168e` (based on
`7df3343`) to the main checkout after v3.0.0 (`9d690c2`). `main` had routed
`SQLITE_TEXT` in both old conversion copies through `SqliteTextToValue()`
(`ERR_STRING_TOO_LONG` for oversized text, commit `9374063`); that change now
lives in `sqlite_value_conversion.cpp`, so virtual table parameters get it too.
`main`'s change to the SQLite error helpers (throw when the ignore flag is set
but nothing is pending) merged cleanly with the cleanup-precedence change.

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

## Goal definition

- **What success looks like**: `db.createModule(name, options)` registers a
  SQLite virtual table module whose rows come from a JavaScript iterable, with
  the same arguments, error codes, messages, re-entrancy rules, and iterator
  cleanup as `node:sqlite` at `v26.x-staging@6c924ee`.
- **Core problem**: upstream implements the feature entirely in C++
  (`VirtualTableModule` in `src/upstream/node_sqlite.{h,cc}`, calling V8
  directly). Our native layer has no `createModule`, and the sync scripts skip
  its tests.
- **Key constraints**: match `node:sqlite` messages and codes; no C++ exception
  may cross a SQLite callback; no user JavaScript may run from a finalizer;
  never edit `src/upstream/`; never bump `package.json` `version`.
- **Success validation**: all 45 tests in
  `test/node-compat/test-sqlite-virtual-table.test.js` and the two un-skipped
  `createModule()` tests in `test-sqlite-options-getter-reentry.test.js` pass
  under `npm run test:node`; `npm test`, `npm run lint:full`, and
  `npm run memory:check` pass; `npm run test:docker:alpine` passes.

There is no local behavior oracle: the local Node is v24.21.0, no Node.js
release contains `createModule()` yet, and `@types/node` 26.6.2 has no
declaration for it. The upstream tests and `src/upstream/node_sqlite.cc` are
the reference.

## Context research

### Upstream sources

Line numbers below are at `6c924ee` and move with every sync. Re-locate them:

```bash
grep -n "VirtualTableModule\|NodeVTab" $PROJECT_ROOT/src/upstream/node_sqlite.h
grep -n "^// VirtualTableModule\|^void Database::CreateModule\|\"createModule\"" \
  $PROJECT_ROOT/src/upstream/node_sqlite.cc
```

| What                                                     | Where (6c924ee)                |
| -------------------------------------------------------- | ------------------------------ |
| `NodeVTab`, `NodeVTabCursor`, `class VirtualTableModule` | `node_sqlite.h:652-739`        |
| `friend class VirtualTableModule` on `Database`          | `node_sqlite.h:364`            |
| `VirtualTableModule` implementation (all callbacks)      | `node_sqlite.cc:1027-1520`     |
| `Database::CreateModule` (validation, schema, register)  | `node_sqlite.cc:2841-3068`     |
| `SetMethod(..., "createModule", ...)`                    | `node_sqlite.cc:5332`          |
| `DestructorScope` in `~Database` / `~Statement`          | `node_sqlite.cc:1569`, `:3743` |
| `JSValueToSQLiteResult`, `SQLITE_VALUE_TO_JS`            | `node_sqlite.cc:316`, `:198`   |

Upstream PRs: [#65787](https://github.com/nodejs/node/pull/65787) (the
feature) and [#66195](https://github.com/nodejs/node/pull/66195) (run the
generator's `return()` when SQLite re-invokes `xFilter` on a cursor). Their
SHAs differ between `main` and `v26.x-staging` because staging is rebased;
refer to them by PR number.

Upstream docs: `doc/api/sqlite.md`, section `` ### `database.createModule(name, options)` ``,
fetched with:

```bash
gh api "repos/nodejs/node/contents/doc/api/sqlite.md?ref=6c924ee1b073996c5203ee6adbf6f6ad8981c093" \
  --jq .content | base64 -d
```

### Upstream changes after 6c924ee

As of 2026-10-02, `v26.x-staging` has no `src/node_sqlite.cc` commits after
`6c924ee`. `main` has one that changes virtual tables:

- `9bf40b24cd` "sqlite: reject plans with unusable virtual table parameters"
  ([#66215](https://github.com/nodejs/node/pull/66215), fixes
  [#66214](https://github.com/nodejs/node/issues/66214)). `xBestIndex` returns
  `SQLITE_CONSTRAINT` when a hidden column has an `EQ` constraint that is not
  usable at that point in the plan; without it,
  `SELECT DISTINCT * FROM m(t.a) JOIN t ON t.a = m.a` calls `rows(null)` and
  returns no rows. 15 lines in `xBestIndex`, 35 test lines. See D3.

Re-check before starting, and again before the final validation:

```bash
export GITHUB_TOKEN=$(gh auth token)
for b in v26.x-staging main; do
  gh api "repos/nodejs/node/commits?sha=$b&path=src/node_sqlite.cc&since=2026-09-29T13:13:08Z" \
    --jq '.[] | .sha[0:10] + " " + (.commit.message|split("\n")[0])'
done
```

### What node:sqlite does (the behavior to reproduce)

**`createModule(name, options)`**, in this order:

1. `ERR_INVALID_STATE` "database is not open"; then
   `ERR_INVALID_STATE` "database cannot be accessed from an authorizer callback".
2. `name` not a string: `ERR_INVALID_ARG_TYPE` `The "name" argument must be a string.`
3. `options` not an object (including `null`): `ERR_INVALID_ARG_TYPE`
   `The "options" argument must be an object.`
4. `options.columns` not an array: `ERR_INVALID_ARG_TYPE`; empty:
   `ERR_INVALID_ARG_VALUE` `The "options.columns" array must not be empty.`
5. `options.rows` not a function: `ERR_INVALID_ARG_TYPE`.
6. `directOnly`, then `useBigIntArguments`: `undefined` or boolean, else
   `ERR_INVALID_ARG_TYPE`.
7. Per column, in order: object; `name` string; `type` string; `hidden`
   `undefined` or boolean; then `type` in `INTEGER`/`TEXT`/`REAL`/`BLOB`/`ANY`
   (`ERR_INVALID_ARG_VALUE`). Note the `type` value check comes after `hidden`.
8. Re-check `IsOpen()`: every property read above can run a getter that closes
   the database.
9. Schema: `CREATE TABLE x("name" TYPE[ HIDDEN], ...)`, each `"` in a name
   doubled. Register with `sqlite3_create_module_v2(db, name, &module_def_,
module, xDestroyModule)`; on failure throw the SQLite error.

Exact message strings are in `node_sqlite.cc:2841-3068`; copy them verbatim.

**Callbacks** (`iVersion = 1`, read-only: no `xUpdate`):

| Callback                 | Runs JS?                                                                      | What it does                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xCreate` (= `xConnect`) | no                                                                            | `sqlite3_declare_vtab(schema)`; `sqlite3_vtab_config(SQLITE_VTAB_DIRECTONLY)` if `directOnly`; allocates `NodeVTab`.                                                                                                                                                                                                                  |
| `xBestIndex`             | no                                                                            | For each hidden column, the first usable `EQ` constraint gets the next `argvIndex` and `omit = 1`. `idxStr` = comma-separated hidden-column indices in argv order (a bitmask would cap at 32 parameters; a test covers 40). `idxNum` = count. `estimatedRows = estimatedCost = max(1000 / 10^count, 1)`.                              |
| `xDisconnect`/`xDestroy` | no                                                                            | Deletes the `NodeVTab`.                                                                                                                                                                                                                                                                                                               |
| `xOpen`                  | no                                                                            | Allocates a cursor with `done = true`, `rowid = 0`, `hidden_values` sized to the column count.                                                                                                                                                                                                                                        |
| `xFilter`                | yes: old iterator's `return()`, `rows()`, `[Symbol.iterator]` getter and call | Closes the previous iterator (refilter, PR #66195; a throw there fails this query); resets state; builds `rows()` arguments (`null` for unconstrained parameters) from `argv` via `idxStr`; keeps `sqlite3_value_dup` copies of constrained hidden values; calls `rows()` with `this = undefined`; takes the iterator; calls `xNext`. |
| `xNext`                  | yes: `next` getter and call, `done` and `value` getters                       | `done` uses JavaScript truthiness. On a row: `rowid++`, keep `value` as the current row.                                                                                                                                                                                                                                              |
| `xEof`                   | no                                                                            | Returns `done`.                                                                                                                                                                                                                                                                                                                       |
| `xColumn`                | yes for visible columns: `row[visibleIndex]` (may be a getter)                | Out-of-range index → NULL. Hidden column → its `dup`ed constrained value, or NULL. Non-object row → NULL. Otherwise convert `row[visibleIndex]`.                                                                                                                                                                                      |
| `xRowid`                 | no                                                                            | Returns the per-filter counter (first row is 1).                                                                                                                                                                                                                                                                                      |
| `xClose`                 | yes: `return` getter and call                                                 | `CloseIterator`, then frees the cursor. SQLite ignores the return code.                                                                                                                                                                                                                                                               |
| `xDestroyModule`         | no                                                                            | Deletes the module.                                                                                                                                                                                                                                                                                                                   |

**Errors from callbacks** (three kinds, kept distinct upstream):

- _JavaScript threw_: `PropagateJSError()` leaves the exception pending, sets
  `SetIgnoreNextSQLiteError(true)`, returns `SQLITE_ERROR`. The caller sees the
  thrown value. `xColumn` also calls `sqlite3_result_error(ctx, "", 0)`.
- _Iteration-protocol violation, nothing thrown_: `ReportProtocolError()` puts
  the message in `pVtab->zErrMsg` and returns `SQLITE_ERROR`, so the caller
  gets `ERR_SQLITE_ERROR` with that message, from both `prepare().all()` and
  `exec()`. The four messages: `rows` returned a non-object; `Symbol.iterator`
  returned a non-object; iterator has no `next()`; `next()` returned a
  non-object.
- _Cleanup threw in `xClose`_: the exception is left pending, the ignore flag is
  **not** set (no SQLite error pairs with it), so the next unrelated SQLite
  error is still reported.

**`CloseIterator` skips `return()`** when there is no iterator, when the
database is inside a destructor, or when a JavaScript exception is already
pending (calling into JS would discard it; a generator whose body threw has
already run `finally`). The `return` lookup is inside the same try as the call,
so a throwing `return` getter behaves like a throwing `return()` method.

**Re-entrancy upstream enforces**:

- `close()` from `rows()`, from `next()`, or from a row getter:
  `ERR_INVALID_STATE` "database cannot be closed while in a callback". Each
  callback that runs JS holds `CallbackDepthGuard`.
- `createModule()` from an authorizer: "database cannot be accessed from an
  authorizer callback".
- `createModule()` on a closed database, or after a getter in `options` or a
  column definition closes it: "database is not open".

### Existing patterns in this repo

```bash
grep -n "class CallbackGuard\|EnterCallback\|ThrowIfInAuthorizerCallback\|SetIgnoreNextSQLiteError" \
  $PROJECT_ROOT/src/sqlite_impl.h
grep -n "^Napi::Value DatabaseSync::CustomFunction\|^Napi::Value DatabaseSync::AggregateFunction\|^static std::string TakeProgressErrorMessage\|^void BackupJob::ReportProgress\|^inline void ThrowEnhancedSqliteErrorWithDB\|^StatementSync::~StatementSync\|^DatabaseSync::~DatabaseSync" \
  $PROJECT_ROOT/src/sqlite_impl.cpp
```

| Upstream                               | Ours (at 7df3343)                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CallbackDepthGuard`                   | `DatabaseSync::CallbackGuard` / `EnterCallback()` (`sqlite_impl.h:292`). Also pins open sessions, as upstream's guard does.                                                                                  |
| `THROW_AND_RETURN_IF_IN_AUTHORIZER`    | `ThrowIfInAuthorizerCallback(env)` (`sqlite_impl.cpp:738`)                                                                                                                                                   |
| `PropagateJSError` effect              | `SetIgnoreNextSQLiteError(true)`, consumed by `ThrowEnhancedSqliteErrorWithDB` / `ThrowErrSqliteErrorWithDb` (`sqlite_impl.cpp:35-72`)                                                                       |
| `DestructorScope` / `IsInDestructor()` | **missing**; added in Task 3                                                                                                                                                                                 |
| `Database::CustomFunction`             | `DatabaseSync::CustomFunction` (`sqlite_impl.cpp:1588`): option parsing, the `IsOpen()` re-check after reading options, and "SQLite already invoked xDestroy" on a failed registration                       |
| `UserDefinedFunction` lifetime         | `src/user_function.{h,cpp}`: heap object owned by a SQLite registration, freed by SQLite's destroy callback, holds a `Napi::FunctionReference`, `Reset()`s it in an env `CleanupHook`, not in the destructor |
| Calling JS that may be terminated      | `BackupJob::ReportProgress` + `TakeProgressErrorMessage` (`sqlite_impl.cpp:4697-4740`): raw `napi_call_function`                                                                                             |

`src/aggregate_function.cpp` is the same lifetime as `UserDefinedFunction` but
keeps state in SQLite's aggregate context; the virtual table keeps state in the
cursor, which we allocate, so the aggregate's POD-only rule does not apply to
the cursor (see Landmine 6).

### Landmines

1. **C++ exceptions cannot cross SQLite's C frames** (`AGENTS.md`).
   `binding.gyp` defines `NAPI_CPP_EXCEPTIONS`, so every failed node-addon-api
   call throws `Napi::Error`, including calls made while a JS exception is
   pending. glibc tolerates an escaping throw; musl segfaults. Every callback in
   the table above that touches N-API, `std::string`, or `std::vector` wraps its
   whole body: `try { ... } catch (const Napi::Error&) { ... } catch (const
std::exception&) { ... } catch (...) { ... }`, in that order (`Napi::Error`
   derives from `std::exception`).

2. **Do not run user JavaScript through node-addon-api wrappers.**
   `Napi::Function::Call`, and `Napi::Object::Get` on a property that may be a
   getter, convert a throw with `Napi::Error::New(env)`. That removes the
   exception from the engine, and for the termination exception that
   `process.exit()` leaves in a worker it aborts the process (CHANGELOG 3.0.0,
   "`process.exit()` in a worker's backup progress callback"). Use raw
   `napi_call_function`, `napi_get_named_property`, `napi_get_property`
   (`Symbol.iterator`), and `napi_get_element` (row columns), and check the
   status. That covers: `rows()`, `[Symbol.iterator]` lookup and call, `next`
   lookup and call, `done` and `value` lookups, `return` lookup and call, and
   `row[i]`. After any of them fails, make no further node-addon-api calls in
   that callback before returning.

3. **Deliberate difference from AGENTS.md's "store the message, rethrow after the
   C call returns".** Leave the JS exception pending in the engine instead, as
   `UserDefinedFunction::xFunc` and upstream do. A pending JS exception is
   engine state, not a C++ exception, so it does not unwind SQLite's frames, and
   it keeps the thrown value's identity (class, `code`, custom properties,
   primitives). Storing the message would turn `throw new MyError()` into a
   plain `Error`. The `catch (const Napi::Error& e)` handler in Landmine 1 only
   fires for a node-addon-api call that failed for another reason, and by then
   node-addon-api has already taken the exception out of the engine: put the
   original value back with a raw `napi_throw(env, e.Value())` (`Value()`
   unwraps primitive throws), inside its own `try { } catch (...) { }`, then
   `PropagateJSError()`. `std::exception` → `SQLITE_NOMEM` for `std::bad_alloc`,
   else `zErrMsg = e.what()` and `SQLITE_ERROR`; `...` → fixed `zErrMsg`,
   `SQLITE_ERROR`.

4. **Our destructors run later than upstream's, and still must not run user
   JS.** With `NAPI_VERSION=8`, Node-API queues `ObjectWrap` finalizers and runs
   them from a `SetImmediate` after the GC (`../node/src/node_api.cc`,
   `EnqueueFinalizer` / `DrainFinalizerQueue`; `js_native_api_v8.cc`
   `InvokeFinalizerFromGC`). Upstream's test "does not run cleanup when the
   statement is collected" asserts right after `gc({ execution: 'sync' })`, so
   it passes against our addon even if `xClose` calls `return()` from
   `~StatementSync` a moment later. Task 3 adds the destructor scope; Task 4 adds
   a Jest test that awaits `setImmediate` before asserting.

5. **Where `xClose` runs.** `sqlite3_reset` and `sqlite3_finalize` close a
   statement's vtab cursors, and so does the VM halting inside `sqlite3_step`
   (`LIMIT`, end of results, an error). Paths that reach it:
   `StatementSync` `Run`/`Get`/`All`/`Reset`, `StatementSyncIterator`
   `Next`/`Return`/`ToArray`, `CloseStatement`, `FinalizeFromDatabase` (from
   `close()`, `deserialize()`, and `~DatabaseSync`), and `~StatementSync`.
   List them with
   `grep -n "sqlite3_reset\|ResetStatement()\|sqlite3_finalize\|sqlite3_step" $PROJECT_ROOT/src/sqlite_impl.cpp`.
   Only `~StatementSync` and `~DatabaseSync` are destructor paths.

6. **`Napi::Reference` lifetime** (auto-memory "N-API Reference GC hazard";
   commit `4da0638`). Never put a reference on an `ObjectWrap`. The cursor and
   the module are plain C++ objects owned by SQLite, not `ObjectWrap`s. They
   still release their references from inside `~StatementSync`/`~DatabaseSync`
   when those finalize the statement or close the connection. Precedent:
   `UserDefinedFunction::fn_` is released the same way (SQLite calls `xDestroy`
   from `sqlite3_close` in `~DatabaseSync`), and that passes Alpine CI. Risk R1
   covers what to do if Alpine disagrees.

7. **`NAPI_VERSION=8` cannot reference a primitive.** `napi_create_reference`
   accepts only objects, functions, and symbols. Keep `current_row` only when
   `value` is an object; otherwise the row is all NULL, which is what upstream's
   `xColumn` returns for a non-object row anyway.

8. **A SQLite error must outrank a throwing cleanup.** In
   `INSERT INTO t SELECT value FROM both_fail`, the constraint fails, SQLite
   closes the cursor, and `return()` throws. Upstream's
   `THROW_ERR_SQLITE_ERROR(isolate, db)` replaces the pending exception. Ours
   calls `Napi::Error::New` in `node::ThrowEnhancedSqliteError`
   (`src/shims/sqlite_errors.h:92`) with the cleanup exception still pending;
   that throws a C++ `Napi::Error` carrying the cleanup error, and `All()`'s
   `catch (const std::exception&)` rethrows it as a generic
   `Error("cleanup boom")` without `code`. Fix in `ThrowEnhancedSqliteErrorWithDB`
   (and `ThrowErrSqliteErrorWithDb`): after the ignore-flag check, clear a
   pending exception before building the SQLite error. Check the other direct
   `node::ThrowEnhancedSqliteError` callers that a statement step can reach.

9. **`sqlite3_create_module_v2` frees the module itself when it fails**
   (`src/upstream/sqlite3.c`, `createModule()`:
   `if( rc!=SQLITE_OK && xDestroy ) xDestroy(pAux);`). Do not `delete` it again;
   `CustomFunction` has the same comment for functions.

10. **Tooling lists source files by name.** A new `src/virtual_table.cpp` must
    be added to `binding.gyp` `sources` and `scripts/clang-tidy.ts` (line 152).
    `scripts/sanitizers-test.sh` matches UBSan reports against
    `(sqlite_impl|async_pool_impl|user_function|aggregate_function|binding)\.(cpp|h)`
    (lines 264 and 313): without an edit, UBSan findings in the new file are
    silently ignored by `memory:check`. `package.json` `files` already covers
    `src/*.cpp` and `src/*.h`.

11. **The test sync defaults to the newest staging HEAD**, not the synced
    source. `scripts/sync-node-tests.ts --branch` accepts a SHA; pin it to
    `6c924ee1b073996c5203ee6adbf6f6ad8981c093` so the tests match
    `src/upstream/`, then check that `git diff --stat test/node-compat` touches
    only the two expected files.

12. **Value conversion differs from upstream in three places today.** Our UDF
    result conversion (`UserDefinedFunction::JSValueToSqliteResult`) turns a
    boolean into 0/1 (upstream: "cannot be converted" error), throws
    `ERR_OUT_OF_RANGE` for a BigInt outside int64 (upstream: SQLite error
    "BigInt value is too large for SQLite"), and rejects `ArrayBuffer` and
    `SharedArrayBuffer` (upstream: stored as BLOB). `xColumn` will reuse that
    conversion (D2), so a yielded boolean becomes 0/1 here. The upstream tests
    do not cover these values. Document the differences in
    `doc/api-reference.md`.

13. **The worktree has no `node_modules`, `build/`, or `prebuilds/`.** Run
    `npm ci` first. `npm run memory:check` swaps the addon binary; do not run it
    while anything else runs tests (auto-memory "memory:check is exclusive").

### Risk R1: releasing the iterator reference from a finalizer

Plan: the cursor holds `Napi::ObjectReference iterator` and `current_row`, and
`xClose` releases them, including when `xClose` runs from a destructor
(Landmine 6 precedent). Validation: the Task 4 GC test, run in a loop under
`npm run test:docker:alpine`. If Alpine crashes there, the fallback is: inside a
destructor scope, call `SuppressDestruct()` on both references instead of
deleting them. That leaks the abandoned generator until environment teardown,
but only for a statement collected while its vtab cursor is open. Do not use
`ValueStorage` (`aggregate_function.cpp`): erasing from it destroys a
`Napi::Reference` the same way.

## Decisions (answered 2026-10-02)

- **D1, release placement: 3.1.0.** `CHANGELOG.md` has an unreleased 3.0.0
  entry (no `v3.0.0` tag; npm has 2.6.0) whose intro says `createModule()` "is
  not ported yet". 3.0.0 ships without this port and keeps that sentence;
  `createModule()` goes under `### Added` in 3.1.0 (minor). Propose the line;
  do not edit `CHANGELOG.md` without approval.
- **D2, value conversion: one shared implementation.** `user_function.cpp`
  and `aggregate_function.cpp` each have a copy of `SqliteValueToJS` and
  `JSValueToSqliteResult`; they differ only in formatting and an unreachable
  `default:` (`Null` vs `Undefined`). Task 1b moves them into one file used by
  UDFs, aggregates, and the virtual table, as a separate behavior-neutral
  commit before Task 2.
- **D3, upstream `main` fix 9bf40b24cd: wait for the sync.** Port `6c924ee`
  as is. The maintainer is handling this on `main`; do not sync upstream on
  this branch. Task 6 re-checks upstream; if the fix has reached
  `v26.x-staging` and `main` has synced it, merge `main` and port it before
  release.
- **D4, callback errors: leave the JS exception pending** (Landmine 3), not the
  store-the-message form `AGENTS.md` describes. Whether to add a sentence to
  `AGENTS.md` describing this form is still open.

## Tasks

### Don't blindly follow this section!

It is your responsibility to reach the goal. These tasks were the best plan at
writing time. If research shows a simpler path that still follows
`doc/reference/SIMPLE-DESIGN.md`, propose the revision with its pros and cons
before taking it.

### Task 0: Baseline

**Success**: `npm run build && npm run test:node` runs, and the pre-existing
failures (if any) are written down here before any change.

1. `npm ci`
2. `npm run build` (`build:dist` + `build:native`)
3. `npm run test:node`; record failures. Do not fix unrelated ones; report them.

### Task 1: Re-enable the upstream tests (red)

**Success**: `node --expose-gc --test test/node-compat/test-sqlite-virtual-table.test.js`
reports 45 failures, each caused by `TypeError: db.createModule is not a
function` (the `input validation` assertions fail because that error has no
`code`); the two un-skipped getter re-entry tests fail the same way.

1. In `scripts/adapt-node-test.ts`, remove `"test-sqlite-virtual-table.js"` from
   `skipFiles` (with its comment) and the two `createModule()` entries under
   `skipTests["test-sqlite-options-getter-reentry.js"]`.
2. `npx tsx scripts/sync-node-tests.ts --force --branch 6c924ee1b073996c5203ee6adbf6f6ad8981c093`
   (Landmine 11). Without `--force`, the gitignored `.sync-cache.json` skips
   regeneration.
3. `npx prettier --cache --write test/node-compat/`
4. `git diff --stat test/node-compat` shows the new
   `test-sqlite-virtual-table.test.js`, the two un-skipped tests, and possibly
   `README.md`. Anything else means the last sync used a different SHA: stop
   and report it.
5. Run both files; confirm the failure reason.

**What this validates**: the tests are wired in and fail for the missing
method, not for a sync or adaptation error.

### Task 1b: One value-conversion implementation (D2)

**Success**: `npm test` and `npm run test:node` results equal Task 0's;
`grep -n "SqliteValueToJS\|JSValueToSqliteResult" $PROJECT_ROOT/src/*.cpp`
finds one definition of each.

1. New `src/sqlite_value_conversion.{h,cpp}` (name is a suggestion) with free
   functions taking the env and, for `SqliteValueToJS`, `use_bigint_args`.
   Body: the `user_function.cpp` copy.
2. `UserDefinedFunction` and `CustomAggregate` call them; delete their member
   copies.
3. Wire the new `.cpp` into `binding.gyp`, `scripts/clang-tidy.ts`, and the
   `scripts/sanitizers-test.sh` regexes (Landmine 10).
4. Its own commit, ahead of the feature commits.

### Task 2: Registration and the read path

**Success**: these suites pass: `input validation`, `basic virtual table`,
`table-valued function with parameters`, `type conversions`,
`useBigIntArguments`, `hidden column constraints`, `error handling`,
`multiple queries`; and both getter re-entry tests. The `iteration protocol
violations` suite may pass here too.

**Implementation**:

1. New `src/virtual_table.{h,cpp}` with `NodeVTab`, `NodeVTabCursor`, and
   `VirtualTableModule`, keeping upstream's names and callback order so a later
   diff against `src/upstream/node_sqlite.cc` lines up. Wire the file into
   `binding.gyp`, `scripts/clang-tidy.ts`, and the two regexes in
   `scripts/sanitizers-test.sh` (Landmine 10).
2. `VirtualTableModule` members: `Napi::Env env_`, `DatabaseSync* db_` (the
   module cannot outlive the connection, which cannot outlive the
   `DatabaseSync`: `InternalClose()` finalizes every tracked statement before
   `sqlite3_close`), `Napi::FunctionReference rows_fn_` with an env
   `CleanupHook` copied from `UserDefinedFunction`, `schema_sql_`,
   `num_columns_`, `hidden_col_indices_`, `col_index_map_`, `use_bigint_args_`,
   `direct_only_`, and its own `sqlite3_module module_def_` (upstream: one per
   instance so worker threads never share one).
3. `DatabaseSync::CreateModule` in `sqlite_impl.cpp`, registered as
   `InstanceMethod("createModule", ...)` in `DatabaseSync::Init`. Follow
   upstream's validation order and messages exactly (see "What node:sqlite
   does"). Use `ThrowIfInAuthorizerCallback`; re-check `IsOpen()` after reading
   options; do not delete the module after a failed registration (Landmine 9).
4. Pure-C callbacks first: `xCreate`, `xBestIndex`, `xDisconnect`, `xDestroy`,
   `xOpen`, `xEof`, `xRowid`, `xDestroyModule`. Then `xFilter`, `xNext`,
   `xColumn` with the error rules in Landmines 1–3, `CallbackGuard` +
   `Napi::HandleScope` in each, and a `CanCallIntoJS()` check before any JS
   (always true until Task 3 adds the destructor scope). No
   `Napi::CallbackScope`: upstream calls `rows()` directly.
5. Argument conversion for `rows()` and result conversion in `xColumn` per D2.
   Out-of-safe-range integers without `useBigIntArguments` throw
   `ERR_OUT_OF_RANGE` as in UDFs and upstream.
6. `xClose` in this task: free the cursor and its references; no `return()`
   yet.

**If architecture changed**: find the UDF registration with
`grep -n "sqlite3_create_function_v2" $PROJECT_ROOT/src/*.cpp` and the callback
guard with `grep -n "EnterCallback" $PROJECT_ROOT/src/*.h`.

**What these tests validate**: argument validation, schema generation, query
planning with parameters (including more than 32), value conversion in both
directions, propagation of errors thrown by `rows()` and by iteration. They do
not exercise C++ exceptions (none can be forced from JS) or musl; the
try/catch structure is validated by review against Landmine 1.

**Completion checklist**:

- [ ] Suites above pass
- [ ] `grep -n "createModule" $PROJECT_ROOT/src/sqlite_impl.cpp` shows the
      registration
- [ ] Every callback that touches N-API has the three-level catch:
      `grep -n "catch (const Napi::Error" $PROJECT_ROOT/src/virtual_table.cpp`
- [ ] No `Napi::Function::Call` / `.Call(` / `.Get(` on user objects in
      `virtual_table.cpp` (Landmine 2)

### Task 3: Iterator lifecycle and the remaining errors

**Success**: suites `re-entrancy`, `iterator cleanup`, and
`iteration protocol violations` pass; the whole file passes.

**Implementation**:

1. Destructor scope: add a depth counter and RAII guard to `DatabaseSync`
   (upstream `DestructorScope`, `IncrementDestructorDepth`, `IsInDestructor`).
   Raise it in `~DatabaseSync` around `InternalClose()`, and in
   `~StatementSync` around `sqlite3_finalize` when `database_` is non-null
   (when it is null, `CloseStatement()` or `FinalizeFromDatabase()` already
   finalized the statement).
   `VirtualTableModule::CanCallIntoJS()` returns `!db_->IsInDestructor()`.
2. `CloseIterator(cursor)` with upstream's three skip conditions (Landmine 4,
   "CloseIterator skips"), its own `CallbackGuard`, the `return` lookup and call
   in one guarded block, and the throw left pending. Call it from `xClose` and
   at the start of `xFilter` (refilter; on a throw, `PropagateJSError`).
3. `xClose` must not set the ignore flag (test "a throwing cleanup does not
   swallow the next SQLite error").
4. The pending-exception fix in the SQLite-error helpers (Landmine 8; test
   "a SQLite error outranks a throwing cleanup").
5. `ReportProtocolError` for the four protocol violations; confirm `exec()`
   reports them with `ERR_SQLITE_ERROR` too.

**What these tests validate**: `return()` on `LIMIT`, on `break` from
`for...of`, on refilter, and its absence when the body threw; a throwing
`return()` method or getter surfaces; close() is rejected from `rows()`,
`next()`, and a row getter; `createModule()` is rejected from an authorizer. The
GC test does **not** validate the destructor scope (Landmine 4); Task 4 does.

### Task 4: Garbage collection, teardown, and workers

**Success**: the Jest tests below pass under `npm test`, and
`npm run test:docker:alpine` passes.

**Implementation**:

1. Open cursors at environment teardown. Env cleanup hooks run before
   Node-API finalizes the remaining `ObjectWrap`s: Node-API registers its own
   teardown hook when the addon loads (`../node/src/node_api.cc`, `NewEnv`),
   hooks run in reverse order, and that hook's `DeleteMe()` is what runs the
   finalizers. The repo resets references in cleanup hooks rather than in
   teardown destructors (`UserDefinedFunction`, `CustomAggregate`,
   `DatabaseSync`). Track open
   cursors in the module (added in `xOpen`, removed in `xClose`); the module's
   `CleanupHook` resets each open cursor's `iterator` and `current_row`, so
   `xClose` during teardown finds them empty.
2. New `test/create-module.test.ts`, covering what the upstream tests do not:
   - A statement collected with its cursor open: abandon
     `prepare(...).iterate().next()`, `global.gc()`, then await `setImmediate`
     several times so Node-API's queued finalizers run, then assert the
     generator's `finally` did not run and the process is alive.
   - The exact thrown value reaches the caller: an `Error` subclass with a
     `code` from `rows()`, from `next()`, and from a row getter
     (`toBe(thrown)`), and a primitive `throw 42`.
   - `close()` with a suspended iterator runs `return()`; a throwing `return()`
     surfaces from `close()` and `isOpen` is then `false`. Same for
     `deserialize()`.
   - Worker: a worker suspends a vtab iterator and exits (`process.exit(3)`)
     → exit code 3, no abort. A worker whose `rows()` calls `process.exit(4)` →
     exit code 4, no abort (Landmine 2). Copy the worker setup from an existing
     `test/worker-threads-*.test.ts`.
   - Probes for `memory:check` (keep them; ASan decides): `createModule()` that
     replaces the module from inside its own `rows()`, and a `return()` that
     prepares a new statement while `close()` is finalizing statements.
     Upstream has neither guard; if ASan reports a defect, record it here and
     report it upstream rather than inventing a guard.
     Use `useTempDir` only if a test needs a file; close every database.
3. Run the GC test 20 times in the Alpine container. If it crashes, apply the
   R1 fallback and record the result here.

### Task 5: TypeScript surface and documentation

**Success**: `npm run lint` passes; `npm run docs` builds; a type test
compiles a call with columns, a generator `rows`, `directOnly`, and
`useBigIntArguments`.

1. New `src/types/create-module-options.ts`, in the style of
   `user-functions-options.ts`: `readonly` fields, TSDoc with `@default`.
   Suggested names `CreateModuleOptions` and `VirtualTableColumn`
   (`@types/node` has no names for these yet). `type` is the union
   `"INTEGER" | "TEXT" | "REAL" | "BLOB" | "ANY"`; `rows` takes `...params:
any[]` and returns `Iterable<ArrayLike<unknown>> | Iterator<ArrayLike<unknown>>`.
2. `createModule(name: string, options: CreateModuleOptions): void` on
   `DatabaseSyncInstance` (`src/types/database-sync-instance.ts`), next to
   `aggregate()`, with TSDoc that names `sqlite3_create_module_v2()`.
3. Export the new types from `src/index.ts` beside `AggregateOptions`.
4. `doc/api-reference.md`: `#### createModule()` after `#### aggregate()`
   (signature, options, eponymous vs `CREATE VIRTUAL TABLE`, hidden columns as
   parameters, the number→REAL / bigint→INTEGER note with upstream's
   `generate_series` example, the conversion differences from Landmine 12), and
   `### CreateModuleOptions` under "Types and interfaces". Link the CHANGELOG
   entry rather than repeating its text.
5. `doc/migrating-from-better-sqlite3.md:322` says "No virtual table API";
   replace it with a pointer to `createModule()` (better-sqlite3's equivalent is
   `db.table()`, with a different options shape). `README.md:65` feature list:
   add virtual tables.
6. `test/api-compatibility.test.ts` cannot assert `createModule` against
   `node:sqlite` types until `@types/node` declares it; leave a note in this
   TPP, not a TODO in the test.

### Task 6: Validation and review

- [ ] `npm run test:node` (all node-compat files, no new failures vs Task 0)
- [ ] `npm test`
- [ ] `npm run test:all` (CJS + ESM)
- [ ] `npm run lint:full`
- [ ] `npm run memory:check`, alone (Landmine 13); no ASan/UBSan/Valgrind
      findings in `virtual_table.cpp`
- [ ] `npm run test:docker:alpine`
- [ ] Cross-model review of the native diff (`/coding:second-opinion`;
      pre-authorized), every finding verified against the code
- [ ] Re-run the upstream check in "Upstream changes after 6c924ee"; if
      9bf40b24cd is on `v26.x-staging`, sync and port it (D3)
- [ ] CHANGELOG `### Added` line for 3.1.0 proposed to the user (D1), not
      written without approval
- [ ] Move this file to `doc/done/YYYYMMDD-P04-create-module-virtual-tables.md`

## Validation

- [ ] All tests pass: `npm test`, `npm run test:node`
- [ ] Linting passes: `npm run lint:full`
- [ ] API matches node:sqlite: the 45 upstream tests pass unmodified
