/**
 * Changeset conflict resolution return values for `applyChangeset()` callbacks.
 *
 * These constants are compatible with `node:sqlite`.
 *
 * @see https://sqlite.org/session/sqlite3changeset_apply.html
 */
export interface SqliteChangesetResolution {
  /** Skip conflicting changes. */
  SQLITE_CHANGESET_OMIT: number;
  /** Replace conflicting changes. */
  SQLITE_CHANGESET_REPLACE: number;
  /** Abort on conflict. */
  SQLITE_CHANGESET_ABORT: number;
}
