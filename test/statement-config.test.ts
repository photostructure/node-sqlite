import { DatabaseSync } from "../src";

describe("Statement Configuration Tests", () => {
  let db: any;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test (
        id INTEGER PRIMARY KEY,
        small_num INTEGER,
        big_num INTEGER,
        name TEXT
      );
      
      INSERT INTO test (id, small_num, big_num, name) VALUES 
        (1, 100, 9007199254740992, 'Alice'),
        (2, 200, 9007199254740993, 'Bob'),
        (3, 300, 9007199254740994, 'Charlie');
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("setReadBigInts", () => {
    test("returns BigInt for all integers when enabled", () => {
      const stmt = db.prepare(
        "SELECT id, small_num, big_num FROM test WHERE id = ?",
      );
      stmt.setReadBigInts(true);

      const result = stmt.get(1);
      expect(typeof result.id).toBe("bigint");
      expect(typeof result.small_num).toBe("bigint");
      expect(typeof result.big_num).toBe("bigint");
      expect(result.id).toBe(1n);
      expect(result.small_num).toBe(100n);
      expect(result.big_num).toBe(9007199254740992n);
    });

    test("throws RangeError for large integers when BigInts disabled", () => {
      const stmt = db.prepare(
        "SELECT id, small_num, big_num FROM test WHERE id = ?",
      );
      stmt.setReadBigInts(false);

      // Large integers outside safe integer range throw RangeError
      // Note: we can't use expect().toThrow(RangeError) because Jest wraps the error
      // and sees identical constructor names but different references
      let error: Error | undefined;
      try {
        stmt.get(1);
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.name).toBe("RangeError");
      expect(error!.message).toContain("too large");
    });

    test("default behavior returns numbers for small integers", () => {
      const stmt = db.prepare("SELECT id, small_num FROM test WHERE id = ?");

      const result = stmt.get(1);
      expect(typeof result.id).toBe("number");
      expect(typeof result.small_num).toBe("number");
    });
  });

  describe("setReturnArrays", () => {
    test("returns results as arrays when enabled", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = ?");
      stmt.setReturnArrays(true);

      const result = stmt.get(1);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, "Alice"]);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe("Alice");
    });

    test("returns results as objects when disabled", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = ?");
      stmt.setReturnArrays(false);

      const result = stmt.get(1);
      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({ id: 1, name: "Alice" });
    });

    test("default behavior returns objects", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = ?");

      const result = stmt.get(1);
      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({ id: 1, name: "Alice" });
    });

    test("works with all() method", () => {
      const stmt = db.prepare("SELECT id, name FROM test ORDER BY id");
      stmt.setReturnArrays(true);

      const results = stmt.all();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      expect(results[0]).toEqual([1, "Alice"]);
      expect(results[1]).toEqual([2, "Bob"]);
      expect(results[2]).toEqual([3, "Charlie"]);
    });
  });

  describe("setAllowBareNamedParameters", () => {
    test("allows bare named parameters when enabled", () => {
      // Create a statement with named parameters - only select columns without large integers
      const stmt = db.prepare(
        "SELECT id, name FROM test WHERE id = :id AND name = :name",
      );
      stmt.setAllowBareNamedParameters(true);

      // Should work with bare names (without : prefix)
      const result = stmt.get({ id: 1, name: "Alice" });
      expect(result.id).toBe(1);
      expect(result.name).toBe("Alice");
    });

    test("requires exact parameter names when disabled", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = :id");
      stmt.setAllowBareNamedParameters(false);

      // Should only work with exact names (with : prefix)
      const result = stmt.get({ ":id": 1 });
      expect(result.id).toBe(1);
    });

    test("works with $ prefix", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = $id");
      stmt.setAllowBareNamedParameters(true);

      const result = stmt.get({ id: 1 });
      expect(result.id).toBe(1);
    });

    test("detects conflicting parameter names", () => {
      // This should throw an error because both :id and $id map to bare name "id"
      const stmt = db.prepare("SELECT * FROM test WHERE id = :id OR id = $id");
      stmt.setAllowBareNamedParameters(true);

      expect(() => stmt.get({ id: 1 })).toThrow("conflicting names");
    });
  });

  describe("combined configuration", () => {
    test("all configurations work together", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = :id");
      stmt.setReadBigInts(true);
      stmt.setReturnArrays(true);
      stmt.setAllowBareNamedParameters(true);

      const result = stmt.get({ id: 1 });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1n, "Alice"]);
      expect(typeof result[0]).toBe("bigint");
    });
  });

  // Note: finalize() is not part of node:sqlite API - statements are auto-finalized on GC

  describe("columns() method", () => {
    test("returns column metadata", () => {
      const stmt = db.prepare("SELECT id, name AS person_name FROM test");
      const columns = stmt.columns();

      expect(Array.isArray(columns)).toBe(true);
      expect(columns.length).toBe(2);

      // First column: id
      expect(columns[0]).toEqual({
        column: "id",
        database: "main",
        name: "id",
        table: "test",
        type: "INTEGER",
      });

      // Second column: name with alias
      expect(columns[1]).toEqual({
        column: "name",
        database: "main",
        name: "person_name", // Should use the alias
        table: "test",
        type: "TEXT",
      });
    });

    test("handles expressions and computed columns", () => {
      const stmt = db.prepare(
        "SELECT id * 2 AS double_id, UPPER(name) AS upper_name FROM test",
      );
      const columns = stmt.columns();

      expect(columns.length).toBe(2);

      // Computed columns should have null for column/table
      expect(columns[0].name).toBe("double_id");
      expect(columns[0].column).toBeNull();
      expect(columns[0].table).toBeNull();

      expect(columns[1].name).toBe("upper_name");
      expect(columns[1].column).toBeNull();
      expect(columns[1].table).toBeNull();
    });

    test("works with joins", () => {
      // Create a second table for join
      db.exec(`
        CREATE TABLE department (
          id INTEGER PRIMARY KEY,
          name TEXT
        );
        INSERT INTO department (id, name) VALUES (1, 'Engineering');
      `);

      const stmt = db.prepare(`
        SELECT t.id, t.name, d.name AS dept_name
        FROM test t
        JOIN department d ON t.id = d.id
      `);
      const columns = stmt.columns();

      expect(columns.length).toBe(3);
      expect(columns[2]).toEqual({
        column: "name",
        database: "main",
        name: "dept_name",
        table: "department",
        type: "TEXT",
      });
    });
  });

  describe("prepare() options (Node.js v25+)", () => {
    test("readBigInts option overrides database default", () => {
      const stmt = db.prepare("SELECT id, small_num FROM test WHERE id = ?", {
        readBigInts: true,
      });

      const result = stmt.get(1);
      expect(typeof result.id).toBe("bigint");
      expect(typeof result.small_num).toBe("bigint");
      expect(result.id).toBe(1n);
    });

    test("readBigInts option can be disabled per-statement", () => {
      // Database with BigInts enabled by default
      const dbWithBigInts = new DatabaseSync(":memory:", { readBigInts: true });
      dbWithBigInts.exec(`
        CREATE TABLE nums (id INTEGER, val INTEGER);
        INSERT INTO nums VALUES (1, 100);
      `);

      // Override with readBigInts: false for this statement
      const stmt = dbWithBigInts.prepare(
        "SELECT id, val FROM nums WHERE id = ?",
        { readBigInts: false },
      );

      const result = stmt.get(1);
      expect(typeof result.id).toBe("number");
      expect(typeof result.val).toBe("number");
      dbWithBigInts.close();
    });

    test("returnArrays option overrides database default", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = ?", {
        returnArrays: true,
      });

      const result = stmt.get(1);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, "Alice"]);
    });

    test("returnArrays option can be disabled per-statement", () => {
      // Database with arrays enabled by default
      const dbWithArrays = new DatabaseSync(":memory:", { returnArrays: true });
      dbWithArrays.exec(`
        CREATE TABLE items (id INTEGER, name TEXT);
        INSERT INTO items VALUES (1, 'Test');
      `);

      // Override with returnArrays: false for this statement
      const stmt = dbWithArrays.prepare(
        "SELECT id, name FROM items WHERE id = ?",
        { returnArrays: false },
      );

      const result = stmt.get(1);
      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({ id: 1, name: "Test" });
      dbWithArrays.close();
    });

    test("allowBareNamedParameters option overrides database default", () => {
      // Database with bare params disabled by default
      const dbNoBare = new DatabaseSync(":memory:", {
        allowBareNamedParameters: false,
      });
      dbNoBare.exec(`
        CREATE TABLE items (id INTEGER, name TEXT);
        INSERT INTO items VALUES (1, 'Test');
      `);

      // Override with allowBareNamedParameters: true for this statement
      const stmt = dbNoBare.prepare(
        "SELECT id, name FROM items WHERE id = :id",
        { allowBareNamedParameters: true },
      );

      const result = stmt.get({ id: 1 });
      expect(result).toEqual({ id: 1, name: "Test" });
      dbNoBare.close();
    });

    test("multiple prepare options can be combined", () => {
      const stmt = db.prepare("SELECT id, name FROM test WHERE id = :id", {
        readBigInts: true,
        returnArrays: true,
        allowBareNamedParameters: true,
      });

      const result = stmt.get({ id: 1 });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1n, "Alice"]);
      expect(typeof result[0]).toBe("bigint");
    });

    test("prepare options do not affect other statements", () => {
      const stmtWithBigInts = db.prepare("SELECT id FROM test WHERE id = ?", {
        readBigInts: true,
      });
      const stmtWithoutBigInts = db.prepare("SELECT id FROM test WHERE id = ?");

      const result1 = stmtWithBigInts.get(1);
      const result2 = stmtWithoutBigInts.get(1);

      expect(typeof result1.id).toBe("bigint");
      expect(typeof result2.id).toBe("number");
    });

    test("throws on invalid options type", () => {
      expect(() => {
        db.prepare("SELECT 1", "not an object" as any);
      }).toThrow(/object/);
    });

    test("throws on invalid readBigInts option type", () => {
      expect(() => {
        db.prepare("SELECT 1", { readBigInts: "yes" as any });
      }).toThrow(/boolean/);
    });

    test("throws on invalid returnArrays option type", () => {
      expect(() => {
        db.prepare("SELECT 1", { returnArrays: 42 as any });
      }).toThrow(/boolean/);
    });

    test("throws on invalid allowBareNamedParameters option type", () => {
      expect(() => {
        db.prepare("SELECT 1", { allowBareNamedParameters: null as any });
      }).toThrow(/boolean/);
    });

    test("throws on invalid allowUnknownNamedParameters option type", () => {
      expect(() => {
        db.prepare("SELECT 1", { allowUnknownNamedParameters: {} as any });
      }).toThrow(/boolean/);
    });

    test("undefined options are ignored and use database defaults", () => {
      const stmt = db.prepare("SELECT id FROM test WHERE id = ?", {
        readBigInts: undefined,
      });

      const result = stmt.get(1);
      // Should use database default (false)
      expect(typeof result.id).toBe("number");
    });

    test("setReadBigInts still works after prepare options", () => {
      // Prepare with readBigInts: false
      const stmt = db.prepare("SELECT id FROM test WHERE id = ?", {
        readBigInts: false,
      });

      // Override with setter
      stmt.setReadBigInts(true);

      const result = stmt.get(1);
      expect(typeof result.id).toBe("bigint");
    });
  });
});
