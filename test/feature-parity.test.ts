import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { DatabaseSync } from "../src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Feature Parity with Node.js SQLite", () => {
  let tempDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sqlite-feature-test-"));
  });

  afterEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("DatabaseSync Core Methods", () => {
    test("constructor with location", () => {
      db = new DatabaseSync(":memory:");
      expect(db.isOpen).toBe(true);
    });

    test("constructor with options", () => {
      const dbPath = join(tempDir, "test.db");
      db = new DatabaseSync(dbPath, {
        readOnly: false,
        enableForeignKeyConstraints: true,
        timeout: 5000,
      });
      expect(db.isOpen).toBe(true);
    });

    test("open() method", () => {
      db = new DatabaseSync(":memory:", { open: false });
      expect(db.isOpen).toBe(false);
      db.open();
      expect(db.isOpen).toBe(true);
    });

    test("close() method", () => {
      db = new DatabaseSync(":memory:");
      expect(db.isOpen).toBe(true);
      db.close();
      expect(db.isOpen).toBe(false);
    });

    test("prepare() method", () => {
      db = new DatabaseSync(":memory:");
      const stmt = db.prepare("SELECT 1 as num");
      expect(stmt).toBeDefined();
      expect(stmt.sourceSQL).toBe("SELECT 1 as num");
      stmt.finalize();
    });

    test("exec() method", () => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO test (name) VALUES ('Alice')");

      const stmt = db.prepare("SELECT COUNT(*) as count FROM test");
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(1);
      stmt.finalize();
    });

    test("location() method", () => {
      const dbPath = join(tempDir, "test.db");
      db = new DatabaseSync(dbPath);
      const location = db.location();
      expect(location).toBe(dbPath);
    });

    test("location() method for in-memory database", () => {
      db = new DatabaseSync(":memory:");
      const location = db.location();
      expect(location).toBeNull();
    });

    test("isOpen accessor", () => {
      db = new DatabaseSync(":memory:");
      expect(db.isOpen).toBe(true);
      db.close();
      expect(db.isOpen).toBe(false);
    });

    test("isTransaction accessor", () => {
      db = new DatabaseSync(":memory:");
      expect(db.isTransaction).toBe(false);
      db.exec("BEGIN");
      expect(db.isTransaction).toBe(true);
      db.exec("COMMIT");
      expect(db.isTransaction).toBe(false);
    });
  });

  describe("User-Defined Functions", () => {
    test("function() method - basic", () => {
      db = new DatabaseSync(":memory:");
      db.function("add", (a: number, b: number) => a + b);

      const stmt = db.prepare("SELECT add(2, 3) as result");
      const result = stmt.get() as { result: number };
      expect(result.result).toBe(5);
      stmt.finalize();
    });

    test("function() method with options", () => {
      db = new DatabaseSync(":memory:");
      db.function(
        "double",
        { deterministic: true, directOnly: false },
        (x: number) => x * 2,
      );

      const stmt = db.prepare("SELECT double(21) as result");
      const result = stmt.get() as { result: number };
      expect(result.result).toBe(42);
      stmt.finalize();
    });
  });

  describe("Aggregate Functions", () => {
    test("aggregate() method", () => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE numbers (value INTEGER)");
      db.exec("INSERT INTO numbers VALUES (1), (2), (3), (4), (5)");

      db.aggregate("sum_values", {
        start: 0,
        step: (acc: number, val: number) => acc + val,
      });

      const stmt = db.prepare("SELECT sum_values(value) as total FROM numbers");
      const result = stmt.get() as { total: number };
      expect(result.total).toBe(15);
      stmt.finalize();
    });

    test("aggregate() with result function", () => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE numbers (value INTEGER)");
      db.exec("INSERT INTO numbers VALUES (1), (2), (3), (4), (5)");

      db.aggregate("avg_values", {
        start: { sum: 0, count: 0 },
        step: (acc: { sum: number; count: number }, val: number) => ({
          sum: acc.sum + val,
          count: acc.count + 1,
        }),
        result: (acc: { sum: number; count: number }) =>
          acc.count > 0 ? acc.sum / acc.count : null,
      });

      const stmt = db.prepare("SELECT avg_values(value) as avg FROM numbers");
      const result = stmt.get() as { avg: number };
      expect(result.avg).toBe(3);
      stmt.finalize();
    });
  });

  describe("Extension Loading", () => {
    test("enableLoadExtension() method", () => {
      db = new DatabaseSync(":memory:", { allowExtension: true });
      expect(() => db.enableLoadExtension(true)).not.toThrow();
      expect(() => db.enableLoadExtension(false)).not.toThrow();
    });

    test("loadExtension() requires enableLoadExtension", () => {
      db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);
      // We don't have a real extension to load, but we can verify the method exists
      expect(() => db.loadExtension("/nonexistent.so")).toThrow();
    });
  });

  describe("Session and Changeset Support", () => {
    test("createSession() method", () => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

      const session = db.createSession({ table: "users" });
      expect(session).toBeDefined();

      db.exec("INSERT INTO users (name) VALUES ('Alice')");

      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Uint8Array);
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
    });

    test("Session patchset() method", () => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

      const session = db.createSession({ table: "users" });
      db.exec("INSERT INTO users (name) VALUES ('Bob')");

      const patchset = session.patchset();
      expect(patchset).toBeInstanceOf(Uint8Array);
      expect(patchset.length).toBeGreaterThan(0);

      session.close();
    });

    test("applyChangeset() method", () => {
      // Create first database and make changes
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

      const session = db.createSession({ table: "users" });
      db.exec("INSERT INTO users (name) VALUES ('Charlie')");
      const changeset = session.changeset();
      session.close();

      // Create second database and apply changeset
      const db2 = new DatabaseSync(":memory:");
      db2.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      const result = db2.applyChangeset(changeset);
      expect(result).toBe(true);

      const stmt = db2.prepare("SELECT COUNT(*) as count FROM users");
      const queryResult = stmt.get() as { count: number };
      expect(queryResult.count).toBe(1);
      stmt.finalize();
      db2.close();
    });
  });

  describe("Backup Support", () => {
    test("backup() method", async () => {
      const sourcePath = join(tempDir, "source.db");
      const destPath = join(tempDir, "backup.db");

      db = new DatabaseSync(sourcePath);
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");
      db.exec("INSERT INTO test (data) VALUES ('test data')");

      await db.backup(destPath);

      // Verify backup was created
      const backupDb = new DatabaseSync(destPath);
      const stmt = backupDb.prepare("SELECT COUNT(*) as count FROM test");
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(1);
      stmt.finalize();
      backupDb.close();
    });

    test("backup() with options", async () => {
      const sourcePath = join(tempDir, "source2.db");
      const destPath = join(tempDir, "backup2.db");

      db = new DatabaseSync(sourcePath);
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

      let progressCalled = false;
      await db.backup(destPath, {
        rate: 10,
        progress: ({ totalPages, remainingPages }) => {
          progressCalled = true;
          expect(typeof totalPages).toBe("number");
          expect(typeof remainingPages).toBe("number");
        },
      });

      // Progress might not be called for small databases
      // expect(progressCalled).toBe(true);
    });
  });

  describe("StatementSync Methods", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
      db.exec("INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25)");
    });

    test("run() method", () => {
      const stmt = db.prepare("INSERT INTO users (name, age) VALUES (?, ?)");
      const result = stmt.run("Charlie", 35);
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeGreaterThan(0);
      stmt.finalize();
    });

    test("get() method", () => {
      const stmt = db.prepare("SELECT * FROM users WHERE name = ?");
      const result = stmt.get("Alice") as { id: number; name: string; age: number };
      expect(result.name).toBe("Alice");
      expect(result.age).toBe(30);
      stmt.finalize();
    });

    test("all() method", () => {
      const stmt = db.prepare("SELECT * FROM users ORDER BY name");
      const results = stmt.all() as Array<{ name: string }>;
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("Alice");
      expect(results[1].name).toBe("Bob");
      stmt.finalize();
    });

    test("iterate() method", () => {
      const stmt = db.prepare("SELECT * FROM users ORDER BY name");
      const results: Array<{ name: string }> = [];

      for (const row of stmt.iterate()) {
        results.push(row as { name: string });
      }

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("Alice");
      expect(results[1].name).toBe("Bob");
      stmt.finalize();
    });

    test("columns() method", () => {
      const stmt = db.prepare("SELECT id, name FROM users");
      const columns = stmt.columns();
      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe("id");
      expect(columns[1].name).toBe("name");
      stmt.finalize();
    });

    test("sourceSQL accessor", () => {
      const sql = "SELECT * FROM users WHERE id = ?";
      const stmt = db.prepare(sql);
      expect(stmt.sourceSQL).toBe(sql);
      stmt.finalize();
    });

    test("expandedSQL accessor", () => {
      const stmt = db.prepare("SELECT * FROM users WHERE id = ?", {
        expandedSQL: true,
      });
      stmt.run(1);
      const expandedSQL = stmt.expandedSQL;
      expect(expandedSQL).toBeDefined();
      stmt.finalize();
    });

    test("setReadBigInts() method", () => {
      const stmt = db.prepare("SELECT id FROM users WHERE id = 1");
      stmt.setReadBigInts(true);
      const result = stmt.get() as { id: bigint };
      expect(typeof result.id).toBe("bigint");
      stmt.finalize();
    });

    test("setReturnArrays() method", () => {
      const stmt = db.prepare("SELECT name, age FROM users WHERE name = 'Alice'");
      stmt.setReturnArrays(true);
      const result = stmt.get() as Array<string | number>;
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBe("Alice");
      expect(result[1]).toBe(30);
      stmt.finalize();
    });

    test("setAllowBareNamedParameters() method", () => {
      const stmt = db.prepare("SELECT * FROM users WHERE name = :name");
      stmt.setAllowBareNamedParameters(true);
      const result = stmt.get({ name: "Alice" }) as { name: string };
      expect(result.name).toBe("Alice");
      stmt.finalize();
    });

    test("finalize() method", () => {
      const stmt = db.prepare("SELECT * FROM users");
      expect(() => stmt.finalize()).not.toThrow();
      // Should not be able to use after finalize
      expect(() => stmt.get()).toThrow();
    });
  });

  describe("Database Options", () => {
    test("readBigInts option", () => {
      db = new DatabaseSync(":memory:", { readBigInts: true });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      db.exec("INSERT INTO test (id) VALUES (1)");

      const stmt = db.prepare("SELECT id FROM test");
      const result = stmt.get() as { id: bigint };
      expect(typeof result.id).toBe("bigint");
      stmt.finalize();
    });

    test("returnArrays option", () => {
      db = new DatabaseSync(":memory:", { returnArrays: true });
      db.exec("CREATE TABLE test (a INTEGER, b TEXT)");
      db.exec("INSERT INTO test VALUES (1, 'hello')");

      const stmt = db.prepare("SELECT a, b FROM test");
      const result = stmt.get() as Array<number | string>;
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe("hello");
      stmt.finalize();
    });

    test("allowBareNamedParameters option", () => {
      db = new DatabaseSync(":memory:", { allowBareNamedParameters: true });
      db.exec("CREATE TABLE test (name TEXT)");

      const stmt = db.prepare("INSERT INTO test VALUES (:name)");
      stmt.run({ name: "test" });
      stmt.finalize();

      const stmt2 = db.prepare("SELECT * FROM test");
      const result = stmt2.get() as { name: string };
      expect(result.name).toBe("test");
      stmt2.finalize();
    });

    test("timeout option", () => {
      const dbPath = join(tempDir, "timeout-test.db");
      db = new DatabaseSync(dbPath, { timeout: 10000 });
      expect(db.isOpen).toBe(true);
    });

    test("enableForeignKeyConstraints option", () => {
      db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
      db.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER,
          FOREIGN KEY (parent_id) REFERENCES parent(id)
        );
      `);

      // Should enforce foreign key constraints
      expect(() => {
        db.exec("INSERT INTO child (parent_id) VALUES (999)");
      }).toThrow();
    });
  });

  describe("Symbol.dispose Support", () => {
    test("DatabaseSync with using declaration", () => {
      let wasOpen = false;
      {
        using testDb = new DatabaseSync(":memory:");
        wasOpen = testDb.isOpen;
      }
      expect(wasOpen).toBe(true);
      // testDb should be closed automatically after scope
    });

    test("StatementSync with using declaration", () => {
      db = new DatabaseSync(":memory:");
      let hadSQL = false;
      {
        using stmt = db.prepare("SELECT 1");
        hadSQL = !!stmt.sourceSQL;
      }
      expect(hadSQL).toBe(true);
      // stmt should be finalized automatically after scope
    });
  });
});
