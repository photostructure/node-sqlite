/**
 * A prepared SQL statement that can be executed multiple times with different parameters.
 * This interface represents an instance of the StatementSync class.
 */
export interface StatementSyncInstance {
  /** The original SQL source string. */
  readonly sourceSQL: string;
  /** The expanded SQL string with bound parameters, if expandedSQL option was set. */
  readonly expandedSQL: string | undefined;
  /** Whether this statement has been finalized. */
  readonly finalized: boolean;
  /**
   * This method executes a prepared statement and returns an object.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An object with the number of changes and the last insert rowid.
   */
  run(...parameters: any[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  /**
   * This method executes a prepared statement and returns the first result row.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns The first row from the query results, or undefined if no rows.
   */
  get(...parameters: any[]): any;
  /**
   * This method executes a prepared statement and returns all results as an array.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An array of row objects from the query results.
   */
  all(...parameters: any[]): any[];
  /**
   * This method executes a prepared statement and returns an iterable iterator of objects.
   * Each object represents a row from the query results.
   * @param parameters Optional named and anonymous parameters to bind to the statement.
   * @returns An iterable iterator of row objects.
   */
  iterate(...parameters: any[]): IterableIterator<any>;
  /**
   * Set whether to read integer values as JavaScript BigInt.
   * @param readBigInts If true, read integers as BigInts. @default false
   */
  setReadBigInts(readBigInts: boolean): void;
  /**
   * Set whether to allow bare named parameters in SQL.
   * @param allowBareNamedParameters If true, allows bare named parameters. @default false
   */
  setAllowBareNamedParameters(allowBareNamedParameters: boolean): void;
  /**
   * Set whether to allow unknown named parameters in SQL.
   * @param enabled If true, unknown named parameters are ignored. If false, they throw an error. @default false
   */
  setAllowUnknownNamedParameters(enabled: boolean): void;
  /**
   * Set whether to return results as arrays rather than objects.
   * @param returnArrays If true, return results as arrays. @default false
   */
  setReturnArrays(returnArrays: boolean): void;
  /**
   * Returns an array of objects, each representing a column in the statement's result set.
   * Each object has a 'name' property for the column name and a 'type' property for the SQLite type.
   * @returns Array of column metadata objects.
   */
  columns(): Array<{ name: string; type?: string }>;
  /**
   * Finalizes the prepared statement and releases its resources.
   * Called automatically by Symbol.dispose.
   */
  finalize(): void;
  /** Dispose of the statement resources using the explicit resource management protocol. */
  [Symbol.dispose](): void;
}
