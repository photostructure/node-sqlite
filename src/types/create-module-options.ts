/**
 * A column of a virtual table registered with `DatabaseSync.createModule()`.
 */
export interface VirtualTableColumn {
  /** The column name. */
  readonly name: string;
  /**
   * The declared type of the column. A virtual table does not apply column
   * affinity: a JavaScript number is stored as REAL and a BigInt as INTEGER,
   * whatever the declared type.
   */
  readonly type: "INTEGER" | "TEXT" | "REAL" | "BLOB" | "ANY";
  /**
   * If `true`, the column is a parameter rather than data: its value comes from
   * table-valued function syntax, such as `SELECT * FROM name(1, 10)`, and is
   * passed to `rows`. @default false
   */
  readonly hidden?: boolean;
}

/**
 * Configuration for `DatabaseSync.createModule()`, which registers a SQLite
 * virtual table module whose rows come from JavaScript.
 */
export interface CreateModuleOptions {
  /** The table's columns, in order. Must not be empty. */
  readonly columns: readonly VirtualTableColumn[];
  /**
   * Called each time SQLite scans the table. Receives one argument per hidden
   * column, in the order the columns are defined, with `null` for any the
   * query did not constrain. Returns an iterable or an iterator, such as an
   * array or a generator, of rows. Each row is an array of the visible
   * columns' values, in order.
   *
   * When SQLite stops reading early, for example for `LIMIT`, the iterator's
   * `return()` method is called, so a generator's `finally` block runs.
   */
  readonly rows: (
    ...parameters: any[]
  ) => Iterable<ArrayLike<unknown>> | Iterator<ArrayLike<unknown>>;
  /**
   * If `true`, the table can only be used in top-level SQL statements, not in
   * triggers or views. @default false
   */
  readonly directOnly?: boolean;
  /** If `true`, integer parameters are passed to `rows` as `BigInt`s. @default false */
  readonly useBigIntArguments?: boolean;
}
