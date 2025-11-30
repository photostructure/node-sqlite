/**
 * Changeset conflict type codes passed to `applyChangeset()` callbacks.
 *
 * These constants are compatible with `node:sqlite`.
 *
 * @see https://sqlite.org/session/c_changeset_conflict.html
 */
export interface SqliteChangesetConflictTypes {
  /** Data conflict - row exists but values differ. */
  SQLITE_CHANGESET_DATA: number;
  /** Row not found in target database. */
  SQLITE_CHANGESET_NOTFOUND: number;
  /** Primary key conflict. */
  SQLITE_CHANGESET_CONFLICT: number;
  /** Constraint violation (NOT NULL, CHECK, etc.). */
  SQLITE_CHANGESET_CONSTRAINT: number;
  /** Foreign key constraint violation. */
  SQLITE_CHANGESET_FOREIGN_KEY: number;
}
