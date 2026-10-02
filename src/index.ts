// Load the native binding with support for both CJS and ESM
import nodeGypBuild from "node-gyp-build";
import { channel as getDiagnosticsChannel } from "node:diagnostics_channel";
import { join } from "node:path";
import { _dirname } from "./dirname";
import { SQLTagStore } from "./sql-tag-store";
import {
  DatabaseSyncInstance,
  DatabaseSyncLimits,
} from "./types/database-sync-instance";
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
export type {
  DatabaseInstance,
  DatabaseLimits,
  DatabaseSyncInstance,
  DatabaseSyncLimits,
} from "./types/database-sync-instance";
export type {
  DatabaseOptions,
  DatabaseSyncOptions,
} from "./types/database-sync-options";
export type { PragmaOptions } from "./types/pragma-options";
export type { SessionOptions } from "./types/session-options";
export type { SQLTagStoreInstance } from "./types/sql-tag-store-instance";
export type { SqliteAuthorizationActions } from "./types/sqlite-authorization-actions";
export type { SqliteAuthorizationResults } from "./types/sqlite-authorization-results";
export type { SqliteChangesetConflictTypes } from "./types/sqlite-changeset-conflict-types";
export type { SqliteChangesetResolution } from "./types/sqlite-changeset-resolution";
export type { SqliteOpenFlags } from "./types/sqlite-open-flags";
export type {
  StatementColumnMetadata,
  StatementInstance,
  StatementStatCounter,
  StatementSyncInstance,
} from "./types/statement-sync-instance";
export type { TransactionFunction, TransactionMode } from "./types/transaction";
export type { UserFunctionOptions } from "./types/user-functions-options";

// Enhancement utilities for adding better-sqlite3-style methods to any compatible database
export {
  enhance,
  isEnhanced,
  type EnhanceableDatabaseSync,
  type EnhancedDatabaseSync,
  type EnhancedMethods,
  type EnhancedStatementMethods,
} from "./enhance";

// Use _dirname() helper that works in both CJS/ESM and Jest
const binding = nodeGypBuild(join(_dirname(), ".."));
binding.setQueryDiagnosticsChannel(getDiagnosticsChannel("sqlite.db.query"));

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
 *
 * **Note:** The per-statement override options (`readBigInts`, `returnArrays`,
 * `allowBareNamedParameters`, `allowUnknownNamedParameters`) are a **Node.js v25+**
 * feature. On Node.js v24 and earlier, `node:sqlite` silently ignores these options.
 * This library implements them for forward compatibility with Node.js v25+.
 */
export interface StatementOptions {
  /** If true, the prepared statement's expandedSQL property will contain the expanded SQL. @default false */
  readonly expandedSQL?: boolean;
  /** If true, anonymous parameters are enabled for the statement. @default false */
  readonly anonymousParameters?: boolean;
  /**
   * If true, read integer values as JavaScript BigInt. Overrides database-level setting.
   * **Node.js v25+ feature** - silently ignored by `node:sqlite` on v24 and earlier.
   * @default database default
   */
  readonly readBigInts?: boolean;
  /**
   * If true, return results as arrays rather than objects. Overrides database-level setting.
   * **Node.js v25+ feature** - silently ignored by `node:sqlite` on v24 and earlier.
   * @default database default
   */
  readonly returnArrays?: boolean;
  /**
   * If true, allows bare named parameters (without prefix). Overrides database-level setting.
   * **Node.js v25+ feature** - silently ignored by `node:sqlite` on v24 and earlier.
   * @default database default
   */
  readonly allowBareNamedParameters?: boolean;
  /**
   * If true, unknown named parameters are ignored. Overrides database-level setting.
   * **Node.js v25+ feature** - silently ignored by `node:sqlite` on v24 and earlier.
   * @default database default
   */
  readonly allowUnknownNamedParameters?: boolean;
  /**
   * If true, prepare with `SQLITE_PREPARE_PERSISTENT`, telling SQLite the
   * statement will be retained and reused many times.
   * @default false
   */
  readonly persistent?: boolean;
}

