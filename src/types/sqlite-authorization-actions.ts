/**
 * Authorization action codes passed to `setAuthorizer()` callbacks.
 *
 * These constants are compatible with `node:sqlite`.
 *
 * @see https://sqlite.org/c3ref/c_alter_table.html
 */
export interface SqliteAuthorizationActions {
  /** Create a new index. */
  SQLITE_CREATE_INDEX: number;
  /** Create a new table. */
  SQLITE_CREATE_TABLE: number;
  /** Create a new temporary index. */
  SQLITE_CREATE_TEMP_INDEX: number;
  /** Create a new temporary table. */
  SQLITE_CREATE_TEMP_TABLE: number;
  /** Create a new temporary trigger. */
  SQLITE_CREATE_TEMP_TRIGGER: number;
  /** Create a new temporary view. */
  SQLITE_CREATE_TEMP_VIEW: number;
  /** Create a new trigger. */
  SQLITE_CREATE_TRIGGER: number;
  /** Create a new view. */
  SQLITE_CREATE_VIEW: number;
  /** Delete rows from a table. */
  SQLITE_DELETE: number;
  /** Drop an index. */
  SQLITE_DROP_INDEX: number;
  /** Drop a table. */
  SQLITE_DROP_TABLE: number;
  /** Drop a temporary index. */
  SQLITE_DROP_TEMP_INDEX: number;
  /** Drop a temporary table. */
  SQLITE_DROP_TEMP_TABLE: number;
  /** Drop a temporary trigger. */
  SQLITE_DROP_TEMP_TRIGGER: number;
  /** Drop a temporary view. */
  SQLITE_DROP_TEMP_VIEW: number;
  /** Drop a trigger. */
  SQLITE_DROP_TRIGGER: number;
  /** Drop a view. */
  SQLITE_DROP_VIEW: number;
  /** Insert rows into a table. */
  SQLITE_INSERT: number;
  /** Execute a PRAGMA statement. */
  SQLITE_PRAGMA: number;
  /** Read a column from a table. */
  SQLITE_READ: number;
  /** Execute a SELECT statement. */
  SQLITE_SELECT: number;
  /** Begin/commit/rollback a transaction. */
  SQLITE_TRANSACTION: number;
  /** Update rows in a table. */
  SQLITE_UPDATE: number;
  /** Attach a database. */
  SQLITE_ATTACH: number;
  /** Detach a database. */
  SQLITE_DETACH: number;
  /** Alter a table. */
  SQLITE_ALTER_TABLE: number;
  /** Reindex. */
  SQLITE_REINDEX: number;
  /** Analyze a table or index. */
  SQLITE_ANALYZE: number;
  /** Create a virtual table. */
  SQLITE_CREATE_VTABLE: number;
  /** Drop a virtual table. */
  SQLITE_DROP_VTABLE: number;
  /** Call a function. */
  SQLITE_FUNCTION: number;
  /** Create/release/rollback a savepoint. */
  SQLITE_SAVEPOINT: number;
  /** No longer used (historical). */
  SQLITE_COPY: number;
  /** Recursive query. */
  SQLITE_RECURSIVE: number;
}
