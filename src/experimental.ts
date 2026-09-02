import nodeGypBuild from "node-gyp-build";
import { join } from "node:path";
import { _dirname } from "./dirname";

/**
 * Controls whether user SQL may create connection-local state.
 *
 * - `"strict"` rejects SQL whose effect depends on which physical connection
 *   the pool happens to lease: `PRAGMA`, `ATTACH`/`DETACH`, transaction and
 *   savepoint control, temp-schema mutation, extension loading, and the
 *   connection-observing functions `last_insert_rowid()`, `changes()`, and
 *   `total_changes()`. Ordinary main-schema reads and writes are allowed.
 * - `"none"` installs no persistent authorizer. SQL may then create state that
 *   differs across connections, so a later call can observe a different value.
 *
 * Strict mode is a pool-consistency policy. It is not a read-only mode, it
 * imposes no SQLite resource limits, and it is not a sandbox for untrusted SQL.
 *
 * Both modes still require exactly one executable statement per operation.
 *
 * @see {@link DatabasePoolOptions.connectionSetup} for required PRAGMAs and
 * attachments, and {@link DatabasePool.batch} for transactions.
 */
export type PoolAuthorizer = "strict" | "none";

/**
 * Locking behavior for a {@link DatabasePool.batch} transaction, corresponding
 * to SQLite's `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, and `BEGIN EXCLUSIVE`.
 */
export type PoolTransaction = "deferred" | "immediate" | "exclusive";

/**
 * A value that can be bound to a SQL parameter.
 *
 * JavaScript numbers bind as SQLite REAL and bigints as INTEGER, matching
 * `node:sqlite`. An `ArrayBufferView` binds as a BLOB: only the view's own byte
 * range is copied, and the copy is taken when the call is made, so mutating the
 * backing buffer afterwards does not affect the query.
 */
export type PoolValue =
  null | number | bigint | string | ArrayBufferView<ArrayBufferLike>;

/**
 * Bind parameters for one operation: an array for positional placeholders, or a
 * plain object for named placeholders. Named keys may omit the `:`, `$`, or `@`
 * prefix, matching the synchronous API's bare-name behavior.
 */
export type PoolParams =
  readonly PoolValue[] | Readonly<Record<string, PoolValue>>;

/**
 * One statement replayed on every physical connection before
 * {@link DatabasePool.open} resolves.
 */
export interface PoolSetupOperation {
  /** Exactly one executable SQL statement. */
  readonly sql: string;
  readonly params?: PoolParams;
}

/** Options for {@link DatabasePool.open}. */
export interface DatabasePoolOptions {
  /**
   * Number of physical SQLite connections to open. Multiple connections let
   * reads overlap, but SQLite still permits only one writer at a time.
   *
   * In-memory and temporary databases are private to one connection, so
   * `:memory:`, an empty location, and URI locations with `mode=memory` require
   * exactly one.
   *
   * @default 1
   */
  readonly connections?: number;
  /**
   * Whether user SQL may create connection-local state.
   * @default "strict"
   */
  readonly authorizer?: PoolAuthorizer;
  /**
   * If true, return SQLite integers as `bigint`. With the default `false`, an
   * integer outside the safe JavaScript range rejects the call rather than
   * silently losing precision.
   *
   * @default false
   */
  readonly readBigInts?: boolean;
  /**
   * If true, return each row as an array of values instead of an object. Arrays
   * preserve every column of a result that contains duplicate column names.
   *
   * @default false
   */
  readonly returnArrays?: boolean;
  /**
   * If true, enable SQL extension loading for the duration of
   * {@link connectionSetup} only; it is revoked before the connection is
   * admitted to the pool. User operations can never call `load_extension()` in
   * either authorizer mode.
   *
   * @default false
   */
  readonly allowExtension?: boolean;
  /**
   * Ordered statements run on every physical connection before `open()`
   * resolves. Each must be safe to replay independently per connection, so use
   * it for connection configuration rather than schema migrations. A failure
   * rejects `open()` and closes every connection opened so far.
   *
   * @default []
   */
  readonly connectionSetup?: readonly PoolSetupOperation[];
}