export interface Session {
  /**
   * Generate a changeset containing all changes recorded by the session.
   * @returns A Uint8Array containing the changeset data.
   */
  changeset(): Uint8Array;
  /**
   * Generate a patchset containing all changes recorded by the session.
   * @returns A Uint8Array containing the patchset data.
   */
  patchset(): Uint8Array;
  /**
   * Close the session and release its resources.
   */
  close(): void;
  /**
   * Close the session and release its resources. Repeated disposal is a no-op.
   */
  [Symbol.dispose](): void;
}

/**
 * The main SQLite module interface.
 */
export interface SqliteModule {
  /**
   * The Database class represents a synchronous connection to a SQLite database.
   * All operations are performed synchronously, blocking until completion.
   */
  Database: new (
    location?: string | Buffer | URL,
    options?: DatabaseSyncOptions,
  ) => DatabaseSyncInstance;
  /**
   * The pre-rename name of {@link SqliteModule.Database}, kept as an alias.
   * Node.js deprecates it in documentation only (DEP0210).
   */
  DatabaseSync: SqliteModule["Database"];
  /**
   * The Statement class represents a synchronous prepared statement.
   * This class should not be instantiated directly; use Database.prepare() instead.
   */
  Statement: new (
    database: DatabaseSyncInstance,
    sql: string,
    options?: StatementOptions,
  ) => StatementSyncInstance;
  /**
   * The pre-rename name of {@link SqliteModule.Statement}, kept as an alias.
   * Node.js deprecates it in documentation only (DEP0211).
   */
  StatementSync: SqliteModule["Statement"];
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
 * The Database class represents a synchronous connection to a SQLite database.
 * All database operations are performed synchronously, blocking the thread until completion.
 *
 * @example
 * ```typescript
 * import { Database } from '@photostructure/sqlite';
 *
 * // Create an in-memory database
 * const db = new Database(':memory:');
 *
 * // Create a file-based database
 * const fileDb = new Database('./mydata.db');
 *
 * // Create with options
 * const readOnlyDb = new Database('./data.db', { readOnly: true });
 * ```
 */
// Store the native binding's Database
const _Database = binding.Database;
// Wrapper around the native constructor to enforce usage of `new` with the correct error code.
// We use a function wrapper instead of a Proxy for better performance and explicit prototype handling.
export const Database = function (this: any, ...args: any[]) {
  if (!new.target) {
    const err = new TypeError("Cannot call constructor without `new`");
    (err as NodeJS.ErrnoException).code = "ERR_CONSTRUCT_CALL_REQUIRED";
    throw err;
  }
  return Reflect.construct(_Database, args, new.target);
} as unknown as SqliteModule["Database"];
// Set explicitly: TypeScript compiles this to `exports.Database = ...`, an
// assignment to a member expression, which infers no name.
Object.defineProperty(Database, "name", { value: "Database" });
Object.setPrototypeOf(Database, _Database);
Database.prototype = _Database.prototype;

/**
 * The pre-rename name of {@link Database}, kept as an alias: `DatabaseSync ===
 * Database`. Node.js renamed the class in PR #65988 and deprecates the old
 * name in documentation only (DEP0210).
 */
export const DatabaseSync = Database;

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

// Limit name to SQLite limit ID mapping (matches upstream kLimitMapping order)
const LIMIT_MAPPING: ReadonlyArray<{
  name: keyof DatabaseSyncLimits;
  id: number;
}> = [
  { name: "length", id: 0 },
  { name: "sqlLength", id: 1 },
  { name: "column", id: 2 },
  { name: "exprDepth", id: 3 },
  { name: "compoundSelect", id: 4 },
  { name: "vdbeOp", id: 5 },
  { name: "functionArg", id: 6 },
  { name: "attach", id: 7 },
  { name: "likePatternLength", id: 8 },
  { name: "variableNumber", id: 9 },
  { name: "triggerDepth", id: 10 },
];

const INT_MAX = 2147483647;

// WeakMap to cache limits objects per database instance
const limitsCache = new WeakMap<DatabaseSyncInstance, DatabaseSyncLimits>();

function validateLimitValue(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(
      "Limit value must be a non-negative integer or Infinity.",
    );
  }
  if (value === Infinity) {
    return INT_MAX;
  }
  if (!Number.isFinite(value) || value !== Math.trunc(value)) {
    throw new TypeError(
      "Limit value must be a non-negative integer or Infinity.",
    );
  }
  if (value < 0) {
    throw new RangeError("Limit value must be non-negative.");
  }
  return value;
}

