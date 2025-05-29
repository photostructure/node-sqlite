/**
 * @photostructure/sqlite - Node.js SQLite implementation extracted from Node.js core
 */

// Load the native binding
const binding = require("node-gyp-build")(
  require("path").join(__dirname, ".."),
);

export interface DatabaseOpenConfiguration {
  readonly location?: string;
  readonly readOnly?: boolean;
  readonly enableForeignKeys?: boolean;
  readonly enableDoubleQuotedStringLiterals?: boolean;
  readonly timeout?: number;
}

export interface StatementOptions {
  readonly expandedSQL?: boolean;
  readonly anonymousParameters?: boolean;
}

export interface PreparedStatement {
  readonly sourceSQL: string;
  readonly expandedSQL: string | undefined;
  run(...parameters: any[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  get(...parameters: any[]): any;
  all(...parameters: any[]): any[];
  /**
   * This method executes a prepared statement and returns an iterable iterator of objects.
   * Each object represents a row from the query results.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An iterable iterator of row objects.
   */
  iterate(...parameters: any[]): IterableIterator<any>;
  setReadBigInts(readBigInts: boolean): void;
  setAllowBareNamedParameters(allowBareNamedParameters: boolean): void;
  finalize(): void;
  [Symbol.dispose](): void;
}

export interface UserFunctionOptions {
  /** If `true`, sets the `SQLITE_DETERMINISTIC` flag. @default false */
  readonly deterministic?: boolean;
  /** If `true`, sets the `SQLITE_DIRECTONLY` flag. @default false */
  readonly directOnly?: boolean;
  /** If `true`, converts integer arguments to `BigInt`s. @default false */
  readonly useBigIntArguments?: boolean;
  /** If `true`, allows function to be invoked with variable arguments. @default false */
  readonly varargs?: boolean;
}

export interface AggregateOptions {
  /** The initial value for the aggregation. */
  readonly start?: any;
  /** Function called for each row to update the aggregate state. */
  readonly step: (accumulator: any, ...args: any[]) => any;
  /** Optional function for window function support to reverse a step. */
  readonly inverse?: (accumulator: any, ...args: any[]) => any;
  /** Optional function to compute the final result from the accumulator. */
  readonly result?: (accumulator: any) => any;
  /** If `true`, sets the `SQLITE_DETERMINISTIC` flag. @default false */
  readonly deterministic?: boolean;
  /** If `true`, sets the `SQLITE_DIRECTONLY` flag. @default false */
  readonly directOnly?: boolean;
  /** If `true`, converts integer arguments to `BigInt`s. @default false */
  readonly useBigIntArguments?: boolean;
  /** If `true`, allows function to be invoked with variable arguments. @default false */
  readonly varargs?: boolean;
}

export interface Database {
  readonly location: string;
  readonly isOpen: boolean;
  readonly isTransaction: boolean;

  open(configuration?: DatabaseOpenConfiguration): void;
  close(): void;
  prepare(sql: string, options?: StatementOptions): PreparedStatement;
  exec(sql: string): void;

  /**
   * This method creates SQLite user-defined functions, wrapping sqlite3_create_function_v2().
   * @param name The name of the SQLite function to create.
   * @param func The JavaScript function to call when the SQLite function is invoked.
   */
  function(name: string, func: Function): void;
  /**
   * This method creates SQLite user-defined functions, wrapping sqlite3_create_function_v2().
   * @param name The name of the SQLite function to create.
   * @param options Optional configuration settings.
   * @param func The JavaScript function to call when the SQLite function is invoked.
   */
  function(name: string, options: UserFunctionOptions, func: Function): void;

  /**
   * This method creates SQLite aggregate functions, wrapping sqlite3_create_window_function().
   * @param name The name of the SQLite aggregate function to create.
   * @param options Configuration object containing step function and other settings.
   */
  aggregate(name: string, options: AggregateOptions): void;
  createSession(table?: string): any;
  applyChangeset(changeset: Uint8Array, options?: any): void;
  enableLoadExtension(enable: boolean): void;
  loadExtension(path: string, entryPoint?: string): void;

  [Symbol.dispose](): void;
}

export interface SqliteModule {
  DatabaseSync: new (
    location?: string,
    options?: DatabaseOpenConfiguration,
  ) => Database;
  StatementSync: new (
    database: Database,
    sql: string,
    options?: StatementOptions,
  ) => PreparedStatement;
  constants: {
    SQLITE_OPEN_READONLY: number;
    SQLITE_OPEN_READWRITE: number;
    SQLITE_OPEN_CREATE: number;
    // ... more constants
  };
  backup(
    source: Database,
    destination: Database,
    sourceDb?: string,
    destinationDb?: string,
  ): Promise<void>;
}

// Add Symbol.dispose to the native classes
if (binding.DatabaseSync && typeof Symbol.dispose !== "undefined") {
  binding.DatabaseSync.prototype[Symbol.dispose] = function () {
    try {
      this.close();
    } catch {
      // Ignore errors during disposal
    }
  };
}

if (binding.StatementSync && typeof Symbol.dispose !== "undefined") {
  binding.StatementSync.prototype[Symbol.dispose] = function () {
    try {
      this.finalize();
    } catch {
      // Ignore errors during disposal
    }
  };
}

// Export the native binding with TypeScript types
export const DatabaseSync =
  binding.DatabaseSync as SqliteModule["DatabaseSync"];
export const StatementSync =
  binding.StatementSync as SqliteModule["StatementSync"];
export const constants = binding.constants as SqliteModule["constants"];
export const backup = binding.backup as SqliteModule["backup"];

// Default export for CommonJS compatibility
export default binding as SqliteModule;
