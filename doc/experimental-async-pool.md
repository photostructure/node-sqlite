# Experimental async database pool

`@photostructure/sqlite/experimental` provides a fixed-size pool of warm SQLite
connections. Database open, prepare, bind, step, finalize, setup, and close work
runs on libuv worker threads rather than on the JavaScript event-loop thread.

The API is experimental. Its compatibility policy is separate from the stable
`@photostructure/sqlite` entry point: the pool may change as production usage
and benchmarks reveal better semantics. Importing the stable entry point does
not expose `DatabasePool` or change its runtime and TypeScript API.

## Quick start

```typescript
import { DatabasePool } from "@photostructure/sqlite/experimental";

await using pool = await DatabasePool.open("app.db", {
  connections: 2,
  // "strict" is the default. It prevents user SQL from depending on which
  // physical connection the pool leases.
  authorizer: "strict",
  connectionSetup: [
    { sql: "PRAGMA journal_mode=WAL" },
    { sql: "PRAGMA foreign_keys=ON" },
    { sql: "PRAGMA busy_timeout=5000" },
  ],
});

await pool.run(
  "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT)",
);
await pool.run("INSERT INTO users(name) VALUES (?)", ["Ada"]);

const user = await pool.get("SELECT * FROM users WHERE id = ?", [1]);
const users = await pool.all("SELECT * FROM users ORDER BY id");
```

CommonJS consumers use the same subpath:

```javascript
const { DatabasePool } = require("@photostructure/sqlite/experimental");
```

`DatabasePool.open()` accepts a string, `Buffer`, or `URL` location. The pool
has one connection by default. Each `run()`, `get()`, and `all()` call accepts
exactly one executable SQL statement and an optional parameter array or named
parameter object.

## Strict and none authorizers

The `authorizer` option controls whether user SQL may create connection-local
state:

| Mode                 | Use it when                                                              | Behavior                                                                            |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `"strict"` (default) | Calls may be leased to any pool connection                               | Allows ordinary main-schema reads and writes, while rejecting connection-affine SQL |
| `"none"`             | All SQL is trusted and the application accepts connection-affinity risks | Installs no persistent restrictive authorizer                                       |

Strict mode rejects user `PRAGMA`, `ATTACH`/`DETACH`, transaction and savepoint
control, temp-schema mutation, extension loading, and connection-observing
functions such as `last_insert_rowid()`, `changes()`, and `total_changes()`.
Use `connectionSetup` for required PRAGMAs and attachments, and use
`batch(..., { transaction: ... })` for transactions.

Strict mode is a pool-consistency policy, not a read-only mode or a sandbox for
untrusted SQL. It permits ordinary writes, does not impose SQLite resource
limits, and cannot make arbitrary native-extension functions
connection-independent.

None mode permits SQL such as PRAGMAs, attachments, and connection-observing
functions after open. Such state can differ across physical connections, so a
later call may observe a different value. A batch deliberately stays on one
connection, but separate calls must not rely on connection-local state.

Both modes still require one executable statement per operation, finalize every
statement, and restore autocommit before returning a connection to the pool.
To enforce that structural rule without allowing a rejected multi-statement
PRAGMA to mutate the connection during SQLite's prepare phase, both modes use a
short-lived validation callback while scanning the SQL tail. In none mode the
accepted statement is then prepared and executed with no authorizer installed.

## Connection setup and extensions

`connectionSetup` is an ordered list of `{ sql, params? }` operations. The pool
runs the complete list once on every physical connection before `open()`
resolves:

```typescript
const pool = await DatabasePool.open("app.db", {
  connections: 2,
  authorizer: "strict",
  allowExtension: true,
  connectionSetup: [
    { sql: "PRAGMA journal_mode=WAL" },
    { sql: "PRAGMA busy_timeout=5000" },
    {
      sql: "SELECT load_extension(?, ?)",
      params: [extensionPath, "sqlite3_myextension_init"],
    },
    { sql: "ATTACH DATABASE ? AS analytics", params: [analyticsPath] },
  ],
});
```

Setup must be safe to replay independently on each connection. Use it for
connection configuration, not schema migrations. Run migrations before opening
the pool, using ordinary SQL or `DatabaseSync` when a migration needs a
JavaScript-defined SQL function.

`allowExtension` defaults to false. When true, SQL extension loading is enabled
only while setup runs and is revoked before the connection is admitted to the
pool. A setup or extension-load failure rejects `open()` and closes every
connection opened so far. User operations cannot call `load_extension()` in
either authorizer mode.

## Ordering, concurrency, and batches

Await one operation before issuing the next when application order matters:

```typescript
await pool.run("INSERT INTO jobs(id, state) VALUES (?, ?)", [1, "queued"]);
await pool.run("UPDATE jobs SET state = ? WHERE id = ?", ["ready", 1]);
const job = await pool.get("SELECT * FROM jobs WHERE id = ?", [1]);
```

Calls submitted concurrently may run and complete in different orders on
different connections. The pool does not manufacture cross-connection
completion order.

`batch()` executes all descriptors sequentially in one worker job on one leased
connection. All SQL and parameters must be known when `batch()` is called:

```typescript
const results = await pool.batch(
  [
    {
      kind: "run",
      sql: "UPDATE account SET balance = balance - ? WHERE id = ?",
      params: [10, 1],
    },
    {
      kind: "run",
      sql: "UPDATE account SET balance = balance + ? WHERE id = ?",
      params: [10, 2],
    },
    {
      kind: "get",
      sql: "SELECT balance FROM account WHERE id = ?",
      params: [2],
    },
  ],
  { transaction: "immediate" },
);
```

