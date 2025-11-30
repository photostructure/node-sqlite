/**
 * SQLite database open flags.
 *
 * **Note:** These constants are an extension beyond `node:sqlite`.
 * The `node:sqlite` module does not export `SQLITE_OPEN_*` constants.
 *
 * @see https://sqlite.org/c3ref/open.html
 */
export interface SqliteOpenFlags {
  /** Open database for reading only. */
  SQLITE_OPEN_READONLY: number;
  /** Open database for reading and writing. */
  SQLITE_OPEN_READWRITE: number;
  /** Create database if it doesn't exist. */
  SQLITE_OPEN_CREATE: number;
  /** Delete database file on close. */
  SQLITE_OPEN_DELETEONCLOSE: number;
  /** Open with exclusive access. */
  SQLITE_OPEN_EXCLUSIVE: number;
  /** Use automatic proxy for locking. */
  SQLITE_OPEN_AUTOPROXY: number;
  /** Interpret filename as URI. */
  SQLITE_OPEN_URI: number;
  /** Open in-memory database. */
  SQLITE_OPEN_MEMORY: number;
  /** Open main database file. */
  SQLITE_OPEN_MAIN_DB: number;
  /** Open temporary database file. */
  SQLITE_OPEN_TEMP_DB: number;
  /** Open transient in-memory database. */
  SQLITE_OPEN_TRANSIENT_DB: number;
  /** Open main journal file. */
  SQLITE_OPEN_MAIN_JOURNAL: number;
  /** Open temporary journal file. */
  SQLITE_OPEN_TEMP_JOURNAL: number;
  /** Open subjournal file. */
  SQLITE_OPEN_SUBJOURNAL: number;
  /** Open super-journal file. */
  SQLITE_OPEN_SUPER_JOURNAL: number;
  /** Open without mutex. */
  SQLITE_OPEN_NOMUTEX: number;
  /** Open with full mutex. */
  SQLITE_OPEN_FULLMUTEX: number;
  /** Enable shared cache mode. */
  SQLITE_OPEN_SHAREDCACHE: number;
  /** Enable private cache mode. */
  SQLITE_OPEN_PRIVATECACHE: number;
  /** Open WAL file. */
  SQLITE_OPEN_WAL: number;
}
