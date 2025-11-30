/**
 * Authorization callback return values for `setAuthorizer()`.
 *
 * These constants are compatible with `node:sqlite`.
 *
 * @see https://sqlite.org/c3ref/c_deny.html
 */
export interface SqliteAuthorizationResults {
  /** Allow the operation. */
  SQLITE_OK: number;
  /** Deny the operation and abort the SQL statement with an error. */
  SQLITE_DENY: number;
  /** Silently ignore/skip the operation (e.g., return NULL for column reads). */
  SQLITE_IGNORE: number;
}