function createLimitsObject(db: DatabaseSyncInstance): DatabaseSyncLimits {
  const obj = Object.create(null) as DatabaseSyncLimits;
  for (const { name, id } of LIMIT_MAPPING) {
    Object.defineProperty(obj, name, {
      get() {
        return db.getLimit(id);
      },
      set(value: unknown) {
        const validated = validateLimitValue(value);
        db.setLimit(id, validated);
      },
      enumerable: true,
      configurable: false,
    });
  }
  return obj;
}

if (!Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "limits")) {
  Object.defineProperty(DatabaseSync.prototype, "limits", {
    get(this: DatabaseSyncInstance) {
      let obj = limitsCache.get(this);
      if (obj == null) {
        obj = createLimitsObject(this);
        limitsCache.set(this, obj);
      }
      return obj;
    },
    enumerable: true,
    configurable: true,
  });
}

// NOTE: .pragma() and .transaction() are NOT added to the prototype by default.
// This keeps DatabaseSync 100% API-compatible with node:sqlite.
// Users who want better-sqlite3-style methods should use enhance():
//
//   import { DatabaseSync, enhance } from '@photostructure/sqlite';
//   const db = enhance(new DatabaseSync(':memory:'));
//   db.pragma('journal_mode', { simple: true });
//   db.transaction(() => { ... });

/**
 * The Statement class represents a prepared SQL statement.
 * This class should not be instantiated directly; use Database.prepare() instead.
 *
 * @example
 * ```typescript
 * const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
 * const user = stmt.get(123);
 * stmt.close();
 * ```
 */
// Store the native binding's Statement for internal use
const _Statement = binding.Statement;
// Export a wrapper that throws ERR_ILLEGAL_CONSTRUCTOR when called directly
// but preserves instanceof checks and prototype chain.
export const Statement = function () {
  const err = new TypeError("Illegal constructor");
  (err as NodeJS.ErrnoException).code = "ERR_ILLEGAL_CONSTRUCTOR";
  throw err;
} as unknown as SqliteModule["Statement"];
// See the Database wrapper above.
Object.defineProperty(Statement, "name", { value: "Statement" });
// Use the native prototype directly so instanceof checks work correctly
// (stmt instanceof Statement will check if Statement.prototype is in stmt's chain)
Statement.prototype = _Statement.prototype;

/**
 * The pre-rename name of {@link Statement}, kept as an alias: `StatementSync
 * === Statement`. Node.js renamed the class in PR #65988 and deprecates the
 * old name in documentation only (DEP0211).
 */
export const StatementSync = Statement;

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

/**
 * Options for the backup() function.
 */
export interface BackupOptions {
  /** Number of pages to be transmitted in each batch of the backup. Must be a positive integer. @default 100 */
  rate?: number;
  /** Name of the source database. Can be 'main' or any attached database. @default 'main' */
  source?: string;
  /** Name of the target database. Can be 'main' or any attached database. @default 'main' */
  target?: string;
  /** Callback function that will be called with progress information. */
  progress?: (info: { totalPages: number; remainingPages: number }) => void;
}

/**
 * Standalone function to make a backup of a database.
 *
 * This function matches the Node.js `node:sqlite` module API which exports
 * `backup()` as a standalone function in addition to the `db.backup()` method.
 *
 * @param sourceDb The database to backup from.
 * @param destination The path where the backup will be created.
 * @param options Optional configuration for the backup operation.
 * @returns A promise that resolves when the backup is completed.
 *
 * @example
 * ```typescript
 * import { DatabaseSync, backup } from '@photostructure/sqlite';
 *
 * const db = new DatabaseSync('./source.db');
 * await backup(db, './backup.db');
 *
 * // With options
 * await backup(db, './backup.db', {
 *   rate: 10,
 *   progress: ({ totalPages, remainingPages }) => {
 *     console.log(`Progress: ${totalPages - remainingPages}/${totalPages}`);
 *   }
 * });
 * ```
 */
export const backup: (
  sourceDb: DatabaseSyncInstance,
  destination: string | Buffer | URL,
  options?: BackupOptions,
) => Promise<number> = binding.backup;

// Default export for CommonJS compatibility
export default binding as SqliteModule;
