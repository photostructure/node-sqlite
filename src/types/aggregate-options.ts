/**
 * Configuration options for creating SQLite aggregate functions.
 * Used with `DatabaseSync.aggregate()` to define custom aggregate operations.
 */
export interface AggregateOptions {
  /** The initial value for the aggregation. */
  readonly start?: any;
  /** Function called for each row to update the aggregate state. */
  readonly step: (accumulator: any, ...args: any[]) => any;
  /** Optional function for window function support to reverse a step. */
  readonly inverse?: (accumulator: any, ...args: any[]) => any;
  /** Optional function to compute the final result from the accumulator. */
  readonly result?: (accumulator: any) => any;
  /** If `true`, sets the `SQLITE_DETERMINISTIC` flag. @default false */
  readonly deterministic?: boolean;
  /** If `true`, sets the `SQLITE_DIRECTONLY` flag. @default false */
  readonly directOnly?: boolean;
  /** If `true`, converts integer arguments to `BigInt`s. @default false */
  readonly useBigIntArguments?: boolean;
  /** If `true`, allows function to be invoked with variable arguments. @default false */
  readonly varargs?: boolean;
}
