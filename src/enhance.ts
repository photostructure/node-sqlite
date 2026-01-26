/**
 * Enhancement utilities for adding better-sqlite3-style methods to any
 * compatible database, including `node:sqlite` DatabaseSync and this package's
 * DatabaseSync.
 *
 * This module provides the `enhance()` function which adds `.pragma()` and
 * `.transaction()` methods to database instances that don't have them (e.g.,
 * node:sqlite DatabaseSync).
 */

import { createTransaction } from "./transaction";
import type { PragmaOptions } from "./types/pragma-options";
import type { TransactionFunction } from "./types/transaction";

/**
 * Minimal interface for a database that can be enhanced. This matches the
 * subset of functionality needed by pragma() and transaction().
 */
export interface EnhanceableDatabaseSync {
  /** Execute SQL without returning results */
  exec(sql: string): void;
  /** Prepare a statement that can return results */
  prepare(sql: string): { all(): unknown[] };
  /** Whether a transaction is currently active */
  readonly isTransaction: boolean;
}

/**
 * Interface for an enhanced database with pragma() and transaction() methods.
 */
export interface EnhancedMethods {
  /**
   * Executes a PRAGMA statement and returns its result.
   *
   * @param source The PRAGMA command (without "PRAGMA" prefix)
   * @param options Optional configuration
   * @returns Array of rows, or single value if `simple: true`
   *
   * @example
   * ```typescript
   * db.pragma('cache_size', { simple: true }); // -16000
   * db.pragma('journal_mode = wal');
   * ```
   */
  pragma(source: string, options?: PragmaOptions): unknown;

  /**
   * Creates a function that always runs inside a transaction.
   *
   * @param fn The function to wrap in a transaction
   * @returns A transaction function with `.deferred`, `.immediate`,
   * `.exclusive` variants
   *
   * @example
   * ```typescript
   * const insertMany = db.transaction((items) => {
   *   for (const item of items) insert.run(item);
   * });
   * insertMany(['a', 'b', 'c']); // All in one transaction
   * ```
   */
  transaction<F extends (...args: any[]) => any>(fn: F): TransactionFunction<F>;
}

/**
 * A database instance that has been enhanced with pragma() and transaction() methods.
 */
export type EnhancedDatabaseSync<T extends EnhanceableDatabaseSync> = T &
  EnhancedMethods;

/**
 * Implementation of pragma() that works on any EnhanceableDatabaseSync.
 */
function pragmaImpl(
  this: EnhanceableDatabaseSync,
  source: string,
  options?: PragmaOptions,
): unknown {
  if (typeof source !== "string") {
    throw new TypeError("Expected first argument to be a string");
  }
  if (options != null && typeof options !== "object") {
    throw new TypeError("Expected second argument to be an options object");
  }

  const simple = options?.simple === true;

  // Validate that simple is a boolean if provided
  if (
    options != null &&
    "simple" in options &&
    typeof options.simple !== "boolean"
  ) {
    throw new TypeError('Expected the "simple" option to be a boolean');
  }

  const stmt = this.prepare(`PRAGMA ${source}`);
  const rows = stmt.all() as Record<string, unknown>[];

  if (simple) {
    // Return the first column of the first row, or undefined if no rows
    const firstRow = rows[0];
    if (firstRow == null) {
      return undefined;
    }
    const keys = Object.keys(firstRow);
    const firstKey = keys[0];
    if (firstKey == null) {
      return undefined;
    }
    return firstRow[firstKey];
  }

  return rows;
}

/**
 * Implementation of transaction() that works on any EnhanceableDatabaseSync.
 */
function transactionImpl<F extends (...args: any[]) => any>(
  this: EnhanceableDatabaseSync,
  fn: F,
): TransactionFunction<F> {
  // createTransaction expects DatabaseSyncInstance but only uses the subset
  // defined in EnhanceableDatabaseSync, so this cast is safe
  return createTransaction(this as any, fn);
}

/**
 * Checks if a database instance already has the enhanced methods.
 */
function hasEnhancedMethods(
  db: EnhanceableDatabaseSync,
): db is EnhanceableDatabaseSync & EnhancedMethods {
  return (
    typeof (db as any).pragma === "function" &&
    typeof (db as any).transaction === "function"
  );
}

/**
 * Ensures that `.pragma()` and `.transaction()` methods are available on the
 * given database.
 *
 * This function can enhance:
 * - `node:sqlite` DatabaseSync instances (adds the methods)
 * - `@photostructure/sqlite` DatabaseSync instances (no-op, already has these
 *   methods)
 * - Any object with compatible `exec()`, `prepare()`, and `isTransaction`
 *
 * The enhancement is done by adding methods directly to the instance, not the
 * prototype, so it won't affect other instances or the original class.
 *
 * @param db The database instance to enhance
 * @returns The same instance with `.pragma()` and `.transaction()` methods
 * guaranteed
 *
 * @example
 * ```typescript
 * // With node:sqlite
 * import { DatabaseSync } from 'node:sqlite';
 * import { enhance } from '@photostructure/sqlite';
 *
 * const db = enhance(new DatabaseSync(':memory:'));
 *
 * // Now you can use better-sqlite3-style methods
 * db.pragma('journal_mode = wal');
 * const insertMany = db.transaction((items) => {
 *   for (const item of items) insert.run(item);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With @photostructure/sqlite (no-op, already enhanced)
 * import { DatabaseSync, enhance } from '@photostructure/sqlite';
 *
 * const db = enhance(new DatabaseSync(':memory:'));
 * // db already had these methods, enhance() just returns it unchanged
 * ```
 */
export function enhance<T extends EnhanceableDatabaseSync>(
  db: T,
): EnhancedDatabaseSync<T> {
  // If already enhanced, return as-is
  if (hasEnhancedMethods(db)) {
    return db;
  }

  // Add methods directly to the instance
  // Using Object.defineProperty to make them non-enumerable like native methods
  Object.defineProperty(db, "pragma", {
    value: pragmaImpl,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  Object.defineProperty(db, "transaction", {
    value: transactionImpl,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  return db as EnhancedDatabaseSync<T>;
}

/**
 * Type guard to check if a database has enhanced methods.
 *
 * @param db The database to check
 * @returns True if the database has `.pragma()` and `.transaction()` methods
 *
 * @example
 * ```typescript
 * import { isEnhanced } from '@photostructure/sqlite';
 *
 * if (isEnhanced(db)) {
 *   db.pragma('cache_size', { simple: true });
 * }
 * ```
 */
export function isEnhanced(
  db: EnhanceableDatabaseSync,
): db is EnhanceableDatabaseSync & EnhancedMethods {
  return hasEnhancedMethods(db);
}
