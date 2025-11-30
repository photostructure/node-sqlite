/**
 * Configuration options for opening a database.
 * This interface matches Node.js sqlite module's DatabaseSyncOptions.
 */
export interface DatabaseSyncOptions {
  /** Path to the database file. Use ':memory:' for an in-memory database. */
  readonly location?: string;
  /** If true, the database is opened in read-only mode. @default false */
  readonly readOnly?: boolean;
  /** If true, foreign key constraints are enforced. @default true */
  readonly enableForeignKeyConstraints?: boolean;
  /**
   * If true, double-quoted string literals are allowed.
   *
   * If enabled, double quotes can be misinterpreted as identifiers instead of
   * string literals, leading to confusing errors.
   *
   * **The SQLite documentation strongly recommends avoiding double-quoted
   * strings entirely.**
 
   * @see https://sqlite.org/quirks.html#dblquote
   * @default false
   */
  readonly enableDoubleQuotedStringLiterals?: boolean;
  /**
   * Sets the busy timeout in milliseconds.
   * @default 5000
   */
  readonly timeout?: number;
  /** If true, enables loading of SQLite extensions. @default false */
  readonly allowExtension?: boolean;
  /**
   * If true, SQLite integers are returned as JavaScript BigInt values.
   * If false, integers are returned as JavaScript numbers.
   * @default false
   */
  readonly readBigInts?: boolean;
  /**
   * If true, query results are returned as arrays instead of objects.
   * @default false
   */
  readonly returnArrays?: boolean;
  /**
   * If true, allows binding named parameters without the prefix character.
   * For example, allows using 'foo' instead of ':foo' or '$foo'.
   * @default true
   */
  readonly allowBareNamedParameters?: boolean;
  /**
   * If true, unknown named parameters are ignored during binding.
   * If false, an exception is thrown for unknown named parameters.
   * @default false
   */
  readonly allowUnknownNamedParameters?: boolean;
  /**
   * If true, enables the defensive flag. When the defensive flag is enabled,
   * language features that allow ordinary SQL to deliberately corrupt the
   * database file are disabled. The defensive flag can also be set using
   * `enableDefensive()`.
   * @see https://sqlite.org/c3ref/c_dbconfig_defensive.html
   * @default false
   */
  readonly defensive?: boolean;
  /**
   * If true, the database is opened immediately. If false, the database is not opened until the first operation.
   * @default true
   */
  readonly open?: boolean;
}
