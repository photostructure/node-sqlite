import { Session, StatementOptions } from "../index";
import { AggregateOptions } from "./aggregate-options";
import { ChangesetApplyOptions } from "./changeset-apply-options";
import { SessionOptions } from "./session-options";
import { SQLTagStoreInstance } from "./sql-tag-store-instance";
import { StatementSyncInstance } from "./statement-sync-instance";
import { UserFunctionOptions } from "./user-functions-options";

/**
 * Represents a SQLite database connection.
 * This interface represents an instance of the DatabaseSync class.
 */

export interface DatabaseSyncInstance {
  /** Indicates whether the database connection is open. */
  readonly isOpen: boolean;
  /** Indicates whether a transaction is currently active. */
  readonly isTransaction: boolean;

  /**
   * Opens a database connection. This method should only be used when the database
   * was created with { open: false }. An exception is thrown if the database is already open.
   */
  open(): void;
  /**
   * Closes the database connection. This method should be called to ensure that
   * the database connection is properly cleaned up. Once a database is closed,
   * it cannot be used again.
   */
  close(): void;
  /**
   * Returns the location of the database file. For attached databases, you can specify
   * the database name. Returns null for in-memory databases.
   * @param dbName The name of the database. Defaults to 'main' (the primary database).
   * @returns The file path of the database, or null for in-memory databases.
   */
  location(dbName?: string): string | null;
  /**
   * Compiles an SQL statement and returns a StatementSyncInstance object.
   * @param sql The SQL statement to prepare.
   * @param options Optional configuration for the statement.
   * @returns A StatementSyncInstance object that can be executed multiple times.
   */
  prepare(sql: string, options?: StatementOptions): StatementSyncInstance;
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
   * Create a new SQLTagStore for cached prepared statements via tagged template syntax.
   * @param capacity Optional maximum number of statements to cache. @default 1000
   * @returns A SQLTagStore instance.
   * @example
   * ```typescript
   * const sql = db.createTagStore();
   * sql.run`INSERT INTO users VALUES (${id}, ${name})`;
   * const user = sql.get`SELECT * FROM users WHERE id = ${id}`;
   * ```
   */
  createTagStore(capacity?: number): SQLTagStoreInstance;

  /**
   * Apply a changeset to the database.
   * @param changeset The changeset data to apply.
   * @param options Optional configuration for applying the changeset.
   * @returns true if successful, false if aborted.
   */
  applyChangeset(
    changeset: Uint8Array,
    options?: ChangesetApplyOptions,
  ): boolean;

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
   * Enables or disables the defensive flag. When the defensive flag is active,
   * language features that allow ordinary SQL to deliberately corrupt the
   * database file are disabled.
   * @param active Whether to enable or disable the defensive flag.
   * @see https://sqlite.org/c3ref/c_dbconfig_defensive.html
   */
  enableDefensive(active: boolean): void;

  /**
   * Sets an authorization callback that is invoked before each SQL operation.
   * The authorizer can allow, deny, or ignore each operation.
   *
   * @param callback The authorization callback function, or null to remove the authorizer.
   *   - actionCode: The action being requested (e.g., SQLITE_SELECT, SQLITE_INSERT)
   *   - param1: First parameter (varies by action, often table name)
   *   - param2: Second parameter (varies by action, often column name)
   *   - param3: Third parameter (usually database name like "main")
   *   - param4: Fourth parameter (trigger or view name if applicable)
   *
   *   The callback must return one of:
   *   - constants.SQLITE_OK: Allow the operation
   *   - constants.SQLITE_DENY: Deny the operation and abort the SQL statement
   *   - constants.SQLITE_IGNORE: Silently ignore/skip the operation
   *
   * @example
   * ```typescript
   * // Block all DELETE operations
   * db.setAuthorizer((actionCode, table, column, dbName, trigger) => {
   *   if (actionCode === constants.SQLITE_DELETE) {
   *     return constants.SQLITE_DENY;
   *   }
   *   return constants.SQLITE_OK;
   * });
   *
   * // Remove the authorizer
   * db.setAuthorizer(null);
   * ```
   *
   * @see https://sqlite.org/c3ref/set_authorizer.html
   */
  setAuthorizer(
    callback:
      | ((
          actionCode: number,
          param1: string | null,
          param2: string | null,
          param3: string | null,
          param4: string | null,
        ) => number)
      | null,
  ): void;

  /**
   * An object with getters and setters for each SQLite limit.
   * Setting a property changes the limit immediately.
   * Setting a property to `Infinity` resets the limit to its compile-time maximum.
   * @see https://sqlite.org/c3ref/limit.html
   */
  readonly limits: DatabaseSyncLimits;

  /** @internal Native method to get a SQLite limit by ID. */
  getLimit(limitId: number): number;
  /** @internal Native method to set a SQLite limit by ID. Returns old value. */
  setLimit(limitId: number, value: number): number;

  /**
   * Serializes a database into a `Uint8Array`. The serialization is a byte-for-byte
   * copy of the database file as it would exist on disk.
   *
   * @param dbName Name of the schema to serialize. Defaults to `"main"`.
   * @returns A `Uint8Array` containing the serialized database.
   * @see https://sqlite.org/c3ref/serialize.html
   */
  serialize(dbName?: string): Uint8Array;

  /**
   * Deserializes a database from a `Uint8Array`. The current contents of the
   * connection's main database (or the schema named in `options.dbName`) are
   * replaced. Any open prepared statements are finalized.
   *
   * @param buffer The serialized database content.
   * @param options Optional. `dbName` chooses the schema (default `"main"`).
   * @see https://sqlite.org/c3ref/deserialize.html
   */
  deserialize(buffer: Uint8Array, options?: { dbName?: string }): void;

  /** Dispose of the database resources using the explicit resource management protocol. */
  [Symbol.dispose](): void;
}

/**
 * Represents the configurable SQLite limits for a database connection.
 * Each property corresponds to a SQLite limit constant.
 * @see https://sqlite.org/c3ref/limit.html
 */
export interface DatabaseSyncLimits {
  /** Maximum length of any string or BLOB or table row, in bytes. */
  length: number;
  /** Maximum length of an SQL statement, in bytes. */
  sqlLength: number;
  /** Maximum number of columns in a table, result set, or index. */
  column: number;
  /** Maximum depth of the parse tree on any expression. */
  exprDepth: number;
  /** Maximum number of terms in a compound SELECT statement. */
  compoundSelect: number;
  /** Maximum number of instructions in a virtual machine program. */
  vdbeOp: number;
  /** Maximum number of arguments on a function. */
  functionArg: number;
  /** Maximum number of attached databases. */
  attach: number;
  /** Maximum length of the pattern argument to the LIKE or GLOB operators. */
  likePatternLength: number;
  /** Maximum index number of any parameter in an SQL statement. */
  variableNumber: number;
  /** Maximum depth of recursion for triggers. */
  triggerDepth: number;
}