/** A batch operation that discards rows and yields a {@link PoolRunResult}. */
export interface PoolRunOperation extends PoolSetupOperation {
  readonly kind: "run";
}

/** A batch operation that yields the first row, or `undefined` when there is none. */
export interface PoolGetOperation extends PoolSetupOperation {
  readonly kind: "get";
}

/** A batch operation that yields every row. */
export interface PoolAllOperation extends PoolSetupOperation {
  readonly kind: "all";
}

/** One entry in a {@link DatabasePool.batch} descriptor list. */
export type PoolOperation =
  PoolRunOperation | PoolGetOperation | PoolAllOperation;

/** Options for {@link DatabasePool.batch}. */
export interface PoolBatchOptions {
  /**
   * Wrap the batch in a transaction with the given locking behavior. Any error
   * rolls the whole batch back and rejects.
   *
   * Without this, the batch is fail-fast: it stops at the first error, but
   * earlier operations may already have committed. Omitting it also leaves each
   * statement in its own implicit transaction, so two reads in one batch can
   * observe different snapshots if another connection commits in between.
   */
  readonly transaction?: PoolTransaction;
}

/** The result of a `run` operation. */
export interface PoolRunResult {
  /**
   * Rows changed by the statement, or `0` when it changed none.
   *
   * A `bigint` when {@link DatabasePoolOptions.readBigInts} is set.
   */
  readonly changes: number | bigint;
  // No lastInsertRowid: that value is per-connection history and is ambiguous
  // in a pool. Use INSERT ... RETURNING with get() or all() instead.
}

/** A row keyed by column name. Rows are created with a null prototype. */
export type PoolObjectRow = Record<string, PoolValue>;
/** A row as positional column values, used when `returnArrays` is set. */
export type PoolArrayRow = PoolValue[];
/** One result row, shaped by {@link DatabasePoolOptions.returnArrays}. */
export type PoolRow = PoolObjectRow | PoolArrayRow;
/** The result of one {@link PoolOperation}, by its `kind`. */
export type PoolOperationResult =
  PoolRunResult | PoolRow | PoolRow[] | undefined;

type NativeParams = PoolValue[] | Record<string, PoolValue>;

interface NativeOperation {
  kind: "run" | "get" | "all";
  sql: string;
  params?: NativeParams;
}

interface NativeConnection {
  execute(request: {
    operations: NativeOperation[];
    transaction?: PoolTransaction;
  }): Promise<PoolOperationResult[]>;
  close(): Promise<void>;
}

interface NativeBinding {
  _openAsyncPoolConnection(
    location: string | Buffer | URL,
    options: {
      readBigInts: boolean;
      returnArrays: boolean;
      authorizer: PoolAuthorizer;
      allowExtension: boolean;
      connectionSetup: NativeOperation[];
    },
  ): Promise<NativeConnection>;
}

interface NormalizedOptions {
  connections: number;
  authorizer: PoolAuthorizer;
  readBigInts: boolean;
  returnArrays: boolean;
  allowExtension: boolean;
  connectionSetup: NativeOperation[];
}

