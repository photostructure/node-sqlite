import { DatabaseSync } from "../src/index";
import type { CacheProfile } from "./cache-profile";

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
  readonly benchmarkSettings: BenchmarkSettings;
  initialize(
    filename: string,
    configuration: BenchmarkConfiguration,
  ): Promise<Driver>;
  close(): Promise<void>;
  prepare(sql: string): Statement;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  exec(sql: string): void;
}

export interface BenchmarkConfiguration {
  cacheProfile: CacheProfile;
}

export interface BenchmarkSettings {
  cacheProfile: CacheProfile;
  initialCacheSize: number;
  effectiveCacheSize: number;
  journalMode: string;
  synchronous: number;
}

type ConfigurableDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { get(): Record<string, unknown> };
};

function readPragma(db: ConfigurableDatabase, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return Object.values(row)[0];
}

function readNumericPragma(db: ConfigurableDatabase, name: string): number {
  const value = readPragma(db, name);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`PRAGMA ${name} returned a non-numeric value`);
  }
  return value;
}

// Apply the benchmark policy after opening a fresh database. Durability is
// always normalized. Controlled mode also gives every driver the same 16 MiB
// cache target; packaged mode deliberately leaves each compiled cache default
// untouched so it can be measured as a separate policy sensitivity profile.
function configureBenchmarkDatabase(
  db: ConfigurableDatabase,
  configuration: BenchmarkConfiguration,
): BenchmarkSettings {
  const initialCacheSize = readNumericPragma(db, "cache_size");
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = FULL");
  if (configuration.cacheProfile === "controlled") {
    db.exec("PRAGMA cache_size = -16000");
  } else if (configuration.cacheProfile !== "packaged") {
    throw new Error(
      `Unknown benchmark cache profile: ${String(configuration.cacheProfile)}`,
    );
  }

  const effectiveCacheSize = readNumericPragma(db, "cache_size");
  if (
    configuration.cacheProfile === "controlled" &&
    effectiveCacheSize !== -16000
  ) {
    throw new Error(
      `controlled cache profile requires PRAGMA cache_size = -16000; received ${effectiveCacheSize}`,
    );
  }

  const journalMode = readPragma(db, "journal_mode");
  const synchronous = readNumericPragma(db, "synchronous");
  if (typeof journalMode !== "string") {
    throw new Error("PRAGMA journal_mode returned a non-string value");
  }

  return {
    cacheProfile: configuration.cacheProfile,
    initialCacheSize,
    effectiveCacheSize,
    journalMode,
    synchronous,
  };
}

// Base driver interface
abstract class BaseDriver implements Driver {
  public name: string;
  public benchmarkSettings!: BenchmarkSettings;
  protected db: any = null;

  constructor(name: string) {
    this.name = name;
  }

  protected configureDatabase(configuration: BenchmarkConfiguration): void {
    try {
      this.benchmarkSettings = configureBenchmarkDatabase(
        this.db,
        configuration,
      );
    } catch (error) {
      this.db?.close();
      this.db = null;
      throw error;
    }
  }

  abstract initialize(
    filename: string,
    configuration: BenchmarkConfiguration,
  ): Promise<Driver>;
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

  async initialize(
    filename: string,
    configuration: BenchmarkConfiguration,
  ): Promise<Driver> {
    this.db = new DatabaseSync(filename);
    this.configureDatabase(configuration);
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
    // @photostructure/sqlite has no built-in transaction support; simulate it.
    // Arrow fn captures `this` lexically, so no `const self = this` alias needed.
    return (...args: any[]) => {
      this.exec("BEGIN");
      try {
        const result = fn(...args);
        this.exec("COMMIT");
        return result;
      } catch (err) {
        this.exec("ROLLBACK");
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

  async initialize(
    filename: string,
    configuration: BenchmarkConfiguration,
  ): Promise<Driver> {
    if (!Database) {
      throw new Error(
        "better-sqlite3 is not available - run 'npm install' in benchmark/",
      );
    }
    this.db = new Database(filename);
    this.configureDatabase(configuration);
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

  async initialize(
    filename: string,
    configuration: BenchmarkConfiguration,
  ): Promise<Driver> {
    if (!nodeSqliteAvailable) {
      throw new Error("node:sqlite is not available");
    }
    this.db = new NodeSqliteDatabase(filename);
    this.configureDatabase(configuration);
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
    // node:sqlite has no built-in transaction support; simulate it.
    // Arrow fn captures `this` lexically, so no `const self = this` alias needed.
    return (...args: any[]) => {
      this.exec("BEGIN");
      try {
        const result = fn(...args);
        this.exec("COMMIT");
        return result;
      } catch (err) {
        this.exec("ROLLBACK");
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
  // Keep the shared memory/stress helpers on their historical packaged-cache
  // behavior. The performance runner owns its controlled-by-default policy and
  // passes that choice explicitly at every call site.
  configuration: BenchmarkConfiguration = {
    cacheProfile: "packaged",
  },
): Promise<Driver> {
  const DriverClass = drivers[name];
  if (!DriverClass) {
    throw new Error(`Unknown driver: ${name}`);
  }

  const driver = new DriverClass();
  await driver.initialize(filename, configuration);
  return driver;
}

// Get list of available drivers
export function getAvailableDrivers(): string[] {
  return Object.keys(drivers);
}
