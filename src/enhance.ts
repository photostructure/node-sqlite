/**
 * Enhancement utilities for adding better-sqlite3-style methods to any
 * compatible database, including `node:sqlite` DatabaseSync and this package's
 * DatabaseSync.
 *
 * This module provides the `enhance()` function which adds `.pragma()`,
 * `.transaction()`, and statement modes (`.pluck()`, `.raw()`, `.expand()`)
 * to database instances that don't have them (e.g., node:sqlite DatabaseSync).
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
  /** Whether the database connection is open */
  readonly isOpen?: boolean;
  /** Whether a transaction is currently active */
  readonly isTransaction: boolean;
}

/**
 * Statement mode matching better-sqlite3's mutually exclusive modes.
 * - "flat": Default — rows as `{ column: value }` objects
 * - "pluck": First column value only
 * - "raw": Rows as arrays of values
 * - "expand": Rows namespaced by table, e.g. `{ users: { id: 1 }, posts: { title: "..." } }`
 */
type StatementMode = "flat" | "pluck" | "raw" | "expand";

/**
 * A statement enhanced with better-sqlite3-style `.pluck()`, `.raw()`, and
 * `.expand()` methods. These are mutually exclusive — enabling one disables
 * the others.
 */
export interface EnhancedStatementMethods {
  /**
   * Causes the statement to return only the first column value of each row.
   *
   * When plucking is turned on, raw and expand modes are turned off.
   *
   * @param toggle Enable (true) or disable (false) pluck mode. Defaults to true.
   * @returns The same statement for chaining.
   *
   * @example
   * ```typescript
   * const count = db.prepare("SELECT COUNT(*) FROM users").pluck().get();
   * // Returns: 42 (not { "COUNT(*)": 42 })
   *
   * const names = db.prepare("SELECT name FROM users").pluck().all();
   * // Returns: ["Alice", "Bob"] (not [{ name: "Alice" }, { name: "Bob" }])
   * ```
   */
  pluck(toggle?: boolean): this;

  /**
   * Causes the statement to return rows as arrays of values instead of objects.
   *
   * When raw mode is turned on, pluck and expand modes are turned off.
   *
   * @param toggle Enable (true) or disable (false) raw mode. Defaults to true.
   * @returns The same statement for chaining.
   *
   * @example
   * ```typescript
   * const rows = db.prepare("SELECT id, name FROM users").raw().all();
   * // Returns: [[1, "Alice"], [2, "Bob"]] (not [{ id: 1, name: "Alice" }, ...])
   * ```
   */
  raw(toggle?: boolean): this;

  /**
   * Causes the statement to return data namespaced by table. Each key in a row
   * object will be a table name, and each corresponding value will be a nested
   * object containing that table's columns. Columns from expressions or
   * subqueries are placed under the special `$` namespace.
   *
   * When expand mode is turned on, pluck and raw modes are turned off.
   *
   * Requires the statement to have a `.columns()` method (available on real
   * statements but not minimal mocks).
   *
   * @param toggle Enable (true) or disable (false) expand mode. Defaults to true.
   * @returns The same statement for chaining.
   *
   * @example
   * ```typescript
   * const rows = db.prepare("SELECT u.id, u.name, p.title FROM users u JOIN posts p ON ...").expand().all();
   * // Returns: [{ users: { id: 1, name: "Alice" }, posts: { title: "Hello" } }]
   * ```
   */
  expand(toggle?: boolean): this;

