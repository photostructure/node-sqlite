# TPP: Experimental async `DatabasePool`

## Current phase

**Next**: complete Task 0 by freezing the public contract with focused failing
tests and recording the feature's starting worktree state.

- [x] Feasibility and API-boundary research
- [x] Warm-pool versus connection-per-operation benchmark comparison
- [x] Initial `DatabasePool` contract and authorizer modes agreed
- [x] Follow-up plan review adjudicated and contract gaps corrected
- [ ] Executable API and behavior contract
- [ ] One-connection executor/lifetime spike passes its go/no-go gate
- [ ] Value transport, batches, and transaction semantics implemented
- [ ] Connection setup and extension loading implemented
- [ ] Multi-connection scheduling and close lifecycle implemented
- [ ] Strict authorizer implemented
- [ ] Experimental subpath, documentation, and benchmarks integrated
- [ ] Cross-platform, memory, and full-suite validation complete
- [ ] Reviewed

Planning and review sessions have changed only this TPP; no feature
implementation exists yet.

## Goal definition

- **What success looks like**: `@photostructure/sqlite/experimental` exports a
  fixed-size `DatabasePool` whose SQLite open, prepare, bind, step, finalize,
  setup, and close work runs outside the JavaScript event loop; simple warm
  workloads sustain multiple operations per millisecond on reference hardware.
- **Core problem**: SQLite is synchronous, while the stateful `Database` and
  `Statement` API shape makes a safe async port carry persistent statement,
  connection-affinity, transaction-callback, iteration, and GC lifetime
  complexity that many async use cases do not need.
- **Solution**: expose only connection-independent `run`, `get`, `all`, and
  explicit `batch` calls over warm SQLite connections. A transaction is one
  complete batch submitted in one call. Do not expose connection or statement
  identity. All per-connection state — PRAGMAs, attachments, and native
  extensions — is declared once at `open()` and replayed identically on every
  physical connection.
- **Primary consumer requirement**: the motivating workload opens read-write
  pools whose connections need per-connection PRAGMA replay and native
  extension loading (for example sqlite-vec, including an explicit entrypoint
  symbol) — the same work its existing connection factory performs today. It
  does not need JavaScript-defined SQL functions at query time; schema
  migrations that register such functions run on `DatabaseSync` before the
  pool opens. Extension loading during connection setup is therefore an MVP
  requirement, not future work.
- **Key constraints**: preserve the stable root API exactly; stay on C++17 and
  Node-API 8; never edit `src/upstream/`; never access JavaScript or Node-API
  values from a worker thread; retain SQLite's serialized build initially; do
  not add async iteration, JavaScript SQLite callbacks, prepared-statement
  handles, or JavaScript transaction callbacks.
- **Success validation**: focused behavior/lifetime tests, CJS and ESM import
  tests, lint/types, full suites, ASan/UBSan/LSan, Valgrind, Alpine, and the
  platform/Node CI matrix pass. A benchmark records throughput, event-loop
  responsiveness, batching gains, and `strict` versus `none` authorizer cost;
  performance numbers are evidence, not timing assertions in functional tests.

This plan supersedes the API and implementation recommendation in
`doc/todo/P10-experimental-async-database.md`. Keep that document only as
research into Node.js PR #62015 and its lifetime/result traps. Do not implement
both plans.

## Required reading

Study these before continuing:

- `CLAUDE.md`
- `doc/reference/TPP-GUIDE.md`
- `doc/reference/SIMPLE-DESIGN.md`
- `doc/reference/TDD.md`
- `doc/internal/testing-philosophy.md`
- `doc/internal/threading.md`
- `doc/todo/P10-experimental-async-database.md`
- `binding.gyp`
- `src/binding.cpp`
- `src/sqlite_impl.h` and `src/sqlite_impl.cpp`
- `src/index.ts`, `tsup.config.ts`, `scripts/post-build.mjs`, and `package.json`
- `../node-addon-api/doc/async_worker.md`, `promises.md`, and
  `async_context.md`
- Node-API's synchronous and asynchronous environment-cleanup hook sections in
  `../node/doc/api/n-api.md` (or the corresponding official online docs)
