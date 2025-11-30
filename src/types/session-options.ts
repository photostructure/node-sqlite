/**
 * Configuration options for creating SQLite sessions.
 * Used with `DatabaseSync.createSession()` to track database changes.
 */
export interface SessionOptions {
  /** The table to track changes for. If omitted, all tables are tracked. */
  readonly table?: string;
  /** The database name. @default "main" */
  readonly db?: string;
}