  /** The database instance this statement was prepared from. */
  readonly database: EnhanceableDatabaseSync;
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
 * A database instance that has been enhanced with pragma(), transaction(),
 * and statement modes (pluck/raw/expand) on statements returned by prepare().
 */
export type EnhancedDatabaseSync<T extends EnhanceableDatabaseSync> = Omit<
  T,
  "prepare"
> &
  EnhancedMethods & {
    prepare(
      ...args: Parameters<T["prepare"]>
    ): ReturnType<T["prepare"]> & EnhancedStatementMethods;
  };

/** Symbol to track whether prepare() has been wrapped */
const ENHANCED_PREPARE = Symbol.for("@photostructure/sqlite:enhancedPrepare");

/**
 * Extract the first column value from a row object or array.
 */
function extractFirstColumn(row: unknown): unknown {
  if (row == null) return row;
  if (Array.isArray(row)) return row[0];
  const keys = Object.keys(row as Record<string, unknown>);
  return keys.length > 0
    ? (row as Record<string, unknown>)[keys[0]!]
    : undefined;
}

/**
 * Build a column-to-table mapping from statement metadata, used by expand mode.
 * Returns an array parallel to column order: each entry is the table name
 * (or "$" for expressions/subqueries) and the column name.
 */
function buildColumnTableMap(
  stmt: any,
): Array<{ table: string; column: string }> | undefined {
  if (typeof stmt.columns !== "function") return undefined;
  const cols: Array<{ name: string; table: string | null }> = stmt.columns();
  return cols.map((c) => ({
    table: c.table ?? "$",
    column: c.name,
  }));
}

/**
 * Transform a row array into a table-namespaced expanded object.
 * Uses array indices to match columns, avoiding data loss from duplicate names.
 */
function expandRowFromArray(
  row: unknown[],
  columnMap: Array<{ table: string; column: string }>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < columnMap.length && i < row.length; i++) {
    const { table, column } = columnMap[i]!; // eslint-disable-line security/detect-object-injection
    // eslint-disable-next-line security/detect-object-injection -- table/column from our own columnMap
    result[table] ??= {};
    result[table]![column] = row[i]; // eslint-disable-line security/detect-object-injection
  }
  return result;
}

/**
 * Transform a flat row object into a table-namespaced expanded object.
 * Fallback for mocks without setReturnArrays — cannot handle duplicate column
 * names correctly, but mocks typically don't produce them.
 */
function expandRowFromObject(
  row: Record<string, unknown>,
  columnMap: Array<{ table: string; column: string }>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length && i < columnMap.length; i++) {
    const { table, column } = columnMap[i]!; // eslint-disable-line security/detect-object-injection
    // eslint-disable-next-line security/detect-object-injection -- table/column from our own columnMap
    result[table] ??= {};
    result[table]![column] = row[keys[i]!]; // eslint-disable-line security/detect-object-injection
  }
  return result;
}

/**
 * Validate a boolean toggle argument, matching better-sqlite3's pattern.
 */
function validateToggle(value: unknown): boolean {
  const use = value === undefined ? true : value;
  if (typeof use !== "boolean") {
    throw new TypeError("Expected first argument to be a boolean");
  }
  return use;
}

/**
 * Transform a row based on the current statement mode.
 */
function transformRow(
  row: unknown,
  mode: StatementMode,
  columnMap: Array<{ table: string; column: string }> | undefined,
): unknown {
  if (row == null || mode === "flat") return row;
  if (mode === "pluck") return extractFirstColumn(row);
  if (mode === "expand") {
    // columnMap is guaranteed non-null here — setMode() throws if columns() is
    // unavailable, so we'll never reach this branch with columnMap == null.
    // Prefer array-based expand (used when setReturnArrays is available)
    // to correctly handle duplicate column names across tables.
    // Fall back to object-based expand for mocks without setReturnArrays.
    if (Array.isArray(row)) {
      return expandRowFromArray(row, columnMap!);
    }
    return expandRowFromObject(row as Record<string, unknown>, columnMap!);
  }
  // "raw" mode is handled natively by setReturnArrays(), so no transform needed
  return row;
}

/**
 * Add `.pluck()`, `.raw()`, and `.expand()` methods to a statement instance.
 * These modes are mutually exclusive — enabling one disables the others,
 * matching better-sqlite3's behavior.
 */