Transaction modes are `deferred`, `immediate`, and `exclusive`. A transactional
error rolls back and rejects the whole batch. A batch without `transaction` is
fail-fast, but earlier successful operations may already have committed. Batch
results preserve descriptor order.

## Values and results

Bind values may be `null`, number, bigint, string, or an `ArrayBufferView`.
Views are copied when the request is submitted, including only the view's byte
range. Named objects accept the synchronous API's default bare-name behavior.

- `run()` returns `{ changes }`. It intentionally has no `lastInsertRowid`
  because that value is connection history and is ambiguous in a pool. Use
  `INSERT ... RETURNING` with `get()` or `all()` when generated values matter.
- `get()` returns the first row or `undefined`.
- `all()` returns all rows.
- Rows are null-prototype objects by default. `returnArrays: true` returns
  arrays instead.
- `readBigInts: true` returns SQLite integers as bigint. With the default false,
  unsafe integers reject instead of silently losing precision.

`all()` materializes the complete native result before creating JavaScript
objects on the event-loop thread. A large query can therefore have a high peak
native-plus-JavaScript memory footprint, and converting a very large result can
still pause JavaScript even though SQLite execution itself is off-thread. The
MVP does not provide streaming or incremental iteration.

## SQLite and libuv limits

Multiple connections allow reads to overlap, but SQLite still permits only one
writer at a time. WAL can overlap readers with a writer; it does not create
multiple simultaneous writers. Configure a suitable `busy_timeout` in setup so
write contention waits on a worker thread rather than blocking the event loop.

SQLite's threading mode is not a database-concurrency setting. It controls
threads sharing one connection handle; WAL and file locks control connections
and processes sharing one database.

| Mechanism   | What it controls                                   | Cost or risk                                              |
| ----------- | -------------------------------------------------- | --------------------------------------------------------- |
| `FULLMUTEX` | Concurrent threads entering the same `sqlite3*`    | Small mutex overhead; protects against ownership mistakes |
| `NOMUTEX`   | The application must serialize each `sqlite3*`     | Less overhead; overlapping use of one handle is unsafe    |
| WAL/locks   | Different handles and processes using one database | Governs PhotoStructure's actual web/sync concurrency      |

This pool currently uses `FULLMUTEX` as defense in depth. Its scheduler still
runs different handles concurrently, and `FULLMUTEX` does not serialize another
process. See the [longer build-flag rationale](build-flags.md#sqlite-threading-modes-and-process-concurrency)
for the compile-time choices.

For PhotoStructure:

- The read-heavy web process can use a two-connection pool. `FULLMUTEX` does not
  prevent those handles from reading concurrently.
- In WAL mode, web readers can normally overlap the sync writer.
- Sync still has only one writer, regardless of its connection count.
- Configure `busy_timeout` on every connection; unlike WAL mode, it is
  connection-local.
- A second sync connection might help incremental reads, but it can also add
  cache, libuv-thread, and lock contention. Measure the complete workload.

Plain `:memory:`, empty temporary locations, and SQLite URI locations with
`mode=memory` are private to one connection in this build. They require
`connections: 1`. Use an on-disk database for a multi-connection pool.

Active pool operations use Node's process-global libuv thread pool, which is
also shared with filesystem, DNS, crypto, and zlib work. Requests waiting for a
SQLite connection stay in JavaScript and consume no libuv worker, and idle
connections consume no worker. However, more busy pool slots than
`UV_THREADPOOL_SIZE` (four by default) do not create more simultaneous SQLite
execution and can delay unrelated thread-pool work.

Size both the connection pool and libuv pool from measurements of the complete
application. If a larger libuv pool helps, set `UV_THREADPOOL_SIZE` before the
process starts. This package never mutates it.

## Closing the pool

`close()` and `Symbol.asyncDispose` are idempotent. Closing begins immediately:
new work is rejected, already accepted queued and in-flight work drains, and
then each physical connection closes exactly once.

Abrupt `worker_threads` termination also drains Node-API work before the
environment cleanup hook can close connections. This preserves handle safety,
but it means termination can wait for a long-running SQLite statement; SQLite
cannot forcibly bound arbitrary trusted SQL or native extension functions.

Prefer explicit resource management:

```typescript
await using pool = await DatabasePool.open("app.db");
// The pool closes when this scope exits, including on an exception.
```

Without `await using`, always use `try`/`finally`:

```typescript
const pool = await DatabasePool.open("app.db");
try {
  await pool.get("SELECT 1 AS ready");
} finally {
  await pool.close();
}
```

## Deliberately omitted

The pool exposes only connection-independent `run`, `get`, `all`, and `batch`
operations. It does not expose prepared-statement handles, iteration, streams,
JavaScript transaction callbacks, user functions or aggregates, sessions,
changesets, backup, serialization, runtime extension loading, cancellation, or
conversion between pooled and synchronous connections. Keep using
`DatabaseSync` when a workload needs those stateful capabilities.

See the [benchmark guide](../benchmark/README.md#experimental-async-pool) for
commands that measure warm/fresh connections, pool size, authorizer overhead,
batching, event-loop responsiveness, and libuv-pool sizing on your hardware.