- SQLite's [threading](https://sqlite.org/threadsafe.html),
  [transactions](https://sqlite.org/lang_transaction.html),
  [authorizer](https://sqlite.org/c3ref/set_authorizer.html),
  [authorizer actions](https://sqlite.org/c3ref/c_alter_table.html),
  [in-memory databases](https://sqlite.org/inmemorydb.html), and
  [shared-cache](https://sqlite.org/sharedcache.html) documentation

## User-facing contract

The draft API is deliberately named as a pool, not as an async counterpart to
every `DatabaseSync` capability:

```ts
import { DatabasePool } from "@photostructure/sqlite/experimental";

await using pool = await DatabasePool.open("app.db", {
  connections: 2,
  authorizer: "strict",
  allowExtension: true,
  connectionSetup: [
    { sql: "PRAGMA journal_mode=WAL" },
    { sql: "PRAGMA foreign_keys=ON" },
    { sql: "PRAGMA busy_timeout=5000" },
    { sql: "SELECT load_extension(?)", params: [vecExtensionPath] },
    {
      sql: "SELECT load_extension(?, ?)",
      params: [seededRandomPath, "sqlite3_seededrandom_init"],
    },
    { sql: "ATTACH DATABASE ? AS analytics", params: [analyticsPath] },
  ],
});

await pool.run("INSERT INTO users(name) VALUES (?)", ["Ada"]);
const user = await pool.get("SELECT * FROM users WHERE id = ?", [1]);
const users = await pool.all("SELECT * FROM users ORDER BY id");

const results = await pool.batch(
  [
    {
      kind: "run",
      sql: "UPDATE account SET balance=balance-? WHERE id=?",
      params: [10, 1],
    },
    {
      kind: "run",
      sql: "UPDATE account SET balance=balance+? WHERE id=?",
      params: [10, 2],
    },
    { kind: "get", sql: "SELECT balance FROM account WHERE id=?", params: [2] },
  ],
  { transaction: "immediate" },
);
```

### MVP surface and semantics

- `DatabasePool.open(location, options)` opens and configures every physical
  connection asynchronously before resolving. The fixed connection count
  defaults to one; do not add min/max growth or idle timers in the MVP. Accept
  the same `string | Buffer | URL` location types as `DatabaseSync`, but
  normalize and copy the location before queueing native open work.
- `options.authorizer` is `"strict" | "none"` and defaults to `"strict"`.
  `"none"` means exactly that no restrictive SQLite authorizer is installed;
  it does not claim that arbitrary SQL is safe for a pool.
- `options.readBigInts` and `options.returnArrays` are pool-wide immutable
  result policies with the same defaults and behavior as `DatabaseSync`. They
  do not require connection affinity. Do not add per-call or persistent
  statement configuration in the MVP.
- `connectionSetup` is declarative data, not a JavaScript callback. Each entry
  is `{ sql, params? }`. The caller declares it once; the pool executes the
  same ordered statements once on every physical connection before admitting
  that connection. Setup must be safe to replay once on each independently
  opened connection and intended for connection configuration. Each entry has
  the same exactly-one-executable-statement rule as a public operation.
  Database migrations belong in ordinary application batches, not in
  per-connection setup — migrations that need JavaScript-defined SQL functions
  must run on a `DatabaseSync` connection before the pool opens.
- `options.allowExtension` (default false) enables extension loading only
  while setup statements run, so setup can load native extensions with
  ordinary statements such as `SELECT load_extension(?, ?)` (parameters avoid
  escaping platform-specific paths). The pool disables loading again before
  the connection is admitted, so `load_extension()` is never available to user
  statements in either authorizer mode. A load failure fails `open()`.
  Implementation note: `DatabaseSync` uses
  `SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION`, which enables only the C API; the
  SQL function additionally requires `sqlite3_enable_load_extension()`, which
  the pool must call around setup and then revoke.
- `run`, `get`, and `all` accept one SQL statement and zero or one parameter
  container: an array for positional values or an object for named values.
  Named objects use the synchronous API's default binding policy: bare or
  explicitly prefixed names are accepted, conflicting bare names and unknown
  keys are rejected. Reject a second executable statement; comments and
  whitespace after the one statement are allowed without writing a SQL parser.
- `run` steps to completion and returns operation-local `changes`, not arbitrary
  history from the leased connection. Snapshot `sqlite3_total_changes64()`
  before stepping; after success, report zero when the total did not advance,
  otherwise report `sqlite3_changes64()`, which preserves direct-row semantics
  for ordinary INSERT/UPDATE/DELETE. Deliberately omit `lastInsertRowid`: SQLite
  exposes it as connection history, so it cannot be returned coherently for
  non-insert operations on a pool. Use `get`/`all` with `RETURNING` when an
  application needs generated values. `get` retains at most the first row and
  then finalizes. `all` steps to completion and materializes all rows.
- `batch` executes explicit operation descriptors sequentially in one native
  worker job on one leased connection. It supports no transaction, or
  `deferred`, `immediate`, or `exclusive`. On a transactional error it rolls
  back and rejects the whole batch. A non-transactional batch is fail-fast, but
  earlier successful operations may already have committed.
- Batch SQL and parameters must all be known when `batch()` is called. Results
  from one operation cannot be interpreted by JavaScript to construct a later
  operation inside the same transaction. Express that logic in SQL or use a
  different API.
- Awaiting call A before issuing call B provides application ordering. Calls
  submitted concurrently can run and complete in different orders on different
  connections. Do not manufacture cross-connection completion order.
- `close()` and `[Symbol.asyncDispose]()` are idempotent. Enter the closing state
  synchronously, reject new work, drain accepted queued/in-flight work, and
  close each connection exactly once.
- Input values are `null`, number, bigint, string, and copied
  `ArrayBufferView` data. Match the synchronous API where the behavior has a
  direct equivalent: null-prototype object rows, array rows under
  `returnArrays`, duplicate-column last-wins behavior, byte ranges, integer
  output under `readBigInts`, unsafe-integer errors when it is false, and
  detailed SQLite errors.
- `all()` intentionally materializes the full native result before creating
  JavaScript objects on the event-loop thread. Document both the native/JS
  memory peak and the fact that constructing a very large result can still
  pause JavaScript even though SQLite execution is off-thread.

### `strict` and `none`

After successful setup, `strict` installs one native `sqlite3_set_authorizer()`
callback on every connection. It must deny at least:

- `PRAGMA`;
- `ATTACH` and `DETACH`;
- transaction and savepoint control from user SQL;
- creation, deletion, or mutation of the temp schema;
- SQL extension loading; and
- connection-observing functions whose answers depend on which pool member was
  leased, including `last_insert_rowid`, `changes`, and `total_changes`.

`strict` is a pool-consistency policy, not a read-only mode or a sandbox for
untrusted SQL. It still permits ordinary reads and writes, does not impose
SQLite resource limits, and cannot make arbitrary native-extension functions
connection-independent. Applications that load extensions must trust those
extensions and decide whether their functions are suitable for pooled calls.

The authorizer is a non-throwing C callback over owned native state. It stays
installed while stepping because SQLite can re-prepare after a schema change.
Internal trusted transaction control uses an executor-owned flag scoped only
around preparing and stepping the executor's own `BEGIN`, `COMMIT`, or
`ROLLBACK` statement. Clear it before preparing any user operation in the
batch. Never globally remove/reinstall the callback around user work.

`none` skips installation to remove authorizer preparation overhead for trusted
production SQL. Both modes retain structural invariants:

- one executable statement per operation;
- every statement finalized on every path;
- no extension loading outside setup — loading is enabled only while setup
  statements run (and only when `allowExtension` is set), and is revoked
  before the connection is admitted; and
- `sqlite3_get_autocommit()` true before a connection returns to the pool.

If user SQL leaves autocommit off, attempt a rollback, reject the request, and
reuse the connection only if its clean state is proven. If cleanup fails, close
the connection, fail the pool visibly, and reject queued work rather than
silently shrinking the fixed pool or improvising a reconnect policy. In `none`,
later PRAGMAs, attachments, temp state, or connection-observing SQL are
explicitly the caller's responsibility and can produce nondeterministic pool
behavior. A connection-observing function may be used deliberately after an
earlier operation in the same batch establishes its value; never rely on such
state across separate calls.

### Deliberately out of scope

- Public `Statement`/`prepare`, prepared-statement caching, iteration, streams,
  or incremental result delivery.
- `function`, `aggregate`, custom authorizers, or any other SQLite callback
  into JavaScript. Workloads that need JavaScript-defined SQL functions keep
  using `DatabaseSync`.
- JavaScript transaction callbacks or data-dependent transaction builders.
- Sessions, changesets, backup, serialize/deserialize, tag stores, limits,
  runtime (post-open) extension loading, cancellation/`AbortSignal`, or
  conversion between pooled and synchronous connections.
- `readOnly` or other `DatabaseSync` open-option pass-throughs, and
  reader/writer connection roles inside the pool. WAL plus a
  `busy_timeout` setup PRAGMA already handles read-mostly workloads with
  occasional writes. A read-only pass-through can be considered later if a
  consumer needs its write-prevention guarantee; it would not require a
  reader/writer pool architecture.
- Automatic microtask batching. Explicit non-transactional `batch()` is the
  first throughput tool; add automatic batching only after measurement proves
  a need that explicit batches cannot meet.
- `SQLITE_OPEN_NOMUTEX` optimization or a global SQLite threading-mode change.
  Correct ownership under the existing serialized build comes first.

## Context research and lore

### Why warm connections

An ad hoc local benchmark compared a reused connection with
open/prepare/step/finalize/close per operation against an on-disk WAL database.
Opening alone was inexpensive, but repeated schema/WAL/cache initialization
made a fresh point read materially slower, and fresh autocommit writes missed
the required multiple-operations-per-millisecond target. Warm reads and writes
cleared it by a large margin. Reproduce this with a checked-in benchmark rather
than preserving machine-specific counts in this TPP.

This evidence rejects connection-per-operation as the shipped design, but keep
it as a benchmark control. It is useful for measuring how much complexity the
warm pool buys.

### Existing patterns worth retaining

- `BackupJob` in `src/sqlite_impl.{h,cpp}` is a useful local reference for
  `Napi::AsyncWorker`, promises, named async resources, and shutdown signaling.
  It is not proof of the pool's teardown model and is not reusable wholesale:
  it retains a raw connection owned by `DatabaseSync`, releases its JavaScript
  reference from a synchronous environment-cleanup hook, and supports progress
  callbacks. Task 1 must independently prove that an environment cannot destroy
  or close pool state while `Execute()` is using it.
- `AddonData` is per Node environment. Async constructor caches, cleanup state,
  and native handles must remain per environment so imports in
  `worker_threads` do not share JavaScript state.
- `DatabaseSync::InternalOpen`, `StatementSync::BindParameters`, and row/error
  conversion define compatibility behavior, but are coupled to `Napi::Value`
  and main-thread objects. Extract only transport-neutral seams proven by tests;
  temporary duplication is safer than destabilizing `DatabaseSync` early.
- `binding.gyp` uses SQLite's default serialized mode and
  `SQLITE_OMIT_SHARED_CACHE`. A slot still permits only one in-flight job, even
  though SQLite also serializes access internally.
- The libuv thread pool is process-global and shared with filesystem, DNS,
  crypto, and zlib work. A pool must not queue libuv workers that merely block
  waiting for a SQLite connection. Keep waiting requests in the JavaScript
  scheduler and queue native work only after leasing a slot. Idle connections
  consume native resources but no libuv worker.
- `Napi::AsyncWorker::Execute()` cannot touch `Napi::Env`, `Napi::Value`,
  `Napi::Reference`, promises, or JavaScript. Copy all input strings and view
  bytes before queueing; copy all SQLite result/error data into C++17 transport
  values before returning to the event loop.
- Environment teardown may call `sqlite3_interrupt()` from another thread to
  stop active SQL, but only while ownership proves the handle cannot close
  before that call returns. Public cancellation remains out of scope; this is a
  bounded-shutdown mechanism to prove in Task 1.
- `Napi::AsyncWorker::Cancel()` only cancels work that has not started and then
  invokes neither `OnOK()` nor `OnError()`. Teardown accounting and native
  ownership therefore cannot depend on a JavaScript-thread completion callback
  running for every queued worker.
- C++ exceptions must never cross the SQLite authorizer C callback. Return an
  SQLite authorization result and save owned diagnostic data if necessary.
- Preserve ordered column name/value pairs in native results. An unordered map
  changes property order and duplicate-column behavior.
- The project deliberately does not run useful TSan coverage under stock Node.
  Use explicit ownership review, atomics/mutexes where shared state exists,
  concurrency stress, ASan/UBSan/LSan, and Valgrind.

### Pool and SQLite limitations

- SQLite permits multiple readers but only one simultaneous writer. WAL can
  overlap readers with a writer; more pool connections do not create multiple
  SQLite writers.
- Plain `:memory:` and empty-name temporary databases are distinct per
  connection. This build omits shared cache, and SQLite discourages shared-cache
  mode. Permit them only with `connections: 1`; also detect SQLite URI
  `mode=memory` for the same validation.
- Open and run connection setup sequentially in the first implementation.
  This avoids racing database-persistent PRAGMAs such as `journal_mode` during
  pool construction. Parallel initialization can be measured later without an
  API change.
- `connectionSetup` is replayed per connection. `ATTACH`, `foreign_keys`,
  `busy_timeout`, and many other settings are connection-local even though some
  PRAGMAs, such as `journal_mode`, also affect persistent database state.

### Relationship to prior async work

Node.js PR #62015 and `doc/todo/P10-experimental-async-database.md` remain useful
for transport, teardown, async-context, row-shape, and terminal-step-error test
cases. Their public `Database`/`Statement` identity, per-connection microtask
batching, statement IDs, GC finalization, and FIFO statement executor are not
requirements here. Do not mechanically port the PR.

The older `doc/internal/async-design.md` recommendation for a separate package
also does not apply. A subpath in this package shares one SQLite amalgamation,
native prebuild matrix, error/value behavior, and release. A second npm package
would duplicate the binary or introduce a tightly coupled internal binding
package. Keep the stable root export unchanged instead.

## Preferred architecture

### TypeScript facade and scheduler

Add `src/experimental.ts` as the public subpath. `DatabasePool` owns a fixed
array of hidden native connection handles, an idle-slot queue, a pending-request
queue, and an explicit `open`/`closing`/`closed` state machine.

The scheduler leases an idle slot in request order and only then invokes its
native async execute method. A native job completion releases the slot and
schedules the next accepted request. A failure rejects that request without
breaking the scheduler. No raw native pointer or statement ID is visible to
JavaScript.

Do not add automatic batching. One public `run`/`get`/`all` call is one native
worker job; one explicit `batch` is one worker job containing all its operations.

### Native executor

Add first-party `src/async_pool_impl.{h,cpp}` and compile it from `binding.gyp`.
Do not modify `src/upstream/`.

- A hidden native connection wrapper holds a `std::shared_ptr<AsyncConnectionState>`.
  The state owns exactly one `sqlite3*`, policy/setup configuration, explicit
  lifecycle state, and the synchronization needed for teardown. It owns no
  persistent `sqlite3_stmt*` between requests.
- `AsyncRequest` and `AsyncResult` are C++17 tagged variants containing only
  owned native data. All statement prepare/bind/step/finalize operations occur
  in `AsyncRequestWorker::Execute()` on a libuv worker.
- `OnOK()`/`OnError()` run on the event-loop thread, create JavaScript rows and
  detailed errors, settle the internal promise, and release no SQLite object
  directly. Give work an async resource name such as
  `photostructure.sqlite.pool.request` and prove `AsyncLocalStorage` behavior.
- Every SQLite error path captures primary and extended codes, names, and
  messages before finalization or close can overwrite connection error state.
- The worker/state owns statement and connection lifetimes independently of GC.
  Close is a queued native operation after accepted work. Environment teardown
  must both prevent promise/reference access after JavaScript becomes
  unavailable and keep native state alive until in-flight SQLite calls finish
  and every handle closes. A synchronous `napi_add_env_cleanup_hook()` that
  merely flips a flag is not sufficient evidence; Task 1 must determine and
  prove the `napi_add_async_cleanup_hook()`/native completion coordination (or
  an equally safe Node-API 8 mechanism) before broader implementation.
- A defensive native busy invariant should fail visibly if the JavaScript
  scheduler ever submits concurrent jobs to one slot. Do not rely on this guard
  as the scheduler.

Expose hidden binding plumbing only as needed by `src/experimental.ts`. It must
not enlarge the documented or enumerable stable root surface.

## Alternatives rejected or deferred

### Fresh connection per operation

This provides the smallest native lifetime graph, but benchmark evidence shows
that repeated schema/cache/WAL setup, especially for writes, conflicts with the
throughput requirement. Retain it only as a benchmark control.

### Stateful async `Database` and `Statement`

This follows Node.js PR #62015 but requires connection and statement identity,
statement finalization ordering, GC retention, async iteration decisions, and a
transaction-affinity model. It solves a larger problem than requested and is
superseded by this plan.

### `worker_threads` pool around `DatabaseSync`

This is a useful correctness/control implementation because it reuses the sync
API, but every physical connection pays for a Node isolate and structured-clone
transport. Retain it as a benchmark fallback if the native lifetime spike fails;
do not ship it without evidence that its memory and throughput are preferable.

### Separate npm package

Rejected while the async surface shares this SQLite binary and release policy.
The experimental subpath provides API isolation without duplicating prebuilds or
creating a version-locked core package.

### Dedicated `std::thread` per connection

Deferred. One owned thread per slot with its own request queue (completion via
`Napi::ThreadSafeFunction`) would isolate the pool from libuv thread-pool
contention and make exclusive `sqlite3*` ownership structural. But TSFN
teardown adds exactly the lifetime complexity this codebase has been burned by
before, while `Napi::AsyncWorker` is the closest local baseline and avoids a
second callback/queue mechanism. Task 1, not `BackupJob`, proves whether its
teardown semantics are sufficient for pool-owned handles.
Because waiting requests queue in JavaScript and only leased slots submit
native work, the executor can be swapped later without any API change. Revisit
only if benchmarks show libuv pool contention actually harms the workload.

### Persistent prepared-statement cache

Deferred. It reintroduces per-connection lifetime and schema-invalidation state.
Measure prepare cost after the uncached implementation meets correctness gates.
The benchmark must include a repeated-identical-SQL case so this decision is
made on evidence: the motivating consumer's query layer caches prepared
statements today, and the pool must show acceptable throughput without one.

## Tasks

### Do not blindly follow this section

These tasks capture the best route known at planning time. Revise this TPP when
tests or measurements invalidate an assumption. Prefer the smallest design that
passes the frozen contract; do not preserve planned abstractions merely because
they appear below.

### Task 0: Freeze the contract and baseline

**Success**: focused tests describe the agreed public API and fail only because
the experimental pool does not exist; the plan records enough starting state to
avoid overwriting or staging unrelated worktree changes.

1. Record `git rev-parse HEAD`, `git status --short`, and the pre-existing diffs
   in files the feature will touch. The current planning tree is already dirty,
   including first-party and `src/upstream/` files; never stage the whole file or
   assume an existing diff belongs to this feature.
2. Add focused tests under `test/async-pool-*.test.ts` for the API shown above,
   lifecycle, ordering, values/rows, setup/policy, transactions, and invalid
   multi-connection in-memory locations.
3. Pin `authorizer: "strict" | "none"` with strict as the default; fixed
   `connections` with one as the default; immutable `readBigInts` and
   `returnArrays` result policies; `{ sql, params? }` connection setup with
   `allowExtension`-guarded extension loading; and
   `run`/`get`/`all`/`batch`/close only. Pin the accepted location types and
   default named-binding policy as well. Except for the tests that pin the
   authorizer default itself, contract tests pass `authorizer` explicitly so
   the strict implementation can land after the scheduler without blocking
   earlier tasks.
4. Add API-surface assertions proving the stable root exports are unchanged and
   `DatabasePool` exists only under the experimental subpath.
5. Add a focused benchmark entry that can compare warm sync, fresh sync,
   one-slot async, multi-slot async, strict/none, and explicit batch sizes. Do
   not turn throughput observations into functional-test timing assertions.

**Proof**:

- [ ] Focused tests fail for the missing implementation:
      `npm run test:serial -- test/async-pool-*.test.ts`
- [ ] Starting SHA and overlapping worktree state are recorded in this TPP
- [ ] No implementation file has changed in this task

### Task 1: Prove one-slot execution and ownership

**Success**: one asynchronously opened connection can execute and close without
blocking the event loop, leaking, hanging, touching Node-API off-thread, or
depending on JavaScript object reachability.

1. Add `src/async_pool_impl.{h,cpp}` with owned connection state and the smallest
   no-row operation needed to prove open, execute, and close.
2. Start with one `Napi::AsyncWorker` per public call. Do not add the full pool,
   value matrix, batching, authorizer, statement cache, or automatic batching.
3. Hold connection state with explicit shared ownership through in-flight work.
   Add environment cleanup and dropped-reference tests before adding more SQL
   behavior. Prototype abrupt teardown with Node-API 8 asynchronous cleanup
   coordination; do not infer safety from `BackupJob`'s synchronous cleanup
   hook. Use a long-running statement to prove any teardown-only
   `sqlite3_interrupt()` path owns the handle until the cross-thread call and
   worker exit are complete.
4. Verify a long recursive SQLite operation leaves a deterministic event-loop
   heartbeat responsive. Verify `AsyncLocalStorage` and `async_hooks` observe the
   named native resource on success and rejection.
5. Exercise abrupt `worker_threads` environment termination using the existing
   worker-test patterns. Cover both a worker still queued behind deliberately
   occupied libuv threads and one already executing SQLite. No arbitrary sleeps
   or forced GC may be required for correctness.

**Go/no-go gate**:

- [ ] Focused executor/lifecycle tests pass in a repeated stress loop
- [ ] ASan/UBSan/LSan and Valgrind report no first-party defect
- [ ] Scope review finds no Node-API handles in worker-side transport/state
- [ ] Abrupt environment teardown cannot close a `sqlite3*` concurrently with
      `Execute()` and does not finish until all pool-owned native handles close
- [ ] No stable root behavior or `src/upstream/` file changed

Stop and revise this TPP if safe teardown requires process-global connection
state, detached threads, or a persistent statement/object graph.

### Task 2: Add transport-safe `run`, `get`, and `all`

**Success**: individual operations match the frozen parameter, result, and error
contract while owning no SQLite statement across calls.

1. Implement C++17 owned variants for null, int64, double, UTF-8 text, blobs,
   ordered rows, run metadata, and detailed errors.
2. Convert/copy JavaScript inputs before queueing. Prepare, bind, step, and
   finalize entirely in `Execute()`. Construct all JavaScript outputs only in
   completion callbacks.
3. Reject a second executable statement by repeatedly asking SQLite to prepare
   the tail until either no statement or a second statement appears; do not
   parse SQL comments manually.
4. Preserve ArrayBufferView byte ranges, null prototypes, array mode, column
   order, duplicate-column last-wins behavior, terminal step errors, and the
   synchronous API's safe-integer policy where equivalent.
5. Normalize `run` metadata per operation as defined in the contract. Test an
   INSERT followed by zero-row DML, SELECT, and DDL on the same connection so
   none of them inherits the prior `changes`; assert that no
   `lastInsertRowid` field exists. Repeat across batch operations in Task 4 and
   multiple slots in Task 5.
6. Always finalize the statement and verify autocommit before releasing the
   slot. Test an error after at least one emitted row.

**Proof**:

- [ ] `npm run test:serial -- test/async-pool-values.test.ts`
- [ ] `npm run test:serial -- test/async-pool-errors.test.ts`
- [ ] Scope searches show no `Napi::`/`napi_` value stored in worker-side
      request/result types

### Task 3: Add one-connection setup and extension loading

**Success**: setup statements and native extensions configure the one-slot
executor successfully; the connection enforces statement-finalization and
autocommit invariants. Task 5 proves identical replay after the
multi-connection scheduler exists. No authorizer work happens in this task.

1. Open the connection and execute setup statements sequentially off-thread. If
   setup fails or leaves autocommit off, close the connection and reject
   `open()`.
2. Implement setup `params` binding, reusing the parameter conversion seam
   from Task 2.
3. When `allowExtension` is set, enable extension loading (including the SQL
   `load_extension()` function, via `sqlite3_enable_load_extension()`) only
   while setup statements run, and revoke it before the connection is
   admitted. Use failure-path cleanup that either proves loading was revoked or
   closes the connection; never admit a connection after revocation fails.
   Verify `load_extension()` fails in post-setup user SQL under `none`; Task 6
   repeats the assertion under `strict`. Test the explicit entrypoint form
   (`SELECT load_extension(?, ?)`) and a load failure rejecting `open()`.
4. On leaked transaction state, roll back, reject, and discard a connection
   whose clean state cannot be established. Fail the pool rather than silently
   returning a poisoned slot or reducing its fixed size.
5. Use `test/fixtures/test-extension` for the real extension proof. A fixture
   build failure must fail this focused suite rather than conditionally skip the
   behavior.

**Proof**:

- [ ] `npm run test:serial -- test/async-pool-setup.test.ts`
- [ ] Extension tests pass with a real loadable extension on every CI platform
- [ ] `load_extension()` is proven unavailable after setup completes

### Task 4: Add explicit batches and transactions

**Success**: one batch is one leased connection and one native job; operation
results remain ordered; transactional failure always rolls back; no JavaScript
callback executes inside a transaction.

1. Add run/get/all operation descriptors and ordered result variants.
2. Implement no-transaction and deferred/immediate/exclusive modes. Internal
   transaction control is executor-owned; its interplay with the strict
   authorizer (the trusted flag) is added and tested in the strict task.
3. Finalize each statement before the next operation. Treat every terminal
   result other than `SQLITE_DONE` as an error.
4. Apply the operation-local `run` metadata baseline separately to each run
   descriptor so earlier operations in the same batch cannot leak metadata.
5. Define and test fail-fast behavior for a non-transactional batch and complete
   rollback for a transactional batch.
6. Add explicit-batch throughput cases before considering automatic batching.

**Proof**:

- [ ] `npm run test:serial -- test/async-pool-batch.test.ts`
- [ ] Transaction tests prove commit and rollback from a separate connection
- [ ] No public transaction callback or connection handle exists in types or
      runtime surface

### Task 5: Add the fixed multi-connection scheduler and close state machine

**Success**: waiting requests consume no libuv worker, each slot has at most one
in-flight job, different connections can overlap, failures do not stall the
queue, and close drains accepted work exactly once.

1. Implement the TypeScript idle-slot and request queues with explicit open,
   closing, and closed states. Queue native work only after leasing a slot.
2. Preserve request assignment fairness without promising cross-connection
   completion order. Test awaited ordering and document concurrent ordering as
   unspecified.
3. Reject plain `:memory:`, empty temporary names, and URI `mode=memory` when
   `connections > 1`; permit them with one connection.
4. Prove setup replay across every slot with concurrent operations that require
   the configured attachment/PRAGMA/extension; avoid a test-only public slot ID.
   A later-slot open/setup failure must close every earlier slot before
   `open()` rejects.
5. Make close reject new work immediately, drain accepted queued/in-flight
   requests, close slots, and settle repeated close/async-dispose calls
   idempotently.
6. Stress errors, dropped promises/references, GC, queue bursts, worker
   termination, and concurrent close. Use condition-based synchronization, not
   sleeps.

**Proof**:

- [ ] `npm run test:serial -- test/async-pool-concurrency.test.ts test/async-pool-lifecycle.test.ts`
- [ ] Stress loop completes without unresolved promises or open handles
- [ ] Native busy invariant is never reached in normal tests
- [ ] Memory tools report no first-party leak/use-after-free

### Task 6: Add the `strict` authorizer

**Success**: strict rejects connection-affine SQL; none omits the restrictive
authorizer entirely; internal transaction control still works under strict.

This lands after the scheduler deliberately: every earlier task runs with
explicit `authorizer: "none"`, so a working, benchmarkable pool exists before
the largest piece of novel native policy code. Everything before this task is a
coherent trusted-SQL implementation for development and measurement, but it is
not the frozen public MVP: do not publish the default-`strict` contract until
this task passes.

1. Install the pure native strict authorizer only after setup and extension
   loading. Cover every denied action/function listed in the contract,
   including automatic re-prepare during `sqlite3_step()`. Repeat the
   post-setup `load_extension()` denial proof under strict.
2. In none mode, do not install a permit-all callback: avoid its preparation
   cost entirely. Retain structural/autocommit checks.
3. Add the executor-owned trusted flag so internal `BEGIN`/`COMMIT`/`ROLLBACK`
   from `batch` pass while user transaction control is denied. Scope the flag
   to each internal statement, clear it before user SQL prepare/step, and test
   user transaction control in every position of a strict batch.
4. Benchmark strict and none separately. Keep the public option even if the
   measured strict cost is small.

**Proof**:

- [ ] `npm run test:serial -- test/async-pool-policy.test.ts`
- [ ] A strict-mode scope test covers every intended SQLite authorizer action
- [ ] None-mode benchmark path confirms no authorizer callback is installed
- [ ] Throw/exception review confirms no C++ exception crosses the C callback

### Task 7: Package the experimental subpath

**Success**: CJS and ESM consumers load `DatabasePool` and its declarations from
the experimental subpath while the stable root's runtime, type, and enumerable
surface remains unchanged.

1. Add `src/experimental.ts` as a second `tsup` entry.
2. Add conditional CommonJS/ESM/type exports for `./experimental` and teach
   `scripts/post-build.mjs` to create the corresponding `.d.cts` file.
3. Keep hidden native constructors/functions undocumented and non-enumerable
   where practical.
4. Add CJS, ESM, declarations, illegal-constructor, and async-dispose loading
   checks on the Node 22 floor.

**Proof**:

- [ ] `npm run build:dist`
- [ ] CJS and ESM experimental import checks pass
- [ ] Stable root API-surface and `npm run test:api` tests pass unchanged

### Task 8: Benchmark and document operational tradeoffs

**Success**: maintainers can reproduce throughput and responsiveness evidence,
and users can tell exactly when the pool API is unsuitable.

1. Benchmark warm sync, fresh sync, strict/none async, one/two/four connections,
   individual calls, explicit batch sizes, result sizes, read/write mixes,
   repeated identical SQL (to quantify per-call prepare cost against a future
   statement cache), and a `worker_threads` sync control.
2. Run with libuv's default pool and one larger startup-time
   `UV_THREADPOOL_SIZE`. Record that the libuv pool is global and shared; add a
   representative competing filesystem or crypto workload, and do not mutate
   the pool size from library code.
3. Confirm multiple simple operations per millisecond on reference hardware and
   record environment plus raw benchmark output. Use relative comparisons and
   repeated samples; never fail CI on wall-clock throughput.
4. Verify the synchronous API has no measurable regression outside combined
   measurement noise.
5. Document setup replay, authorizer modes, explicit ordering, one-writer
   reality (writes on a warm pool contend via `busy_timeout` on a worker
   thread, never the event loop), extension setup constraints, full-result
   memory/main-thread conversion, in-memory restrictions, close requirements,
   and omitted stateful features.
   For libuv contention, give concrete guidance: idle SQLite connections use no
   libuv worker, but each concurrently submitted pool operation competes for
   the process-global threads. More busy slots than `UV_THREADPOOL_SIZE`
   (default 4) do not create more simultaneous SQLite execution and can delay
   unrelated thread-pool work. Applications should size connections and, only
   after measurement, set a larger `UV_THREADPOOL_SIZE` before startup; the
   library never mutates it.

**Proof**:

- [ ] Focused benchmark command and raw result location are documented
- [ ] Event-loop responsiveness has a deterministic functional test
- [ ] Documentation includes examples for strict, none, setup, ordered awaits,
      batches, transactions, and shutdown

### Task 9: Full integration and native-resource review

**Success**: every validation gate passes from a clean feature diff, limitations
are explicit, and an independent reviewer can trace every connection, request,
statement, promise, and environment-teardown ownership edge.

Re-read this TPP, remove obsolete scaffolding, record lasting lore, and move the
completed plan to `doc/done/` using the project naming convention.

## Validation

- [ ] Focused: `npm run test:serial -- test/async-pool-*.test.ts`
- [ ] Build: `npm run build`
- [ ] Types/lint: `npm run lint`
- [ ] Full CJS and ESM: `npm run test:all`
- [ ] Stable API compatibility: `npm run test:api`
- [ ] Node compatibility: `npm run test:node`
- [ ] Memory/UB: `npm run memory:asan`
- [ ] Independent memory check: `npm run memory:valgrind`
- [ ] Alpine: `npm run test:docker:alpine`
- [ ] CI: existing Linux, macOS, Windows, x64, arm64, and Node-version matrix
- [ ] Benchmark evidence recorded without functional-test timing assertions
- [ ] Stable root runtime/type/enumerable surface unchanged
- [ ] No feature edits under `src/upstream/`; pre-existing worktree changes are
      preserved and excluded from this feature's staging

## Definition of complete

The feature is complete only when SQLite work is demonstrably off the event
loop; every accepted operation resolves or rejects; a pool slot can never be
used concurrently or returned with unproven transaction state; setup and strict
policy block the documented sources of accidental connection affinity; none
mode removes the authorizer while clearly assigning state discipline to the
caller; disposal and environment teardown are safe; the stable sync API is
untouched; and benchmark evidence shows the warm design meets the requested
throughput class.
