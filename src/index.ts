/**
 * @photostructure/sqlite - Node.js SQLite implementation extracted from Node.js core
 */

// Load the native binding
const binding = require("node-gyp-build")(
  require("path").join(__dirname, ".."),
);

/**
 * Configuration options for opening a database.
 */
export interface DatabaseOpenConfiguration {
  /** Path to the database file. Use ':memory:' for an in-memory database. */
  readonly location?: string;
  /** If true, the database is opened in read-only mode. @default false */
  readonly readOnly?: boolean;
  /** If true, foreign key constraints are enforced. @default true */
  readonly enableForeignKeys?: boolean;
  /** If true, double-quoted string literals are allowed. @default true */
  readonly enableDoubleQuotedStringLiterals?: boolean;
  /** Sets the busy timeout in milliseconds. @default 5000 */
  readonly timeout?: number;
  /** If true, enables loading of SQLite extensions. @default false */
  readonly allowExtension?: boolean;
}

/**
 * Options for creating a prepared statement.
 */
export interface StatementOptions {
  /** If true, the prepared statement's expandedSQL property will contain the expanded SQL. @default false */
  readonly expandedSQL?: boolean;
  /** If true, anonymous parameters are enabled for the statement. @default false */
  readonly anonymousParameters?: boolean;
}

/**
 * A prepared SQL statement that can be executed multiple times with different parameters.
 */
