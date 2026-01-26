import type { DatabaseSyncInstance } from "./database-sync-instance";

/**
 * Transaction isolation modes supported by SQLite.
 *
 * @see https://sqlite.org/lang_transaction.html
 */
export type TransactionMode = "deferred" | "immediate" | "exclusive";

/**
 * A function wrapped in a transaction. When called, it automatically:
 * - Begins a transaction (or savepoint if nested)
 * - Executes the wrapped function
 * - Commits on success, rolls back on error
 *
 * The function also has variants for different transaction modes accessible as
 * properties (`.deferred`, `.immediate`, `.exclusive`).
 *
 * **Note:** Each variant is itself a `TransactionFunction` with circular
 * references to all other variants. This matches better-sqlite3's behavior
 * where you can chain variants like `txn.deferred.immediate()` - the last
 * variant in the chain determines the actual transaction mode used.
 *
 * @example
 * ```typescript
 * const insertMany = db.transaction((items: Item[]) => {
 *   for (const item of items) insert.run(item);
 *   return items.length;
 * });
 *
 * // Use default mode (DEFERRED)
 * insertMany([{ id: 1 }, { id: 2 }]);
 *
 * // Use IMMEDIATE mode for write transactions
 * insertMany.immediate([{ id: 3 }, { id: 4 }]);
 *
 * // Use EXCLUSIVE mode for exclusive access
 * insertMany.exclusive([{ id: 5 }, { id: 6 }]);
 * ```
 */
export interface TransactionFunction<F extends (...args: any[]) => any> {
  /**
   * Execute the wrapped function within a transaction using the default mode (DEFERRED).
   */
  (...args: Parameters<F>): ReturnType<F>;

  /**
   * Execute with DEFERRED transaction mode.
   * The database lock is not acquired until the first read or write operation.
   * This is the default SQLite behavior.
   */
  readonly deferred: TransactionFunction<F>;

  /**
   * Execute with IMMEDIATE transaction mode.
   * Acquires a write lock immediately, blocking other writers.
   * Recommended for transactions that will write to prevent SQLITE_BUSY errors.
   */
  readonly immediate: TransactionFunction<F>;

  /**
   * Execute with EXCLUSIVE transaction mode.
   * Acquires an exclusive lock immediately, blocking all other connections.
   * Use sparingly as it prevents all concurrent access.
   */
  readonly exclusive: TransactionFunction<F>;

  /**
   * The database connection this transaction function is bound to.
   */
  readonly database: DatabaseSyncInstance;
}
