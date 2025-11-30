/**
 * Configuration options for applying changesets to a database.
 * Used with `DatabaseSync.applyChangeset()` to handle conflicts and filter tables.
 */
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
