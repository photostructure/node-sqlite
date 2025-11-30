// Load the native binding with support for both CJS and ESM
import nodeGypBuild from "node-gyp-build";
import { join } from "node:path";
import { _dirname } from "./dirname";
import { SQLTagStore } from "./sql-tag-store";
import { DatabaseSyncInstance } from "./types/database-sync-instance";
import { DatabaseSyncOptions } from "./types/database-sync-options";
import { SQLTagStoreInstance } from "./types/sql-tag-store-instance";
import { SqliteAuthorizationActions } from "./types/sqlite-authorization-actions";
import { SqliteAuthorizationResults } from "./types/sqlite-authorization-results";
import { SqliteChangesetConflictTypes } from "./types/sqlite-changeset-conflict-types";
import { SqliteChangesetResolution } from "./types/sqlite-changeset-resolution";
import { SqliteOpenFlags } from "./types/sqlite-open-flags";
import { StatementSyncInstance } from "./types/statement-sync-instance";

export type { AggregateOptions } from "./types/aggregate-options";
export type { ChangesetApplyOptions } from "./types/changeset-apply-options";
export type { DatabaseSyncInstance } from "./types/database-sync-instance";
export type { DatabaseSyncOptions } from "./types/database-sync-options";
export type { SessionOptions } from "./types/session-options";
export type { SQLTagStoreInstance } from "./types/sql-tag-store-instance";
export type { SqliteAuthorizationActions } from "./types/sqlite-authorization-actions";
export type { SqliteAuthorizationResults } from "./types/sqlite-authorization-results";
export type { SqliteChangesetConflictTypes } from "./types/sqlite-changeset-conflict-types";
export type { SqliteChangesetResolution } from "./types/sqlite-changeset-resolution";
export type { SqliteOpenFlags } from "./types/sqlite-open-flags";
export type { StatementSyncInstance } from "./types/statement-sync-instance";
export type { UserFunctionOptions } from "./types/user-functions-options";

// Use _dirname() helper that works in both CJS/ESM and Jest
const binding = nodeGypBuild(join(_dirname(), ".."));

/**
 * All SQLite constants exported by this module.
 *
 * This is a union of all constant category interfaces:
 * - {@link SqliteOpenFlags} - Database open flags (extension beyond `node:sqlite`)
 * - {@link SqliteChangesetResolution} - Changeset conflict resolution values
 * - {@link SqliteChangesetConflictTypes} - Changeset conflict type codes
 * - {@link SqliteAuthorizationResults} - Authorization return values
 * - {@link SqliteAuthorizationActions} - Authorization action codes
 *
 * **Note:** The categorized interfaces (`SqliteOpenFlags`, etc.) are extensions
 * provided by `@photostructure/sqlite`. The `node:sqlite` module exports only
 * a flat `constants` object without these type categories.
 */
export type SqliteConstants = SqliteOpenFlags &
  SqliteChangesetResolution &
  SqliteChangesetConflictTypes &
  SqliteAuthorizationResults &
  SqliteAuthorizationActions;

/**
 * Options for creating a prepared statement.
 */
export interface StatementOptions {
  /** If true, the prepared statement's expandedSQL property will contain the expanded SQL. @default false */
  readonly expandedSQL?: boolean;
  /** If true, anonymous parameters are enabled for the statement. @default false */
  readonly anonymousParameters?: boolean;
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

/**
 * The main SQLite module interface.
 */
export interface SqliteModule {
  /**
   * The DatabaseSync class represents a synchronous connection to a SQLite database.
   * All operations are performed synchronously, blocking until completion.
   */
  DatabaseSync: new (
    location?: string | Buffer | URL,
    options?: DatabaseSyncOptions,
  ) => DatabaseSyncInstance;
  /**
   * The StatementSync class represents a synchronous prepared statement.
   * This class should not be instantiated directly; use Database.prepare() instead.
   */
  StatementSync: new (
    database: DatabaseSyncInstance,
    sql: string,
    options?: StatementOptions,
  ) => StatementSyncInstance;
  /**
   * The Session class for recording database changes.
   * This class should not be instantiated directly; use Database.createSession() instead.
   */
  Session: new () => Session;
  /**
   * SQLite constants for various operations and flags.
   * @see {@link SqliteConstants} for the type definition
   * @see {@link SqliteOpenFlags} for database open flags (extension beyond `node:sqlite`)
   * @see {@link SqliteChangesetResolution} for changeset conflict resolution values
   * @see {@link SqliteChangesetConflictTypes} for changeset conflict type codes
   * @see {@link SqliteAuthorizationResults} for authorization return values
   * @see {@link SqliteAuthorizationActions} for authorization action codes
   */
  constants: SqliteConstants;
}

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

// node:sqlite implements createTagStore and SQLTagStore entirely in native C++.
// We use a TypeScript implementation instead, attached via prototype extension.
// This maintains API compatibility with node:sqlite while avoiding the complexity
// of a native LRU cache. Performance is equivalent since the real cost is SQLite
// execution, not cache lookups - V8's Map is highly optimized for string keys.
(DatabaseSync.prototype as DatabaseSyncInstance).createTagStore = function (
  this: DatabaseSyncInstance,
  capacity?: number,
): SQLTagStoreInstance {
  return new SQLTagStore(this, capacity);
};

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
 * The SQLTagStore class for cached prepared statements via tagged template syntax.
 * This class should not be instantiated directly; use DatabaseSync.createTagStore() instead.
 *
 * @example
 * ```typescript
 * const sql = db.createTagStore();
 * sql.run`INSERT INTO users VALUES (${id}, ${name})`;
 * const user = sql.get`SELECT * FROM users WHERE id = ${id}`;
 * ```
 */
export { SQLTagStore };

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
export const constants: SqliteConstants = binding.constants;

// Default export for CommonJS compatibility
export default binding as SqliteModule;