interface PendingRequest<T> {
  execute(connection: NativeConnection): Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

type PoolState = "open" | "closing" | "closed" | "failed";

const binding = nodeGypBuild(join(_dirname(), "..")) as NativeBinding;
const constructorToken = Symbol("DatabasePool constructor token");

function invalidArgument(message: string): TypeError {
  const error = new TypeError(message);
  (error as NodeJS.ErrnoException).code = "ERR_INVALID_ARG_TYPE";
  return error;
}

function snapshotLocation(
  location: string | Buffer | URL,
): string | Buffer | URL {
  if (typeof location === "string") {
    if (location.includes("\0")) {
      throw invalidArgument(
        'The "location" argument must not contain null bytes.',
      );
    }
    return location;
  }
  if (Buffer.isBuffer(location)) {
    if (location.includes(0)) {
      throw invalidArgument(
        'The "location" argument must not contain null bytes.',
      );
    }
    return Buffer.from(location);
  }
  if (location instanceof URL) return new URL(location.href);
  throw invalidArgument(
    'The "location" argument must be a string, Buffer, or URL.',
  );
}

function locationText(location: string | Buffer | URL): string {
  if (typeof location === "string") return location;
  if (Buffer.isBuffer(location)) return location.toString();
  return location.href;
}

function isPrivateMemoryLocation(location: string | Buffer | URL): boolean {
  const text = locationText(location);
  if (text === "" || text === ":memory:") return true;
  if (!text.startsWith("file:")) return false;
  const queryStart = text.indexOf("?");
  const filePath = text.slice(0, queryStart === -1 ? text.length : queryStart);
  if (filePath === "file:") return true;
  if (
    text.toLowerCase() === "file::memory:" ||
    /^file::memory:\?/i.test(text)
  ) {
    return true;
  }
  try {
    const query = text.includes("?") ? text.slice(text.indexOf("?")) : "";
    return new URLSearchParams(query).get("mode")?.toLowerCase() === "memory";
  } catch {
    return /[?&]mode=memory(?:&|$)/i.test(text);
  }
}

function snapshotValue(value: unknown, label: string): PoolValue {
  // Keep the null branch separate: the benchmark package intentionally checks
  // this source with strictNullChecks disabled, where a compound null/typeof
  // guard does not reliably narrow `unknown` to PoolValue.
  if (value === null) return null;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  throw invalidArgument(
    `The ${label} bind parameter must be null, a number, bigint, string, or ArrayBufferView.`,
  );
}

function snapshotParams(
  params: unknown,
  label: string,
): NativeParams | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) {
    return params.map((value, index) =>
      snapshotValue(value, `${label}[${index}]`),
    );
  }
  if (
    params === null ||
    typeof params !== "object" ||
    ArrayBuffer.isView(params)
  ) {
    throw invalidArgument(
      `The ${label} parameters must be an array or object.`,
    );
  }
  const prototype = Object.getPrototypeOf(params);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidArgument(`The ${label} parameters must be a plain object.`);
  }
  const copied: Record<string, PoolValue> = Object.create(null);
  for (const [key, value] of Object.entries(params)) {
    Object.defineProperty(copied, key, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(value, `${label}.${key}`),
      writable: true,
    });
  }
  return copied;
}

function snapshotOperation(
  operation: unknown,
  index: number,
  setup: boolean,
): NativeOperation {
  if (
    operation === null ||
    typeof operation !== "object" ||
    Array.isArray(operation)
  ) {
    throw invalidArgument(
      `${setup ? "connectionSetup entry" : "operation descriptor"} ${index} must be an object.`,
    );
  }
  const candidate = operation as Record<string, unknown>;
  const kind = setup ? "run" : candidate["kind"];
  if (kind !== "run" && kind !== "get" && kind !== "all") {
    throw invalidArgument(
      `The operation descriptor ${index} kind must be "run", "get", or "all".`,
    );
  }
  if (typeof candidate["sql"] !== "string") {
    throw invalidArgument(
      `The ${setup ? "connectionSetup entry" : "operation descriptor"} ${index} sql must be a string.`,
    );
  }
  const params = snapshotParams(candidate["params"], `operation ${index}`);
  const copied: NativeOperation = {
    kind,
    sql: candidate["sql"],
  };
  if (params !== undefined) copied.params = params;
  return copied;
}

function booleanOption(
  value: unknown,
  name: string,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw invalidArgument(`The "options.${name}" argument must be a boolean.`);
  }
  return value;
}

