import { DatabaseSync } from "../src/index";

// Optional dependencies - loaded lazily to allow running tests without them
// Use any types to avoid TypeScript issues with optional deps
let Database: any = null;

// Try to load optional dependencies
try {
  Database = require("better-sqlite3");
} catch {
  // better-sqlite3 not available
}

// Track if node:sqlite is available
let nodeSqliteAvailable = false;
let NodeSqliteDatabase: any = null;

try {
  // Use require() for synchronous loading so the driver is available
  // when the `drivers` map is built at module-load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeSqlite = require("node:sqlite");
  NodeSqliteDatabase = nodeSqlite.DatabaseSync;
  nodeSqliteAvailable = true;
} catch {
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

// Pin the durability-relevant pragmas to SQLite's defaults (rollback journal,
// synchronous=FULL) so every driver is measured under identical write-durability
// behavior. Without this, the "single-op writes tie across drivers" result in
// the README would silently depend on each driver happening to ship the same
// defaults — a driver that shipped e.g. WAL or synchronous=NORMAL would look
// faster on writes for reasons unrelated to its own code.
function pinDurabilityPragmas(db: { exec(sql: string): void }): void {
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = FULL");
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
    pinDurabilityPragmas(this.db);
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
      // Node.js sqlite auto-finalizes statements, no explicit finalize needed
      finalize: () => {},
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
  declare protected db: any;

  constructor() {
    super("better-sqlite3");
  }

  async initialize(filename: string): Promise<Driver> {
    if (!Database) {
      throw new Error(
        "better-sqlite3 is not available - run 'npm install' in benchmark/",
      );
    }
    this.db = new Database(filename);
    pinDurabilityPragmas(this.db);
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
    pinDurabilityPragmas(this.db);
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

// Driver class map
type DriverConstructor = new () => BaseDriver;

// Export available drivers
export const drivers: Record<string, DriverConstructor> = {
  "@photostructure/sqlite": PhotostructureDriver,
  ...(Database ? { "better-sqlite3": BetterSqlite3Driver } : {}),
  ...(nodeSqliteAvailable ? { "node:sqlite": NodeSqliteDriver } : {}),
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
