import { LRUCache } from "./lru-cache";
import { DatabaseSyncInstance } from "./types/database-sync-instance";
import type { StatementSyncInstance } from "./types/statement-sync-instance";

/**
 * Default capacity for the statement cache.
 * Matches Node.js SQLTagStore default.
 */
const DEFAULT_CAPACITY = 1000;

/**
 * node:sqlite's tag store binds only template expressions, so a `?` or `:name`
 * written into the SQL text itself would silently bind undefined. Reject that
 * the way the native implementation does, by comparing SQLite's parameter
 * count against the number of template values.
 */
function checkPlaceholders(
  stmt: StatementSyncInstance,
  valueCount: number,
): void {
  const paramCount = (stmt as unknown as Record<symbol, number>)[
    PARAMETER_COUNT
  ];
  if (paramCount !== valueCount) {
    const err = new TypeError(
      "SQLite parameters must be bound using template literal placeholders.",
    );
    (err as NodeJS.ErrnoException).code = "ERR_INVALID_ARG_VALUE";
    throw err;
  }
}

const IN_AUTHORIZER_CALLBACK = Symbol.for(
  "photostructure.sqlite.inAuthorizerCallback",
);
const PARAMETER_COUNT = Symbol.for("photostructure.sqlite.parameterCount");
const STATEMENT_FINALIZED = Symbol.for("photostructure.sqlite.finalized");

/**
 * SQLite forbids modifying a connection from inside its own authorizer
 * callback. node:sqlite's native SQLTagStore rejects createTagStore() there;
 * this reads the same state through an internal Symbol-keyed accessor.
 */
function throwIfInAuthorizerCallback(db: DatabaseSyncInstance): void {
  if ((db as unknown as Record<symbol, boolean>)[IN_AUTHORIZER_CALLBACK]) {
    const err = new Error(
      "database cannot be accessed from an authorizer callback",
    );
    (err as NodeJS.ErrnoException).code = "ERR_INVALID_STATE";
    throw err;
  }
}

/**
 * Mirrors the native `maxSize` validation in node:sqlite's createTagStore():
 * a non-number is a type error, anything that is not a positive int32 is out of
 * range.
 */
function validateMaxSize(maxSize: number): void {
  if (typeof maxSize !== "number") {
    const err = new TypeError(
      'The "maxSize" argument must be a positive integer.',
    );
    (err as NodeJS.ErrnoException).code = "ERR_INVALID_ARG_TYPE";
    throw err;
  }
  if (!Number.isInteger(maxSize) || maxSize <= 0 || maxSize > 0x7fffffff) {
    const err = new RangeError(
      'The "maxSize" argument must be a positive integer.',
    );
    (err as NodeJS.ErrnoException).code = "ERR_OUT_OF_RANGE";
    throw err;
  }
}

/**
 * SQLTagStore provides cached prepared statements via tagged template syntax.
 *
 * @example
 * ```js
 * const sql = db.createTagStore();
 * sql.run`INSERT INTO users VALUES (${id}, ${name})`;
 * const user = sql.get`SELECT * FROM users WHERE id = ${id}`;
 * ```
 */
export class SQLTagStore {
  private readonly database: DatabaseSyncInstance;
  private readonly cache: LRUCache<string, StatementSyncInstance>;
  private readonly maxCapacity: number;

  constructor(db: DatabaseSyncInstance, capacity: number = DEFAULT_CAPACITY) {
    if (!db.isOpen) {
      const err = new Error("database is not open");
      (err as NodeJS.ErrnoException).code = "ERR_INVALID_STATE";
      throw err;
    }
    throwIfInAuthorizerCallback(db);
    validateMaxSize(capacity);
    this.database = db;
    this.maxCapacity = capacity;
    this.cache = new LRUCache(capacity);
  }

  /**
   * Returns the associated database instance.
   */
  get db(): DatabaseSyncInstance {
    return this.database;
  }

  /**
   * Returns the maximum capacity of the statement cache.
   */
  get capacity(): number {
    return this.maxCapacity;
  }

  /**
   * Returns the current number of cached statements.
   */
  get size(): number {
    return this.cache.size();
  }

  /**
   * Clears all cached statements.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Execute an INSERT, UPDATE, DELETE or other statement that doesn't return rows.
   * Returns an object with `changes` and `lastInsertRowid`.
   */
  run(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.getOrPrepare(strings, values.length);
    return stmt.run(...values);
  }

  /**
   * Execute a query and return the first row, or undefined if no rows.
   */
  get(strings: TemplateStringsArray, ...values: unknown[]): unknown {
    const stmt = this.getOrPrepare(strings, values.length);
    return stmt.get(...values);
  }

  /**
   * Execute a query and return all rows as an array.
   */
  all(strings: TemplateStringsArray, ...values: unknown[]): unknown[] {
    const stmt = this.getOrPrepare(strings, values.length);
    return stmt.all(...values);
  }

  /**
   * Execute a query and return an iterator over the rows.
   */
  iterate(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): IterableIterator<unknown> {
    const stmt = this.getOrPrepare(strings, values.length);
    return stmt.iterate(...values);
  }

  /**
   * Get a cached statement or prepare a new one.
   */
  private getOrPrepare(
    strings: TemplateStringsArray,
    valueCount: number,
  ): StatementSyncInstance {
    if (!this.database.isOpen) {
      const err = new Error("database is not open");
      (err as NodeJS.ErrnoException).code = "ERR_INVALID_STATE";
      throw err;
    }
    throwIfInAuthorizerCallback(this.database);

    const sql = this.buildSQL(strings);

    // Closing the database finalizes every statement it prepared, including
    // the ones cached here. Re-prepare rather than hand back a dead statement.
    const cached = this.cache.get(sql);
    if (cached != null) {
      if (
        !(cached as unknown as Record<symbol, boolean>)[STATEMENT_FINALIZED]
      ) {
        checkPlaceholders(cached, valueCount);
        return cached;
      }
      this.cache.delete(sql);
    }

    // A rejected statement must not be cached, so validate before inserting.
    const stmt = this.database.prepare(sql);
    checkPlaceholders(stmt, valueCount);
    this.cache.set(sql, stmt);
    return stmt;
  }

  /**
   * Build the SQL string by joining template parts with `?` placeholders.
   */
  private buildSQL(strings: TemplateStringsArray): string {
    let sql = strings[0] ?? "";
    for (let i = 1; i < strings.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- Index is from controlled for-loop
      sql += "?" + (strings[i] ?? "");
    }
    return sql;
  }
}