function normalizeOptions(options: unknown): NormalizedOptions {
  if (options === undefined) options = {};
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw invalidArgument('The "options" argument must be an object.');
  }
  const input = options as Record<string, unknown>;
  const allowed = new Set([
    "connections",
    "authorizer",
    "readBigInts",
    "returnArrays",
    "allowExtension",
    "connectionSetup",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw invalidArgument(`Unknown DatabasePool option "${key}".`);
    }
  }

  const connections =
    input["connections"] === undefined ? 1 : input["connections"];
  if (!Number.isSafeInteger(connections) || (connections as number) <= 0) {
    throw invalidArgument(
      'The "options.connections" argument must be a positive safe integer.',
    );
  }
  const authorizer =
    input["authorizer"] === undefined ? "strict" : input["authorizer"];
  if (authorizer !== "strict" && authorizer !== "none") {
    throw invalidArgument(
      'The "options.authorizer" argument must be "strict" or "none".',
    );
  }
  const setup =
    input["connectionSetup"] === undefined ? [] : input["connectionSetup"];
  if (!Array.isArray(setup)) {
    throw invalidArgument(
      'The "options.connectionSetup" argument must be an array.',
    );
  }

  return {
    connections: connections as number,
    authorizer,
    readBigInts: booleanOption(input["readBigInts"], "readBigInts", false),
    returnArrays: booleanOption(input["returnArrays"], "returnArrays", false),
    allowExtension: booleanOption(
      input["allowExtension"],
      "allowExtension",
      false,
    ),
    connectionSetup: setup.map((operation, index) =>
      snapshotOperation(operation, index, true),
    ),
  };
}

function snapshotTransaction(options: unknown): PoolTransaction | undefined {
  if (options === undefined) return undefined;
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw invalidArgument('The "batch options" argument must be an object.');
  }
  const input = options as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "transaction") {
      throw invalidArgument(`Unknown batch option "${key}".`);
    }
  }
  const transaction = input["transaction"];
  if (transaction === undefined) return undefined;
  if (
    transaction !== "deferred" &&
    transaction !== "immediate" &&
    transaction !== "exclusive"
  ) {
    throw invalidArgument(
      'The "batch options.transaction" argument must be "deferred", "immediate", or "exclusive".',
    );
  }
  return transaction;
}

/**
 * An experimental fixed-size pool of warm SQLite connections.
 *
 * SQL execution and connection lifecycle work run on libuv worker threads.
 * Calls waiting for a connection stay in the JavaScript scheduler and consume
 * no libuv worker.
 *
 * This API is experimental. Its compatibility policy is separate from the
 * stable `@photostructure/sqlite` entry point, and it may change as production
 * usage and benchmarks reveal better semantics.
 *
 * Only connection-independent operations are exposed. Prepared-statement
 * handles, iteration, streaming, JavaScript transaction callbacks, user
 * functions, sessions, changesets, backup, and serialization are deliberately
 * omitted; use `DatabaseSync` for workloads needing that stateful surface.
 *
 * @example
 * ```typescript
 * import { DatabasePool } from "@photostructure/sqlite/experimental";
 *
 * await using pool = await DatabasePool.open("app.db", {
 *   connections: 2,
 *   connectionSetup: [
 *     { sql: "PRAGMA journal_mode=WAL" },
 *     { sql: "PRAGMA busy_timeout=5000" },
 *   ],
 * });
 *
 * await pool.run("INSERT INTO users(name) VALUES (?)", ["Ada"]);
 * const users = await pool.all("SELECT * FROM users ORDER BY id");
 * ```
 *
 * @see {@link experimental-async-pool | Experimental async database pool} for
 * ordering, concurrency, libuv sizing, and closing semantics.
 */
export class DatabasePool {
  readonly #connections: NativeConnection[];
  readonly #idle: NativeConnection[];
  readonly #pending: PendingRequest<unknown>[] = [];
  #inFlight = 0;
  #state: PoolState = "open";
  #closePromise?: Promise<void>;
  #resolveClose?: () => void;
  #rejectClose?: (reason?: unknown) => void;
  #nativeCloseStarted = false;

  private constructor(guard?: symbol, connections: NativeConnection[] = []) {
    if (guard !== constructorToken) throw new TypeError("Illegal constructor");
    this.#connections = connections;
    this.#idle = [...connections];
  }

