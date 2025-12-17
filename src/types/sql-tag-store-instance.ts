import { DatabaseSyncInstance } from "./database-sync-instance";

/**
 * SQLTagStore provides cached prepared statements via tagged template syntax.
 * Statements are cached by their SQL string and reused across invocations.
 */
export interface SQLTagStoreInstance {
  /** Returns the associated database instance. */
  readonly db: DatabaseSyncInstance;
  /** Returns the maximum capacity of the statement cache. */
  readonly capacity: number;
  /**
   * Returns the current number of cached statements.
   */
  readonly size: number;
  /**
   * Clears all cached statements.
   */
  clear(): void;
  /**
   * Execute an INSERT, UPDATE, DELETE or other statement that doesn't return rows.
   * @param strings Template literal strings array.
   * @param values Values to bind to the placeholders.
   * @returns An object with `changes` and `lastInsertRowid`.
   */
  run(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): { changes: number; lastInsertRowid: number | bigint };
  /**
   * Execute a query and return the first row, or undefined if no rows.
   * @param strings Template literal strings array.
   * @param values Values to bind to the placeholders.
   */
  get(strings: TemplateStringsArray, ...values: unknown[]): unknown;
  /**
   * Execute a query and return all rows as an array.
   * @param strings Template literal strings array.
   * @param values Values to bind to the placeholders.
   */
  all(strings: TemplateStringsArray, ...values: unknown[]): unknown[];
  /**
   * Execute a query and return an iterator over the rows.
   * @param strings Template literal strings array.
   * @param values Values to bind to the placeholders.
   */
  iterate(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): IterableIterator<unknown>;
}
