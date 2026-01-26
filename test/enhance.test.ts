/**
 * Tests for enhance() - adds better-sqlite3-style methods to any compatible database
 */
import {
  DatabaseSync,
  enhance,
  EnhanceableDatabaseSync,
  isEnhanced,
} from "../src";

describe("enhance() Tests", () => {
  describe("with @photostructure/sqlite DatabaseSync", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    afterEach(() => {
      db.close();
    });

    test("isEnhanced returns false before enhancement", () => {
      // DatabaseSync no longer has pragma/transaction by default
      expect(isEnhanced(db)).toBe(false);
    });

    test("returns the same instance after adding methods", () => {
      const enhanced = enhance(db);
      // enhance() adds methods to the instance and returns it
      expect(enhanced).toBe(db);
    });

    test("isEnhanced returns true after enhancement", () => {
      const enhanced = enhance(db);
      expect(isEnhanced(enhanced)).toBe(true);
    });

    test("enhance is idempotent", () => {
      const enhanced1 = enhance(db);
      const enhanced2 = enhance(enhanced1);
      expect(enhanced2).toBe(enhanced1);
    });

    test("pragma works on enhanced instance", () => {
      const enhanced = enhance(db);
      const cacheSize = enhanced.pragma("cache_size", { simple: true });
      expect(typeof cacheSize).toBe("number");
    });

    test("transaction works on enhanced instance", () => {
      const enhanced = enhance(db);
      enhanced.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

      const insert = enhanced.prepare("INSERT INTO items (name) VALUES (?)");
      const insertMany = enhanced.transaction((names: string[]) => {
        for (const name of names) {
          insert.run(name);
        }
        return names.length;
      });

      const count = insertMany(["Alice", "Bob", "Charlie"]);
      expect(count).toBe(3);

      const rows = enhanced.prepare("SELECT * FROM items").all() as Array<{
        id: number;
        name: string;
      }>;
      expect(rows).toHaveLength(3);
    });
  });

  describe("with mock database (simulating node:sqlite)", () => {
    let mockDb: EnhanceableDatabaseSync;
    let preparedStatements: Map<string, { all: () => unknown[] }>;

    beforeEach(() => {
      preparedStatements = new Map();
      let inTransaction = false;

      // Create a minimal mock that simulates node:sqlite DatabaseSync
      mockDb = {
        exec(sql: string): void {
          if (sql.toUpperCase().startsWith("BEGIN")) {
            inTransaction = true;
          } else if (
            sql.toUpperCase() === "COMMIT" ||
            sql.toUpperCase() === "ROLLBACK"
          ) {
            inTransaction = false;
          }
          // For other SQL, just track it
        },
        prepare(sql: string): { all(): unknown[] } {
          // Return a mock statement
          const stmt = {
            all(): unknown[] {
              if (sql.toUpperCase().includes("PRAGMA CACHE_SIZE")) {
                return [{ cache_size: -16000 }];
              }
              if (sql.toUpperCase().includes("PRAGMA JOURNAL_MODE")) {
                return [{ journal_mode: "memory" }];
              }
              if (sql.toUpperCase().includes("PRAGMA USER_VERSION")) {
                return [{ user_version: 0 }];
              }
              return [];
            },
          };
          preparedStatements.set(sql, stmt);
          return stmt;
        },
        get isTransaction(): boolean {
          return inTransaction;
        },
      };
    });

    test("isEnhanced returns false before enhancement", () => {
      expect(isEnhanced(mockDb)).toBe(false);
    });

    test("enhance adds pragma method", () => {
      expect((mockDb as any).pragma).toBeUndefined();
      const enhanced = enhance(mockDb);
      expect(typeof enhanced.pragma).toBe("function");
    });

    test("enhance adds transaction method", () => {
      expect((mockDb as any).transaction).toBeUndefined();
      const enhanced = enhance(mockDb);
      expect(typeof enhanced.transaction).toBe("function");
    });

    test("isEnhanced returns true after enhancement", () => {
      const enhanced = enhance(mockDb);
      expect(isEnhanced(enhanced)).toBe(true);
    });

    test("pragma works on enhanced mock", () => {
      const enhanced = enhance(mockDb);
      const result = enhanced.pragma("cache_size", { simple: true });
      expect(result).toBe(-16000);
    });

    test("pragma returns array without simple option", () => {
      const enhanced = enhance(mockDb);
      const result = enhanced.pragma("cache_size") as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    test("transaction wraps function in begin/commit", () => {
      const enhanced = enhance(mockDb);
      const execCalls: string[] = [];
      const originalExec = mockDb.exec.bind(mockDb);
      mockDb.exec = (sql: string) => {
        execCalls.push(sql);
        originalExec(sql);
      };

      const txn = enhanced.transaction(() => {
        return 42;
      });

      const result = txn();

      expect(result).toBe(42);
      expect(execCalls[0]).toMatch(/BEGIN/i);
      expect(execCalls[execCalls.length - 1]).toMatch(/COMMIT/i);
    });

    test("transaction rolls back on error", () => {
      const enhanced = enhance(mockDb);
      const execCalls: string[] = [];
      const originalExec = mockDb.exec.bind(mockDb);
      mockDb.exec = (sql: string) => {
        execCalls.push(sql);
        originalExec(sql);
      };

      const txn = enhanced.transaction(() => {
        throw new Error("Test error");
      });

      expect(() => txn()).toThrow("Test error");
      expect(execCalls[0]).toMatch(/BEGIN/i);
      expect(execCalls[execCalls.length - 1]).toMatch(/ROLLBACK/i);
    });

    test("enhance is idempotent", () => {
      const enhanced1 = enhance(mockDb);
      const enhanced2 = enhance(enhanced1);
      expect(enhanced2).toBe(enhanced1);
    });

    test("enhanced methods are non-enumerable", () => {
      const enhanced = enhance(mockDb);
      const keys = Object.keys(enhanced);
      expect(keys).not.toContain("pragma");
      expect(keys).not.toContain("transaction");
    });
  });

  describe("type safety", () => {
    test("enhanced database has correct types", () => {
      const db = new DatabaseSync(":memory:");
      const enhanced = enhance(db);

      // These should compile without errors - using void to indicate intentional discard
      void (enhanced.pragma("cache_size") as unknown);
      void enhanced.transaction(() => 42);

      // Original methods should still be available
      enhanced.exec("SELECT 1");
      void enhanced.prepare("SELECT 1");
      void enhanced.isTransaction;

      db.close();
    });
  });

  describe("error handling", () => {
    let mockDb: EnhanceableDatabaseSync;

    beforeEach(() => {
      mockDb = {
        exec: () => {},
        prepare: () => ({ all: () => [] }),
        get isTransaction() {
          return false;
        },
      };
    });

    test("pragma validates source argument", () => {
      const enhanced = enhance(mockDb);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.pragma(123)).toThrow(TypeError);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.pragma(null)).toThrow(TypeError);
    });

    test("pragma validates options argument", () => {
      const enhanced = enhance(mockDb);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.pragma("cache_size", "invalid")).toThrow(TypeError);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.pragma("cache_size", 123)).toThrow(TypeError);
    });

    test("transaction validates function argument", () => {
      const enhanced = enhance(mockDb);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.transaction("not a function")).toThrow(TypeError);
      // @ts-expect-error Testing runtime validation
      expect(() => enhanced.transaction(null)).toThrow(TypeError);
    });
  });

  describe("edge cases", () => {
    test("pragma returns undefined for empty result with simple option", () => {
      const mockDb: EnhanceableDatabaseSync = {
        exec: () => {},
        prepare: () => ({ all: () => [] }), // Returns empty array
        get isTransaction() {
          return false;
        },
      };
      const enhanced = enhance(mockDb);
      expect(enhanced.pragma("nonexistent", { simple: true })).toBeUndefined();
    });

    test("pragma returns undefined for row with no columns", () => {
      const mockDb: EnhanceableDatabaseSync = {
        exec: () => {},
        prepare: () => ({ all: () => [{}] }), // Returns row with no columns
        get isTransaction() {
          return false;
        },
      };
      const enhanced = enhance(mockDb);
      expect(enhanced.pragma("empty_row", { simple: true })).toBeUndefined();
    });

    test("partial enhancement - only pragma exists", () => {
      const mockDb = {
        exec: () => {},
        prepare: () => ({ all: () => [] }),
        get isTransaction() {
          return false;
        },
        pragma: () => "existing pragma",
      } as EnhanceableDatabaseSync;

      // isEnhanced requires both pragma AND transaction
      expect(isEnhanced(mockDb)).toBe(false);

      // enhance() will add transaction (and overwrite pragma)
      const enhanced = enhance(mockDb);
      expect(isEnhanced(enhanced)).toBe(true);
      expect(typeof enhanced.transaction).toBe("function");
    });

    test("partial enhancement - only transaction exists", () => {
      const mockDb = {
        exec: () => {},
        prepare: () => ({ all: () => [] }),
        get isTransaction() {
          return false;
        },
        transaction: () => {},
      } as unknown as EnhanceableDatabaseSync;

      // isEnhanced requires both pragma AND transaction
      expect(isEnhanced(mockDb)).toBe(false);

      // enhance() will add pragma (and overwrite transaction)
      const enhanced = enhance(mockDb);
      expect(isEnhanced(enhanced)).toBe(true);
      expect(typeof enhanced.pragma).toBe("function");
    });

    test("enhance preserves other properties on the database", () => {
      const mockDb = {
        exec: () => {},
        prepare: () => ({ all: () => [] }),
        get isTransaction() {
          return false;
        },
        customProperty: "should be preserved",
        customMethod: () => "custom",
      } as EnhanceableDatabaseSync & {
        customProperty: string;
        customMethod: () => string;
      };

      const enhanced = enhance(mockDb);

      expect(enhanced.customProperty).toBe("should be preserved");
      expect(enhanced.customMethod()).toBe("custom");
    });

    test("enhanced methods work after closing and reopening (if supported)", () => {
      const db = new DatabaseSync(":memory:");
      const enhanced = enhance(db);

      // Use pragma
      const cacheSize = enhanced.pragma("cache_size", { simple: true });
      expect(typeof cacheSize).toBe("number");

      // Methods should still work
      enhanced.pragma("user_version = 42");
      expect(enhanced.pragma("user_version", { simple: true })).toBe(42);

      db.close();
    });
  });

  describe("node:sqlite compatibility", () => {
    // This test checks if node:sqlite is available and tests with it
    const nodeSqliteAvailable = (() => {
      try {
        require("node:sqlite");
        return true;
      } catch {
        return false;
      }
    })();

    (nodeSqliteAvailable ? test : test.skip)(
      "enhance works with actual node:sqlite",
      () => {
        const { DatabaseSync: NodeDatabaseSync } = require("node:sqlite");
        const db = new NodeDatabaseSync(":memory:");

        // node:sqlite should not have pragma/transaction by default
        expect(typeof db.pragma).toBe("undefined");
        expect(typeof db.transaction).toBe("undefined");

        const enhanced = enhance(db);

        // Now it should have them
        expect(typeof enhanced.pragma).toBe("function");
        expect(typeof enhanced.transaction).toBe("function");

        // Test pragma works
        const cacheSize = enhanced.pragma("cache_size", { simple: true });
        expect(typeof cacheSize).toBe("number");

        // Test transaction works
        enhanced.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
        const insert = enhanced.prepare("INSERT INTO test (id) VALUES (?)");
        const insertMany = enhanced.transaction((ids: number[]) => {
          for (const id of ids) {
            insert.run(id);
          }
          return ids.length;
        });

        const count = insertMany([1, 2, 3]);
        expect(count).toBe(3);

        db.close();
      },
    );
  });
});