  /**
   * Open every connection in the pool, run {@link
   * DatabasePoolOptions.connectionSetup} on each, and resolve once all of them
   * are ready.
   *
   * @param location Database path, `:memory:`, or a SQLite URI. `Buffer` and
   * `URL` locations are copied before the asynchronous open begins.
   * @param options Pool configuration. Unknown keys are rejected.
   * @returns A pool ready to accept operations.
   * @throws If an option is invalid, if a multi-connection pool is requested
   * for a private in-memory or temporary location, or if opening or setting up
   * any connection fails. Connections opened before the failure are closed.
   */
  static async open(
    location: string | Buffer | URL,
    options?: DatabasePoolOptions,
  ): Promise<DatabasePool> {
    const copiedLocation = snapshotLocation(location);
    const normalized = normalizeOptions(options);
    if (normalized.connections > 1 && isPrivateMemoryLocation(copiedLocation)) {
      throw invalidArgument(
        "In-memory and temporary databases require exactly one pool connection.",
      );
    }

    const connections: NativeConnection[] = [];
    try {
      for (let index = 0; index < normalized.connections; index++) {
        connections.push(
          await binding._openAsyncPoolConnection(copiedLocation, {
            readBigInts: normalized.readBigInts,
            returnArrays: normalized.returnArrays,
            authorizer: normalized.authorizer,
            allowExtension: normalized.allowExtension,
            connectionSetup: normalized.connectionSetup,
          }),
        );
      }
      return new DatabasePool(constructorToken, connections);
    } catch (error) {
      await Promise.allSettled(
        connections.map((connection) =>
          Promise.resolve().then(() => connection.close()),
        ),
      );
      throw error;
    }
  }

  /**
   * Run one statement on any available connection and discard its rows.
   *
   * @param sql Exactly one executable SQL statement.
   * @returns The number of rows the statement changed. There is no
   * `lastInsertRowid`; use `INSERT ... RETURNING` with {@link get} or
   * {@link all} when generated values matter.
   */
  run(sql: string, params?: PoolParams): Promise<PoolRunResult> {
    return this.#single("run", sql, params) as Promise<PoolRunResult>;
  }

  /**
   * Run one statement on any available connection and return its first row.
   *
   * The statement still runs to completion, so `INSERT ... RETURNING` applies
   * all of its changes even though only the first row is returned.
   *
   * @param sql Exactly one executable SQL statement.
   * @returns The first row, or `undefined` when the statement produced none.
   */
  get(sql: string, params?: PoolParams): Promise<PoolRow | undefined> {
    return this.#single("get", sql, params) as Promise<PoolRow | undefined>;
  }

  /**
   * Run one statement on any available connection and return every row.
   *
   * The complete result is materialized natively before JavaScript objects are
   * created on the event-loop thread, so a large result has a high peak memory
   * footprint and its conversion can still pause JavaScript.
   *
   * @param sql Exactly one executable SQL statement.
   */
  all(sql: string, params?: PoolParams): Promise<PoolRow[]> {
    return this.#single("all", sql, params) as Promise<PoolRow[]>;
  }

