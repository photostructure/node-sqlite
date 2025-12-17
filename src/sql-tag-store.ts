import { LRUCache } from "./lru-cache";
import { DatabaseSyncInstance } from "./types/database-sync-instance";
import type { StatementSyncInstance } from "./types/statement-sync-instance";

/**
 * Default capacity for the statement cache.
 * Matches Node.js SQLTagStore default.
 */
const DEFAULT_CAPACITY = 1000;

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
      throw new Error("Database is not open");
    }
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
    const stmt = this.getOrPrepare(strings);
    return stmt.run(...values);
  }

  /**
   * Execute a query and return the first row, or undefined if no rows.
   */
  get(strings: TemplateStringsArray, ...values: unknown[]): unknown {
    const stmt = this.getOrPrepare(strings);
    return stmt.get(...values);
  }

  /**
   * Execute a query and return all rows as an array.
   */
  all(strings: TemplateStringsArray, ...values: unknown[]): unknown[] {
    const stmt = this.getOrPrepare(strings);
    return stmt.all(...values);
  }

  /**
   * Execute a query and return an iterator over the rows.
   */
  iterate(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): IterableIterator<unknown> {
    const stmt = this.getOrPrepare(strings);
    return stmt.iterate(...values);
  }

  /**
   * Get a cached statement or prepare a new one.
   * If a cached statement has been finalized, it's evicted and a new one is prepared.
   */
  private getOrPrepare(strings: TemplateStringsArray): StatementSyncInstance {
    if (!this.database.isOpen) {
      throw new Error("Database is not open");
    }

    const sql = this.buildSQL(strings);

    // Check cache - evict if finalized
    const cached = this.cache.get(sql);
    if (cached) {
      if (!cached.finalized) {
        return cached;
      }
      // Statement was finalized externally - remove from cache
      this.cache.delete(sql);
    }

    // Prepare new statement and cache it
    const stmt = this.database.prepare(sql);
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
