import type { DatabaseSyncInstance } from "./types/database-sync-instance";
import type { TransactionFunction, TransactionMode } from "./types/transaction";

/**
 * Internal counter for generating unique savepoint names.
 * Using a global counter ensures uniqueness even with deeply nested transactions.
 */
let savepointCounter = 0;

/**
 * Creates a transaction-wrapped version of a function.
 *
 * When the returned function is called, it will:
 * 1. Begin a transaction (or create a savepoint if already in a transaction)
 * 2. Execute the wrapped function
 * 3. Commit the transaction (or release the savepoint) on success
 * 4. Rollback the transaction (or rollback to savepoint) on error
 *
 * The wrapped function **must not** return a Promise. SQLite transactions are
 * synchronous, and allowing async operations would leave the transaction open
 * across event loop ticks, which is dangerous and can cause deadlocks.
 *
 * @example
 * ```typescript
 * const db = new DatabaseSync(':memory:');
 * db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
 *
 * const insert = db.prepare('INSERT INTO items (name) VALUES (?)');
 *
 * // Create a transaction function
 * const insertMany = db.transaction((names: string[]) => {
 *   for (const name of names) {
 *     insert.run(name);
 *   }
 *   return names.length;
 * });
 *
 * // Execute - automatically wrapped in BEGIN/COMMIT
 * const count = insertMany(['Alice', 'Bob', 'Charlie']);
 * console.log(count); // 3
 *
 * // If an error occurs, automatically rolls back
 * try {
 *   insertMany(['Dave', 'FAIL']); // Assume this throws
 * } catch (e) {
 *   // Transaction was rolled back, Dave was not inserted
 * }
 *
 * // Use different transaction modes
 * insertMany.immediate(['Eve']); // BEGIN IMMEDIATE
 * insertMany.exclusive(['Frank']); // BEGIN EXCLUSIVE
 * ```
 *
 * @param db - The database connection
 * @param fn - The function to wrap in a transaction
 * @returns A transaction function with `.deferred`, `.immediate`, and `.exclusive` variants
 */
export function createTransaction<F extends (...args: any[]) => any>(
  db: DatabaseSyncInstance,
  fn: F,
): TransactionFunction<F> {
  if (typeof fn !== "function") {
    throw new TypeError("Expected first argument to be a function");
  }

  // Create all four variants
  const variants = {
    deferred: createVariant(db, fn, "deferred"),
    immediate: createVariant(db, fn, "immediate"),
    exclusive: createVariant(db, fn, "exclusive"),
  };

  // The default function uses DEFERRED mode (SQLite's default)
  const defaultFn = variants.deferred as TransactionFunction<F>;

  // Set up the variant properties on each function
  // Each variant has access to all other variants
  for (const variant of Object.values(variants)) {
    Object.defineProperties(variant, {
      deferred: { value: variants.deferred, enumerable: true },
      immediate: { value: variants.immediate, enumerable: true },
      exclusive: { value: variants.exclusive, enumerable: true },
      database: { value: db, enumerable: true },
    });
  }

  return defaultFn;
}

/**
 * Creates a single transaction variant for a specific mode.
 */
function createVariant<F extends (...args: any[]) => any>(
  db: DatabaseSyncInstance,
  fn: F,
  mode: TransactionMode,
): (...args: Parameters<F>) => ReturnType<F> {
  const beginStatement = getBeginStatement(mode);

  return function transactionWrapper(
    this: unknown,
    ...args: Parameters<F>
  ): ReturnType<F> {
    // Check if we're already in a transaction (nested transaction)
    const isNested = db.isTransaction;

    let begin: string;
    let commit: string;
    let rollback: string;

    if (isNested) {
      // Use savepoints for nested transactions
      // The savepoint name uses backticks to allow special characters
      // and a counter to ensure uniqueness
      const savepointName = `\`_txn_${++savepointCounter}\``;
      begin = `SAVEPOINT ${savepointName}`;
      commit = `RELEASE ${savepointName}`;
      rollback = `ROLLBACK TO ${savepointName}`;
    } else {
      // Top-level transaction
      begin = beginStatement;
      commit = "COMMIT";
      rollback = "ROLLBACK";
    }

    // Begin the transaction or savepoint
    db.exec(begin);

    try {
      // Execute the wrapped function
      const result = fn.apply(this, args);

      // Check for promises - async functions break transaction semantics
      if (result !== null && typeof result === "object" && "then" in result) {
        throw new TypeError(
          "Transaction function must not return a Promise. " +
            "SQLite transactions are synchronous and cannot span across async operations. " +
            "Use synchronous code within transactions.",
        );
      }

      // Commit the transaction or release the savepoint
      db.exec(commit);

      return result;
    } catch (error) {
      // Only attempt rollback if we're still in a transaction
      // (SQLite may have already rolled back due to constraint violations, etc.)
      if (db.isTransaction) {
        db.exec(rollback);
        // For nested transactions, we also need to release the savepoint
        // after rolling back to it (the savepoint still exists after ROLLBACK TO)
        if (isNested) {
          db.exec(commit);
        }
      }

      throw error;
    }
  };
}

/**
 * Returns the appropriate BEGIN statement for a transaction mode.
 */
function getBeginStatement(mode: TransactionMode): string {
  switch (mode) {
    case "deferred":
      return "BEGIN DEFERRED";
    case "immediate":
      return "BEGIN IMMEDIATE";
    case "exclusive":
      return "BEGIN EXCLUSIVE";
    default:
      // TypeScript should catch this, but just in case
      throw new Error(`Unknown transaction mode: ${mode}`);
  }
}
