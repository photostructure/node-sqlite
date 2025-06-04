import { describe, expect, it } from "@jest/globals";
import { DatabaseSync } from "../src";
import { getTestTimeout, getTimingMultiplier, useTempDir } from "./test-utils";

describe("Simple Concurrent Access Tests", () => {
  const { getDbPath } = useTempDir("sqlite-concurrent-simple-", {
    timeout: getTestTimeout(), // Use environment-aware timeout
  });
  let dbPath: string;

  beforeEach(() => {
    dbPath = getDbPath("test.db");
  });

  it("should handle multiple database connections", () => {
    // Create database with first connection
    const db1 = new DatabaseSync(dbPath);
    db1.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
    db1.exec("INSERT INTO test (value) VALUES ('hello')");

    // Open second connection for reading
    const db2 = new DatabaseSync(dbPath, { readOnly: true });
    const result = db2.prepare("SELECT * FROM test").get();
    expect(result.value).toBe("hello");

    // Clean up
    db1.close();
    db2.close();
  });

  it("should handle WAL mode for concurrent access", () => {
    // Create database and enable WAL
    const db1 = new DatabaseSync(dbPath);
    db1.exec("PRAGMA journal_mode = WAL");
    db1.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)");

    // Insert data
    for (let i = 0; i < 10; i++) {
      db1.exec(`INSERT INTO test (value) VALUES (${i})`);
    }

    // Open multiple readers
    const readers = [];
    for (let i = 0; i < 3; i++) {
      const reader = new DatabaseSync(dbPath, { readOnly: true });
      readers.push(reader);
    }

    // All readers should see the same data
    for (const reader of readers) {
      const count = reader.prepare("SELECT COUNT(*) as count FROM test").get();
      expect(count.count).toBe(10);
    }

    // Clean up
    db1.close();
    readers.forEach((r) => r.close());
  });

  it("should handle rapid open/close cycles", () => {
    // Initialize database
    const initDb = new DatabaseSync(dbPath);
    initDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    initDb.close();

    // Rapid open/close cycles
    for (let i = 0; i < 20; i++) {
      const db = new DatabaseSync(dbPath);
      const result = db.prepare("SELECT COUNT(*) as count FROM test").get();
      expect(result.count).toBe(0);
      db.close();
    }
  });

  it("should handle concurrent prepared statements", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

    // Create multiple prepared statements
    const insertStmt = db.prepare("INSERT INTO test (value) VALUES (?)");
    const selectStmt = db.prepare("SELECT * FROM test WHERE value = ?");
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM test");

    // Use them concurrently
    insertStmt.run("test1");
    insertStmt.run("test2");
    insertStmt.run("test3");

    const count = countStmt.get();
    expect(count.count).toBe(3);

    const result = selectStmt.get("test2");
    expect(result.value).toBe("test2");

    // Clean up
    insertStmt.finalize();
    selectStmt.finalize();
    countStmt.finalize();
    db.close();
  });
});