export interface PreparedStatement {
  /** The original SQL source string. */
  readonly sourceSQL: string;
  /** The expanded SQL string with bound parameters, if expandedSQL option was set. */
  readonly expandedSQL: string | undefined;
  /**
   * This method executes a prepared statement and returns an object.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An object with the number of changes and the last insert rowid.
   */
  run(...parameters: any[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  /**
   * This method executes a prepared statement and returns the first result row.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns The first row from the query results, or undefined if no rows.
   */
  get(...parameters: any[]): any;
  /**
   * This method executes a prepared statement and returns all results as an array.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An array of row objects from the query results.
   */
  all(...parameters: any[]): any[];
  /**
   * This method executes a prepared statement and returns an iterable iterator of objects.
   * Each object represents a row from the query results.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An iterable iterator of row objects.
   */
  iterate(...parameters: any[]): IterableIterator<any>;
  /**
   * Set whether to read integer values as JavaScript BigInt.
   * @param readBigInts If true, read integers as BigInts. @default false
   */
  setReadBigInts(readBigInts: boolean): void;
  /**
   * Set whether to allow bare named parameters in SQL.
   * @param allowBareNamedParameters If true, allows bare named parameters. @default false
   */
  setAllowBareNamedParameters(allowBareNamedParameters: boolean): void;
  /**
   * Finalizes the prepared statement and releases its resources.
   * Called automatically by Symbol.dispose.
   */
  finalize(): void;
  /** Dispose of the statement resources using the explicit resource management protocol. */
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

export interface SessionOptions {
  /** The table to track changes for. If omitted, all tables are tracked. */
  readonly table?: string;
  /** The database name. @default "main" */
  readonly db?: string;
}

export interface Session {
  /**
   * Generate a changeset containing all changes recorded by the session.
   * @returns A Buffer containing the changeset data.
   */
  changeset(): Buffer;
  /**
   * Generate a patchset containing all changes recorded by the session.
   * @returns A Buffer containing the patchset data.
   */
  patchset(): Buffer;
  /**
   * Close the session and release its resources.
   */
  close(): void;
}

export interface ChangesetApplyOptions {
  /**
   * Function called when a conflict is detected during changeset application.
   * @param conflictType The type of conflict (SQLITE_CHANGESET_CONFLICT, etc.)
   * @returns One of SQLITE_CHANGESET_OMIT, SQLITE_CHANGESET_REPLACE, or SQLITE_CHANGESET_ABORT
   */
  readonly onConflict?: (conflictType: number) => number;
  /**
   * Function called to filter which tables to apply changes to.
   * @param tableName The name of the table
   * @returns true to include the table, false to skip it
   */
  readonly filter?: (tableName: string) => boolean;
}

/**
 * Represents a SQLite database connection.
 */
export interface Database {
  /** The path to the database file, or ':memory:' for in-memory databases. */
  readonly location: string;
  /** Indicates whether the database connection is open. */
  readonly isOpen: boolean;
  /** Indicates whether a transaction is currently active. */
  readonly isTransaction: boolean;

  /**
   * Opens a database connection. This method is called automatically when creating
   * a DatabaseSync instance, so typically should not be called directly.
   * @param configuration Optional configuration for opening the database.
   */
  open(configuration?: DatabaseOpenConfiguration): void;
  /**
   * Closes the database connection. This method should be called to ensure that
   * the database connection is properly cleaned up. Once a database is closed, 
   * it cannot be used again.
   */
  close(): void;
  /**
   * Compiles an SQL statement and returns a PreparedStatement object.
   * @param sql The SQL statement to prepare.
   * @param options Optional configuration for the statement.
   * @returns A PreparedStatement object that can be executed multiple times.
   */
  prepare(sql: string, options?: StatementOptions): PreparedStatement;
  /**
   * This method allows one or more SQL statements to be executed without
   * returning any results. This is useful for commands like CREATE TABLE,
   * INSERT, UPDATE, or DELETE.
   * @param sql The SQL statement(s) to execute.
   */
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
  /**
   * Create a new session to record database changes.
   * @param options Optional configuration for the session.
   * @returns A Session object for recording changes.
   */
  createSession(options?: SessionOptions): Session;
  /**
   * Apply a changeset to the database.
   * @param changeset The changeset data to apply.
   * @param options Optional configuration for applying the changeset.
   * @returns true if successful, false if aborted.
   */
  applyChangeset(changeset: Buffer, options?: ChangesetApplyOptions): boolean;
  /**
   * Enables or disables the loading of SQLite extensions.
   * @param enable If true, enables extension loading. If false, disables it.
   */
  enableLoadExtension(enable: boolean): void;
  /**
   * Loads an SQLite extension from the specified file path.
   * @param path The path to the extension library.
   * @param entryPoint Optional entry point function name. If not provided, uses the default entry point.
   */
  loadExtension(path: string, entryPoint?: string): void;

  /**
   * This method allows to read and write to a database that is concurrently
   * modified by other connections. It operates page-by-page and makes a copy
   * of each page of the source database file before it is overwritten by the
   * backup process, allowing other database connections to continue reading
   * from and writing to the source database while the backup is ongoing.
   * 
   * @param destination The path to the destination database file.
   * @param options Optional configuration for the backup operation.
   * @param options.pages The number of pages to copy on each iteration. If negative or omitted, all pages are copied at once. @default -1
   * @param options.sourceDb The source database name. @default 'main'
   * @param options.destinationDb The destination database name. @default 'main'
   * @param options.progress Optional callback function that is invoked after each iteration. Receives an object with totalPages and remainingPages properties.
   * @returns A promise that resolves with the total number of pages backed up.
   * 
   * @example
   * // Basic backup
   * await db.backup('./backup.db');
   * 
   * @example
   * // Backup with progress
   * await db.backup('./backup.db', {
   *   progress: ({ totalPages, remainingPages }) => {
   *     console.log(`Progress: ${totalPages - remainingPages}/${totalPages}`);
   *   }
   * });
   */
  backup(
    destination: string,
    options?: {
      pages?: number;
      sourceDb?: string;
      destinationDb?: string;
      progress?: (info: { totalPages: number; remainingPages: number }) => void;
    },
  ): Promise<number>;

  /** Dispose of the database resources using the explicit resource management protocol. */
  [Symbol.dispose](): void;
}

/**
 * The main SQLite module interface.
 */
export interface SqliteModule {
  /**
   * The DatabaseSync class represents a synchronous connection to a SQLite database.
   * All operations are performed synchronously, blocking until completion.
   */
  DatabaseSync: new (
    location?: string,
    options?: DatabaseOpenConfiguration,
  ) => Database;
  /**
   * The StatementSync class represents a synchronous prepared statement.
   * This class should not be instantiated directly; use Database.prepare() instead.
   */
  StatementSync: new (
    database: Database,
    sql: string,
    options?: StatementOptions,
  ) => PreparedStatement;
  /**
   * The Session class for recording database changes.
   * This class should not be instantiated directly; use Database.createSession() instead.
   */
  Session: new () => Session;
  /**
   * SQLite constants for various operations and flags.
   */
  constants: {
    /** Open database for reading only. */
    SQLITE_OPEN_READONLY: number;
    /** Open database for reading and writing. */
    SQLITE_OPEN_READWRITE: number;
    /** Create database if it doesn't exist. */
    SQLITE_OPEN_CREATE: number;
    // Changeset constants
    /** Skip conflicting changes. */
    SQLITE_CHANGESET_OMIT: number;
    /** Replace conflicting changes. */
    SQLITE_CHANGESET_REPLACE: number;
    /** Abort on conflict. */
    SQLITE_CHANGESET_ABORT: number;
    /** Data conflict type. */
    SQLITE_CHANGESET_DATA: number;
    /** Row not found conflict. */
    SQLITE_CHANGESET_NOTFOUND: number;
    /** General conflict. */
    SQLITE_CHANGESET_CONFLICT: number;
    /** Constraint violation. */
    SQLITE_CHANGESET_CONSTRAINT: number;
    /** Foreign key constraint violation. */
    SQLITE_CHANGESET_FOREIGN_KEY: number;
    // ... more constants
  };
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

/**
 * The DatabaseSync class represents a synchronous connection to a SQLite database.
 * All database operations are performed synchronously, blocking the thread until completion.
 * 
 * @example
 * ```typescript
 * import { DatabaseSync } from '@photostructure/sqlite';
 * 
 * // Create an in-memory database
 * const db = new DatabaseSync(':memory:');
 * 
 * // Create a file-based database
 * const fileDb = new DatabaseSync('./mydata.db');
 * 
 * // Create with options
 * const readOnlyDb = new DatabaseSync('./data.db', { readOnly: true });
 * ```
 */
export const DatabaseSync =
  binding.DatabaseSync as SqliteModule["DatabaseSync"];

/**
 * The StatementSync class represents a prepared SQL statement.
 * This class should not be instantiated directly; use DatabaseSync.prepare() instead.
 * 
 * @example
 * ```typescript
 * const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
 * const user = stmt.get(123);
 * stmt.finalize();
 * ```
 */
export const StatementSync =
  binding.StatementSync as SqliteModule["StatementSync"];

/**
 * The Session class for recording database changes.
 * This class should not be instantiated directly; use DatabaseSync.createSession() instead.
 * 
 * @example
 * ```typescript
 * const session = db.createSession({ table: 'users' });
 * // Make some changes to the users table
 * const changeset = session.changeset();
 * session.close();
 * ```
 */
export const Session = binding.Session as SqliteModule["Session"];

/**
 * SQLite constants for various operations and flags.
 * 
 * @example
 * ```typescript
 * import { constants } from '@photostructure/sqlite';
 * 
 * const db = new DatabaseSync('./data.db', {
 *   readOnly: true,
 *   // Uses SQLITE_OPEN_READONLY internally
 * });
 * ```
 */
export const constants = binding.constants as SqliteModule["constants"];

// Default export for CommonJS compatibility
export default binding as SqliteModule;