function enhanceStatement<S extends { all(): unknown[] }>(
  stmt: S,
): S & EnhancedStatementMethods {
  // Idempotency: if already enhanced, return as-is
  if (typeof (stmt as any).pluck === "function") {
    return stmt as S & EnhancedStatementMethods;
  }

  let mode: StatementMode = "flat";
  let columnMap: Array<{ table: string; column: string }> | undefined;

  // Cast to any to avoid TypeScript strictness around bound method signatures.
  // At runtime these are native C++ methods that accept variadic bind parameters.
  const originalGet: any =
    typeof (stmt as any).get === "function"
      ? (stmt as any).get.bind(stmt)
      : undefined;
  const originalAll: any = (stmt as any).all.bind(stmt);
  const originalIterate: any =
    typeof (stmt as any).iterate === "function"
      ? (stmt as any).iterate.bind(stmt)
      : undefined;

  // Toggle helper matching better-sqlite3's mode switching:
  // enable(true) sets to target mode; enable(false) resets to flat ONLY if
  // currently in that mode, otherwise leaves mode unchanged.
  function setMode(target: StatementMode, use: boolean): void {
    if (use) {
      mode = target;
      // Cache column map on first expand() call
      if (target === "expand" && columnMap == null) {
        columnMap = buildColumnTableMap(stmt);
        if (columnMap == null) {
          throw new TypeError(
            "expand() requires the statement to have a columns() method",
          );
        }
      }
    } else if (mode === target) {
      mode = "flat";
    }
    // If use=false and mode !== target, no-op (matches better-sqlite3)

    // Sync native array mode: both raw and expand need arrays from the native layer.
    // Expand needs arrays to correctly handle duplicate column names across tables.
    if (typeof (stmt as any).setReturnArrays === "function") {
      (stmt as any).setReturnArrays(mode === "raw" || mode === "expand");
    }
  }

  Object.defineProperty(stmt, "pluck", {
    value: function pluck(toggle?: boolean): S {
      setMode("pluck", validateToggle(toggle));
      return stmt;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  Object.defineProperty(stmt, "raw", {
    value: function raw(toggle?: boolean): S {
      setMode("raw", validateToggle(toggle));
      return stmt;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  Object.defineProperty(stmt, "expand", {
    value: function expand(toggle?: boolean): S {
      setMode("expand", validateToggle(toggle));
      return stmt;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  if (originalGet != null) {
    Object.defineProperty(stmt, "get", {
      value: (...params: any[]) => {
        const row = originalGet(...params);
        return transformRow(row, mode, columnMap);
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  Object.defineProperty(stmt, "all", {
    value: (...params: any[]) => {
      const rows = originalAll(...params);
      if (mode === "flat" || mode === "raw") return rows;
      return rows.map((row: unknown) => transformRow(row, mode, columnMap));
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  if (originalIterate != null) {
    Object.defineProperty(stmt, "iterate", {
      value: function* (...params: any[]) {
        const iter = originalIterate(...params);
        for (const row of iter) {
          yield transformRow(row, mode, columnMap);
        }
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  return stmt as S & EnhancedStatementMethods;
}

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

  if (simple) {
    return extractFirstColumn(stmt.all()[0]);
  }

  return stmt.all();
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
 * Ensures that `.pragma()`, `.transaction()`, and statement modes
 * (`.pluck()`, `.raw()`, `.expand()`) are available on the given database.
 *
 * This function can enhance:
 * - `node:sqlite` DatabaseSync instances (adds the methods)
 * - `@photostructure/sqlite` DatabaseSync instances (adds the methods)
 * - Any object with compatible `exec()`, `prepare()`, and `isTransaction`
 *
 * The enhancement is done by adding methods directly to the instance, not the
 * prototype, so it won't affect other instances or the original class.
 *
 * @param db The database instance to enhance
 * @returns The same instance with `.pragma()`, `.transaction()`, and
 * `.pluck()` / `.raw()` / `.expand()` (on prepared statements) guaranteed
 *
 * @example
 * ```typescript
 * import { DatabaseSync, enhance } from '@photostructure/sqlite';
 *
 * const db = enhance(new DatabaseSync(':memory:'));
 *
 * // better-sqlite3-style pragma
 * db.pragma('journal_mode = wal');
 *
 * // better-sqlite3-style transactions
 * const insertMany = db.transaction((items) => {
 *   for (const item of items) insert.run(item);
 * });
 *
 * // better-sqlite3-style pluck
 * const count = db.prepare("SELECT COUNT(*) FROM users").pluck().get();
 * const names = db.prepare("SELECT name FROM users").pluck().all();
 * ```
 */
export function enhance<T extends EnhanceableDatabaseSync>(
  db: T,
): EnhancedDatabaseSync<T> {
  // Add pragma and transaction if not already present
  if (!hasEnhancedMethods(db)) {
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
  }

  // Wrap prepare() to add pluck() to returned statements
  // eslint-disable-next-line security/detect-object-injection -- ENHANCED_PREPARE is a Symbol
  if (!(db as any)[ENHANCED_PREPARE]) {
    const originalPrepare: any = db.prepare.bind(db);

    Object.defineProperty(db, "prepare", {
      value: (...args: any[]) => {
        const stmt = originalPrepare(...args);
        enhanceStatement(stmt);
        // Add stmt.database back-reference for better-sqlite3 compat
        Object.defineProperty(stmt, "database", {
          value: db,
          writable: false,
          configurable: true,
          enumerable: false,
        });
        return stmt;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });

    Object.defineProperty(db, ENHANCED_PREPARE, {
      value: true,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  return db as unknown as EnhancedDatabaseSync<T>;
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
