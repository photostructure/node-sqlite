import { DatabaseSync } from "@photostructure/sqlite";
import Database from "better-sqlite3";
import deasync from "deasync";
import { promisify } from "node:util";
import sqlite3 from "sqlite3";

// Track if node:sqlite is available
let nodeSqliteAvailable = false;
let NodeSqliteDatabase: any = null;

try {
  // Try to import node:sqlite
  const nodeSqlite = await import("node:sqlite");
  NodeSqliteDatabase = nodeSqlite.DatabaseSync;
  nodeSqliteAvailable = true;
} catch (e) {
  // node:sqlite not available
}

// Types
export interface Statement {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  iterate(...params: any[]): IterableIterator<any>;
  finalize(): void;
}

export interface Driver {
  name: string;
  initialize(filename: string): Promise<Driver>;
  close(): Promise<void>;
  prepare(sql: string): Statement;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  exec(sql: string): void;
}

// Base driver interface
abstract class BaseDriver implements Driver {
  public name: string;
  protected db: any = null;

  constructor(name: string) {
    this.name = name;
  }

  abstract initialize(filename: string): Promise<Driver>;
  abstract close(): Promise<void>;
  abstract prepare(sql: string): Statement;
  abstract transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  abstract exec(sql: string): void;
}

// @photostructure/sqlite driver
class PhotostructureDriver extends BaseDriver {
  declare protected db: InstanceType<typeof DatabaseSync> | null;

  constructor() {
    super("@photostructure/sqlite");
  }

  async initialize(filename: string): Promise<Driver> {
    this.db = new DatabaseSync(filename);
    return this;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  prepare(sql: string): Statement {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => stmt.run(...params),
      iterate: (...params) => stmt.iterate(...params),
      finalize: () => stmt.finalize(),
    };
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    // @photostructure/sqlite doesn't have built-in transaction support, simulate it
    const self = this;
    return (...args: any[]) => {
      self.exec("BEGIN");
      try {
        const result = fn(...args);
        self.exec("COMMIT");
        return result;
      } catch (err) {
        self.exec("ROLLBACK");
        throw err;
      }
    };
  }

  exec(sql: string): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec(sql);
  }
}

// better-sqlite3 driver
class BetterSqlite3Driver extends BaseDriver {
  declare protected db: Database.Database | null;

  constructor() {
    super("better-sqlite3");
  }

  async initialize(filename: string): Promise<Driver> {
    this.db = new Database(filename);
    return this;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  prepare(sql: string): Statement {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => stmt.run(...params) as any,
      iterate: (...params) => stmt.iterate(...params),
      finalize: () => {}, // better-sqlite3 doesn't require finalize
    };
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    if (!this.db) throw new Error("Database not initialized");
    return this.db.transaction(fn);
  }

  exec(sql: string): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec(sql);
  }
}

// node:sqlite driver (if available)
class NodeSqliteDriver extends BaseDriver {
  declare protected db: any;

  constructor() {
    super("node:sqlite");
  }

  async initialize(filename: string): Promise<Driver> {
    if (!nodeSqliteAvailable) {
      throw new Error("node:sqlite is not available");
    }
    this.db = new NodeSqliteDatabase(filename);
    return this;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  prepare(sql: string): Statement {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => stmt.run(...params),
      iterate: (...params) => stmt.iterate(...params),
      finalize: () => {}, // node:sqlite doesn't require finalize
    };
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    // node:sqlite doesn't have built-in transaction support, simulate it
    const self = this;
    return (...args: any[]) => {
      self.exec("BEGIN");
      try {
        const result = fn(...args);
        self.exec("COMMIT");
        return result;
      } catch (err) {
        self.exec("ROLLBACK");
        throw err;
      }
    };
  }

  exec(sql: string): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.exec(sql);
  }
}

// sqlite3 driver (async, needs wrapper)
class Sqlite3Driver extends BaseDriver {
  declare protected db: sqlite3.Database;
  private stmtCache = new Map<string, sqlite3.Statement>();
  private dbRun!: (sql: string, ...params: any[]) => Promise<void>;
  private dbGet!: (sql: string, ...params: any[]) => Promise<any>;
  private dbAll!: (sql: string, ...params: any[]) => Promise<any[]>;
  private dbExec!: (sql: string) => Promise<void>;

