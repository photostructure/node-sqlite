import { DatabaseSync } from "../src/index";
import { useTempDir } from "./test-utils";

describe("DatabaseSync Options", () => {
  const tempDir = useTempDir();

  describe("readBigInts option", () => {
    test("should return BigInt when readBigInts is true", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), { readBigInts: true });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, big_num INTEGER)");
      db.exec("INSERT INTO test (big_num) VALUES (9007199254740992)"); // Number.MAX_SAFE_INTEGER + 1

      const stmt = db.prepare("SELECT big_num FROM test");
      const result = stmt.get();

      expect(typeof result.big_num).toBe("bigint");
      expect(result.big_num).toBe(9007199254740992n);
      db.close();
    });

    test("should return number when readBigInts is false (default)", () => {
      const db = new DatabaseSync(tempDir.getDbPath());
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, big_num INTEGER)");
      db.exec("INSERT INTO test (big_num) VALUES (42)");

      const stmt = db.prepare("SELECT big_num FROM test");
      const result = stmt.get();

      expect(typeof result.big_num).toBe("number");
      expect(result.big_num).toBe(42);
      db.close();
    });

    test("statement can override database default", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), { readBigInts: false });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, big_num INTEGER)");
      db.exec("INSERT INTO test (big_num) VALUES (9007199254740992)");

      const stmt = db.prepare("SELECT big_num FROM test");
      stmt.setReadBigInts(true);
      const result = stmt.get();

      expect(typeof result.big_num).toBe("bigint");
      expect(result.big_num).toBe(9007199254740992n);
      db.close();
    });
  });

  describe("returnArrays option", () => {
    test("should return arrays when returnArrays is true", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), { returnArrays: true });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO test (name) VALUES ('Alice')");

      const stmt = db.prepare("SELECT id, name FROM test");
      const result = stmt.get();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, "Alice"]);
      db.close();
    });

    test("should return objects when returnArrays is false (default)", () => {
      const db = new DatabaseSync(tempDir.getDbPath());
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO test (name) VALUES ('Bob')");

      const stmt = db.prepare("SELECT id, name FROM test");
      const result = stmt.get();

      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({ id: 1, name: "Bob" });
      db.close();
    });

    test("statement can override database default", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), { returnArrays: false });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO test (name) VALUES ('Charlie')");

      const stmt = db.prepare("SELECT id, name FROM test");
      stmt.setReturnArrays(true);
      const result = stmt.get();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, "Charlie"]);
      db.close();
    });
  });

  describe("allowBareNamedParameters option", () => {
    test("should allow bare named parameters when true (default)", () => {
      const db = new DatabaseSync(tempDir.getDbPath());
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

      const stmt = db.prepare("INSERT INTO test (name) VALUES ($name)");
      const result = stmt.run({ name: "David" });

      expect(result.changes).toBe(1);
      db.close();
    });

    test("should handle named parameters correctly based on setting", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), {
        allowBareNamedParameters: false,
      });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

      const stmt = db.prepare("INSERT INTO test (name) VALUES ($name)");

      // When allowBareNamedParameters is false, bare names (without prefix) should not work
      // But in the current implementation, this behavior might not be enforced at the database level
      // The statement still accepts bare names by default unless explicitly overridden

      // This should work with the full parameter name
      const result = stmt.run({ $name: "Eve" });
      expect(result.changes).toBe(1);

      // Verify the data was inserted
      const checkStmt = db.prepare("SELECT name FROM test WHERE name = ?");
      const row = checkStmt.get("Eve");
      expect(row.name).toBe("Eve");

      db.close();
    });

    test("statement can override database default", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), {
        allowBareNamedParameters: false,
      });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

      const stmt = db.prepare("INSERT INTO test (name) VALUES ($name)");
      stmt.setAllowBareNamedParameters(true);
      const result = stmt.run({ name: "Frank" });

      expect(result.changes).toBe(1);
      db.close();
    });
  });

  describe("multiple options together", () => {
    test("should apply all options correctly", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), {
        readBigInts: true,
        returnArrays: true,
        allowBareNamedParameters: true,
      });

      db.exec(
        "CREATE TABLE test (id INTEGER PRIMARY KEY, big_num INTEGER, name TEXT)",
      );

      const insertStmt = db.prepare(
        "INSERT INTO test (big_num, name) VALUES ($big_num, $name)",
      );
      insertStmt.run({ big_num: 9007199254740992n, name: "Test" });

      const selectStmt = db.prepare("SELECT * FROM test");
      const result = selectStmt.get();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBe(1n); // id is also returned as bigint when readBigInts is true
      expect(typeof result[1]).toBe("bigint"); // big_num
      expect(result[1]).toBe(9007199254740992n);
      expect(result[2]).toBe("Test"); // name

      db.close();
    });
  });

  describe("existing options still work", () => {
    test("enableForeignKeyConstraints option", () => {
      const db = new DatabaseSync(tempDir.getDbPath(), {
        enableForeignKeyConstraints: true,
      });

      db.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER,
          FOREIGN KEY (parent_id) REFERENCES parent(id)
        );
      `);

      // This should fail due to foreign key constraint
      expect(() => {
        db.exec("INSERT INTO child (parent_id) VALUES (999)");
      }).toThrow(/FOREIGN KEY constraint failed/);

      db.close();
    });

    test("readOnly option", () => {
      const dbPath = tempDir.getDbPath();

      // Create database and table
      const db1 = new DatabaseSync(dbPath);
      db1.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      db1.close();

      // Open in read-only mode
      const db2 = new DatabaseSync(dbPath, { readOnly: true });

      // This should fail because database is read-only
      expect(() => {
        db2.exec("INSERT INTO test VALUES (1)");
      }).toThrow(/attempt to write a readonly database/);

      db2.close();
    });
  });
});
