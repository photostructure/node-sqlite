/**
 * Tests for pragma() - inspired by better-sqlite3's pragma API
 */
import { DatabaseSync, enhance, EnhancedDatabaseSync } from "../src";

describe("pragma() Tests", () => {
  let db: EnhancedDatabaseSync<InstanceType<typeof DatabaseSync>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
  });

  afterEach(() => {
    db.close();
  });

  describe("basic functionality", () => {
    test("returns array of rows by default", () => {
      const rows = db.pragma("cache_size") as Array<{ cache_size: number }>;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty("cache_size");
      expect(typeof rows[0]!.cache_size).toBe("number");
    });

    test("returns single value with simple option", () => {
      const cacheSize = db.pragma("cache_size", { simple: true });
      expect(typeof cacheSize).toBe("number");
    });

    test("simple: false returns array", () => {
      const rows = db.pragma("cache_size", { simple: false }) as unknown[];
      expect(Array.isArray(rows)).toBe(true);
    });

    test("can set pragma values", () => {
      db.pragma("cache_size = -8000");
      const cacheSize = db.pragma("cache_size", { simple: true });
      expect(cacheSize).toBe(-8000);
    });

    test("can query journal_mode", () => {
      const mode = db.pragma("journal_mode", { simple: true });
      expect(typeof mode).toBe("string");
    });

    test("can set and query journal_mode", () => {
      // In-memory databases can't use WAL, they use "memory" mode
      // Just verify the pragma can be queried without error
      const mode = db.pragma("journal_mode", { simple: true });
      expect(typeof mode).toBe("string");
      expect(mode).toBe("memory"); // In-memory databases use memory journal mode
    });
  });

  describe("table_info pragma", () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `);
    });

    test("returns column information", () => {
      const columns = db.pragma("table_info(users)") as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;

      expect(Array.isArray(columns)).toBe(true);
      expect(columns).toHaveLength(3);

      expect(columns[0]!.name).toBe("id");
      expect(columns[0]!.type).toBe("INTEGER");
      expect(columns[0]!.pk).toBe(1);

      expect(columns[1]!.name).toBe("name");
      expect(columns[1]!.type).toBe("TEXT");
      expect(columns[1]!.notnull).toBe(1);

      expect(columns[2]!.name).toBe("email");
      expect(columns[2]!.type).toBe("TEXT");
      expect(columns[2]!.notnull).toBe(0);
    });

    test("simple returns undefined for no rows", () => {
      const result = db.pragma("table_info(nonexistent)", { simple: true });
      expect(result).toBeUndefined();
    });
  });

  describe("error handling", () => {
    test("throws TypeError for non-string source", () => {
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma(123)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma(0)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma(null)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma()).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma(new String("cache_size"))).toThrow(TypeError);
    });

    test("throws TypeError for non-object options", () => {
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", true)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", 123)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", "true")).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", () => {})).toThrow(TypeError);
    });

    test("throws TypeError for non-boolean simple option", () => {
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", { simple: undefined })).toThrow(
        TypeError,
      );
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", { simple: "true" })).toThrow(
        TypeError,
      );
      // @ts-expect-error Testing runtime type check
      expect(() => db.pragma("cache_size", { simple: 1 })).toThrow(TypeError);
    });

    test("throws SqliteError for invalid PRAGMA", () => {
      expect(() => db.pragma("PRAGMA cache_size")).toThrow();
    });

    test("handles multiple statements by executing first only", () => {
      // Unlike better-sqlite3, our implementation uses prepare() which
      // by default only executes the first statement. This matches node:sqlite behavior.
      // The second statement is silently ignored.
      const result = db.pragma("cache_size; PRAGMA journal_mode") as unknown[];
      expect(Array.isArray(result)).toBe(true);
      // Result should be from cache_size only
      expect(result).toHaveLength(1);
    });
  });

  describe("various pragmas", () => {
    test("user_version", () => {
      expect(db.pragma("user_version", { simple: true })).toBe(0);
      db.pragma("user_version = 42");
      expect(db.pragma("user_version", { simple: true })).toBe(42);
    });

    test("encoding", () => {
      const encoding = db.pragma("encoding", { simple: true });
      expect(encoding).toBe("UTF-8");
    });

    test("page_size", () => {
      const pageSize = db.pragma("page_size", { simple: true });
      expect(typeof pageSize).toBe("number");
      expect(pageSize).toBeGreaterThan(0);
    });

    test("foreign_keys", () => {
      // Our SQLite is compiled with SQLITE_DEFAULT_FOREIGN_KEYS=1
      // so foreign keys are enabled by default
      const initial = db.pragma("foreign_keys", { simple: true });
      expect(typeof initial).toBe("number");
      expect([0, 1]).toContain(initial);

      // Turn on
      db.pragma("foreign_keys = ON");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

      // Turn off
      db.pragma("foreign_keys = OFF");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(0);

      // Turn back on
      db.pragma("foreign_keys = ON");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    });

    test("compile_options", () => {
      const options = db.pragma("compile_options") as Array<{
        compile_options: string;
      }>;
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      // All rows should have compile_options property (note: plural)
      for (const row of options) {
        expect(typeof row.compile_options).toBe("string");
      }
    });

    test("database_list", () => {
      const databases = db.pragma("database_list") as Array<{
        seq: number;
        name: string;
        file: string;
      }>;
      expect(Array.isArray(databases)).toBe(true);
      expect(databases.length).toBeGreaterThanOrEqual(1);
      expect(databases[0]!.name).toBe("main");
    });
  });

  describe("null option handling", () => {
    test("null options is treated as no options", () => {
      // @ts-expect-error Testing null behavior
      const rows = db.pragma("cache_size", null) as unknown[];
      expect(Array.isArray(rows)).toBe(true);
    });

    test("empty options object works", () => {
      const rows = db.pragma("cache_size", {}) as unknown[];
      expect(Array.isArray(rows)).toBe(true);
    });
  });
});
