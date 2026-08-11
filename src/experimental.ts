import nodeGypBuild from "node-gyp-build";
import { join } from "node:path";
import { _dirname } from "./dirname";

export type PoolAuthorizer = "strict" | "none";
export type PoolTransaction = "deferred" | "immediate" | "exclusive";
export type PoolValue =
  null | number | bigint | string | ArrayBufferView<ArrayBufferLike>;
export type PoolParams =
  readonly PoolValue[] | Readonly<Record<string, PoolValue>>;

export interface PoolSetupOperation {
  readonly sql: string;
  readonly params?: PoolParams;
}

export interface DatabasePoolOptions {
  readonly connections?: number;
  readonly authorizer?: PoolAuthorizer;
  readonly readBigInts?: boolean;
  readonly returnArrays?: boolean;
  readonly allowExtension?: boolean;
  readonly connectionSetup?: readonly PoolSetupOperation[];
}

export interface PoolRunOperation extends PoolSetupOperation {
  readonly kind: "run";
}

export interface PoolGetOperation extends PoolSetupOperation {
  readonly kind: "get";
}

export interface PoolAllOperation extends PoolSetupOperation {
  readonly kind: "all";
}

export type PoolOperation =
  PoolRunOperation | PoolGetOperation | PoolAllOperation;

export interface PoolBatchOptions {
  readonly transaction?: PoolTransaction;
}

export interface PoolRunResult {
  readonly changes: number | bigint;
}

export type PoolObjectRow = Record<string, PoolValue>;
export type PoolArrayRow = PoolValue[];
export type PoolRow = PoolObjectRow | PoolArrayRow;
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
  for (const key of Object.keys(params)) {
    copied[key] = snapshotValue(
      (params as Record<string, unknown>)[key],
      `${label}.${key}`,
    );
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
  options: Record<string, unknown>,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = options[name];
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

  const connections = input["connections"] ?? 1;
  if (!Number.isSafeInteger(connections) || (connections as number) <= 0) {
    throw invalidArgument(
      'The "options.connections" argument must be a positive safe integer.',
    );
  }
  const authorizer = input["authorizer"] ?? "strict";
  if (authorizer !== "strict" && authorizer !== "none") {
    throw invalidArgument(
      'The "options.authorizer" argument must be "strict" or "none".',
    );
  }
  const setup = input["connectionSetup"] ?? [];
  if (!Array.isArray(setup)) {
    throw invalidArgument(
      'The "options.connectionSetup" argument must be an array.',
    );
  }

  return {
    connections: connections as number,
    authorizer,
    readBigInts: booleanOption(input, "readBigInts", false),
    returnArrays: booleanOption(input, "returnArrays", false),
    allowExtension: booleanOption(input, "allowExtension", false),
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

  private constructor(token?: symbol, connections: NativeConnection[] = []) {
    if (token !== constructorToken) throw new TypeError("Illegal constructor");
    this.#connections = connections;
    this.#idle = [...connections];
  }

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

  run(sql: string, params?: PoolParams): Promise<PoolRunResult> {
    return this.#single("run", sql, params) as Promise<PoolRunResult>;
  }

  get(sql: string, params?: PoolParams): Promise<PoolRow | undefined> {
    return this.#single("get", sql, params) as Promise<PoolRow | undefined>;
  }

  all(sql: string, params?: PoolParams): Promise<PoolRow[]> {
    return this.#single("all", sql, params) as Promise<PoolRow[]>;
  }

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