  /**
   * Run several operations sequentially on one leased connection, in one worker
   * job. All SQL and parameters must be known when `batch()` is called.
   *
   * Use this when operations must share a connection or a transaction. Separate
   * calls may be leased to different connections and complete in any order.
   *
   * @param operations Descriptors to run, whose results are returned in order.
   * @param options Set `transaction` for all-or-nothing semantics.
   * @example
   * ```typescript
   * const results = await pool.batch(
   *   [
   *     { kind: "run", sql: "UPDATE account SET balance = balance - ? WHERE id = ?", params: [10, 1] },
   *     { kind: "run", sql: "UPDATE account SET balance = balance + ? WHERE id = ?", params: [10, 2] },
   *     { kind: "get", sql: "SELECT balance FROM account WHERE id = ?", params: [2] },
   *   ],
   *   { transaction: "immediate" },
   * );
   * ```
   */
  batch(
    operations: readonly PoolOperation[],
    options?: PoolBatchOptions,
  ): Promise<PoolOperationResult[]> {
    try {
      if (!Array.isArray(operations)) {
        throw invalidArgument('The "operations" argument must be an array.');
      }
      const copied = operations.map((operation, index) =>
        snapshotOperation(operation, index, false),
      );
      const transaction = snapshotTransaction(options);
      return this.#submit((connection) => {
        const request: {
          operations: NativeOperation[];
          transaction?: PoolTransaction;
        } = { operations: copied };
        if (transaction !== undefined) request.transaction = transaction;
        return connection.execute(request);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Close the pool. Closing begins immediately: new work is rejected, work
   * already accepted drains, and then each physical connection closes exactly
   * once.
   *
   * Idempotent; concurrent and repeated callers share one outcome.
   *
   * @returns Resolves once every connection has closed.
   */
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    if (this.#state === "closed") return Promise.resolve();

    this.#state = "closing";
    this.#closePromise = new Promise<void>((resolve, reject) => {
      this.#resolveClose = resolve;
      this.#rejectClose = reject;
    });
    this.#dispatch();
    return this.#closePromise;
  }

  /**
   * Closes the pool via {@link close}, so `await using` releases it on scope
   * exit, including when an exception unwinds the scope.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  #single(
    kind: "run" | "get" | "all",
    sql: unknown,
    params: unknown,
  ): Promise<PoolOperationResult> {
    try {
      const operation = snapshotOperation({ kind, sql, params }, 0, false);
      return this.#submit(async (connection) => {
        const results = await connection.execute({ operations: [operation] });
        return results[0];
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #submit<T>(
    execute: (connection: NativeConnection) => Promise<T>,
  ): Promise<T> {
    if (this.#state !== "open") {
      return Promise.reject(
        new Error(
          this.#state === "closing"
            ? "DatabasePool is closing"
            : "DatabasePool is closed",
        ),
      );
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.#pending.push({
        execute,
        resolve,
        reject,
      } as PendingRequest<unknown>);
    });
    this.#dispatch();
    return promise;
  }

  #dispatch(): void {
    while (this.#idle.length > 0 && this.#pending.length > 0) {
      const connection = this.#idle.shift()!;
      const request = this.#pending.shift()!;
      this.#inFlight++;
      void Promise.resolve()
        .then(() => request.execute(connection))
        .then(
          (value) => request.resolve(value),
          (error) => {
            request.reject(error);
            if (
              error !== null &&
              typeof error === "object" &&
              (error as { fatal?: boolean }).fatal === true
            ) {
              this.#fail(error);
            }
          },
        )
        .finally(() => {
          this.#inFlight--;
          this.#idle.push(connection);
          this.#dispatch();
        });
    }

    if (
      this.#state === "closing" &&
      this.#pending.length === 0 &&
      this.#inFlight === 0
    ) {
      void this.#closeConnections();
    }
    if (this.#state === "failed" && this.#inFlight === 0) {
      void this.#closeConnections();
    }
  }

  #fail(error: unknown): void {
    if (this.#state === "failed" || this.#state === "closed") return;
    this.#state = "failed";
    while (this.#pending.length > 0) this.#pending.shift()!.reject(error);
    if (!this.#closePromise) {
      const closePromise = new Promise<void>((resolve, reject) => {
        this.#resolveClose = resolve;
        this.#rejectClose = reject;
      });
      // Fatal cleanup starts without a close() caller. Mark its rejection as
      // internally observed while preserving the original promise for a later
      // close() caller that wants to inspect the native cleanup result.
      void closePromise.catch(() => undefined);
      this.#closePromise = closePromise;
    }
  }

  async #closeConnections(): Promise<void> {
    if (this.#state === "closed" || this.#nativeCloseStarted) return;
    this.#nativeCloseStarted = true;
    const results = await Promise.allSettled(
      this.#connections.map((connection) =>
        Promise.resolve().then(() => connection.close()),
      ),
    );
    this.#state = "closed";
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) this.#rejectClose?.(failed.reason);
    else this.#resolveClose?.();
  }
}