  constructor() {
    super("sqlite3");
  }

  async initialize(filename: string): Promise<Driver> {
    const Database = sqlite3.verbose().Database;
    this.db = new Database(filename);

    // Promisify common methods
    this.dbRun = promisify(this.db.run.bind(this.db));
    this.dbGet = promisify(this.db.get.bind(this.db));
    this.dbAll = promisify(this.db.all.bind(this.db));
    this.dbExec = promisify(this.db.exec.bind(this.db));

    return this;
  }

  async close(): Promise<void> {
    if (this.db) {
      // Clean up cached statements
      for (const stmt of this.stmtCache.values()) {
        await new Promise<void>((resolve) => stmt.finalize(() => resolve()));
      }
      this.stmtCache.clear();

      await new Promise<void>((resolve, reject) => {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.db = null as any;
    }
  }

  prepare(sql: string): Statement {
    // For sqlite3, we'll create a wrapper that makes async operations look sync
    // This is not ideal for performance but allows fair comparison

    // Cache prepared statements
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }

    return {
      get: (...params) => {
        // Run synchronously using deasync
        let result: any;
        let error: Error | null = null;
        let done = false;

        stmt!.get(...params, (err: Error | null, row: any) => {
          error = err;
          result = row;
          done = true;
        });

        // Busy wait using deasync
        deasync.loopWhile(() => !done);

        if (error) throw error;
        return result!;
      },

      all: (...params) => {
        let result: any[];
        let error: Error | null = null;
        let done = false;

        stmt!.all(...params, (err: Error | null, rows: any[]) => {
          error = err;
          result = rows;
          done = true;
        });

        deasync.loopWhile(() => !done);

        if (error) throw error;
        return result!;
      },

      run: (...params) => {
        let result: any;
        let error: Error | null = null;
        let done = false;

        stmt!.run(...params, function (this: any, err: Error | null) {
          error = err;
          result = { changes: this.changes, lastInsertRowid: this.lastID };
          done = true;
        });

        deasync.loopWhile(() => !done);

        if (error) throw error;
        return result!;
      },

      iterate: function* (...params) {
        // sqlite3 doesn't have built-in iterator, simulate with all()
        let rows: any[];
        let error: Error | null = null;
        let done = false;

        stmt!.all(...params, (err: Error | null, allRows: any[]) => {
          error = err;
          rows = allRows;
          done = true;
        });

        deasync.loopWhile(() => !done);

        if (error) throw error;

        for (const row of rows!) {
          yield row;
        }
      },

      finalize: () => {
        // Don't finalize cached statements
      },
    };
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    // sqlite3 doesn't have built-in transaction support, simulate it
    const self = this;
    return (...args: any[]) => {
      self.exec("BEGIN");
      try {
        const result = fn(...args);
        self.exec("COMMIT");
        return result;
      } catch (err) {
        self.exec("ROLLBACK");
        throw err;
      }
    };
  }

  exec(sql: string): void {
    let error: Error | null = null;
    let done = false;

    this.db.exec(sql, (err) => {
      error = err;
      done = true;
    });

    deasync.loopWhile(() => !done);

    if (error) throw error;
  }
}

// Driver class map
type DriverConstructor = new () => BaseDriver;

// Export available drivers
export const drivers: Record<string, DriverConstructor> = {
  "@photostructure/sqlite": PhotostructureDriver,
  "better-sqlite3": BetterSqlite3Driver,
  ...(nodeSqliteAvailable ? { "node:sqlite": NodeSqliteDriver } : {}),
  sqlite3: Sqlite3Driver,
};

// Helper to create driver instance
export async function createDriver(
  name: string,
  filename: string,
): Promise<Driver> {
  const DriverClass = drivers[name];
  if (!DriverClass) {
    throw new Error(`Unknown driver: ${name}`);
  }

  const driver = new DriverClass();
  await driver.initialize(filename);
  return driver;
}

// Get list of available drivers
export function getAvailableDrivers(): string[] {
  return Object.keys(drivers);
}
