import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "../src";
import { rm, uniqueDbName, useTempDirSuite } from "./test-utils";

describe("File-based Database Tests", () => {
  const { tempDir, getDbPath } = useTempDirSuite("sqlite-test-");
  let dbPath: string;

  beforeEach(() => {
    // Generate unique database file for each test
    dbPath = getDbPath(uniqueDbName());
  });

  test("create and open file-based database", () => {
    expect(fs.existsSync(dbPath)).toBe(false);

    const db = new DatabaseSync(dbPath);
    expect(db.location()).toBe(fs.realpathSync(dbPath));
    expect(db.isOpen).toBe(true);

    // File should be created
    expect(fs.existsSync(dbPath)).toBe(true);

    db.close();
    expect(db.isOpen).toBe(false);

    // File should still exist after closing
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  test("persist data across database sessions", () => {
    // First session: create table and insert data
    const db1 = new DatabaseSync(dbPath);
    db1.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE
      )
    `);

    const insert = db1.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
    insert.run("Alice", "alice@example.com");
    insert.run("Bob", "bob@example.com");

    db1.close();

    // Second session: verify data persisted
    const db2 = new DatabaseSync(dbPath);
    const selectAll = db2.prepare("SELECT * FROM users ORDER BY id");
    const users = selectAll.all();

    expect(users).toEqual([
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
    ]);

    db2.close();
  });

  test("readonly database configuration", () => {
    // First create a database with some data
    const dbWrite = new DatabaseSync(dbPath);
    dbWrite.exec("CREATE TABLE test (id INTEGER, value TEXT)");
    dbWrite.exec("INSERT INTO test VALUES (1, 'initial')");
    dbWrite.close();

    // Open in readonly mode
    const dbRead = new DatabaseSync(dbPath, { readOnly: true });

    // Should be able to read data
    const result = dbRead.prepare("SELECT * FROM test").get();
    expect(result).toEqual({ id: 1, value: "initial" });

    // Should not be able to write data
    expect(() => dbRead.exec("INSERT INTO test VALUES (2, 'new')")).toThrow(
      /readonly/i,
    );
    expect(() => dbRead.exec("UPDATE test SET value = 'updated'")).toThrow(
      /readonly/i,
    );
    expect(() => dbRead.exec("DELETE FROM test")).toThrow(/readonly/i);
    expect(() => dbRead.exec("CREATE TABLE test2 (id INTEGER)")).toThrow(
      /readonly/i,
    );

    dbRead.close();
  });

  test("database file permissions and access", () => {
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE test (id INTEGER)");
    db.close();

    // Check file exists and is accessible
    expect(fs.existsSync(dbPath)).toBe(true);
    const stats = fs.statSync(dbPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);

    // File should be readable and writable by owner
    expect(stats.mode & parseInt("600", 8)).toBeGreaterThan(0);
  });

  test("database with absolute path", () => {
    const absolutePath = path.resolve(dbPath);
    const db = new DatabaseSync(absolutePath);

    expect(db.location()).toBe(fs.realpathSync(absolutePath));
    const location = db.location();
    expect(location).not.toBeNull();
    expect(path.isAbsolute(location!)).toBe(true);

    db.exec("CREATE TABLE test (id INTEGER)");
    db.close();

    expect(fs.existsSync(absolutePath)).toBe(true);
  });

  test("database with relative path", async () => {
    // Test that SQLite resolves relative paths from the current working directory
    const originalCwd = process.cwd();
    const relativePath = uniqueDbName("relative-test");

    try {
      // Ensure we have a valid temp directory for this test
      // If tempDir is empty/undefined, create our own temp directory
      let currentTempDir = tempDir;
      if (!currentTempDir) {
        currentTempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "test-relative-"),
        );
      }

      // Create temp directory if it doesn't exist
      if (!fs.existsSync(currentTempDir)) {
        fs.mkdirSync(currentTempDir, { recursive: true });
      }

      // Change to temp directory to ensure relative path resolves there
      process.chdir(currentTempDir);

      // When we pass a relative path to SQLite, it resolves it from process.cwd() (now currentTempDir)
      const expectedAbsolutePath = path.resolve(currentTempDir, relativePath);

      const db = new DatabaseSync(relativePath);

      // SQLite normalizes the path to absolute based on current working directory
      const location = db.location();
      expect(location).not.toBeNull();
      expect(location).toBe(fs.realpathSync(expectedAbsolutePath));

      db.exec("CREATE TABLE test (id INTEGER)");
      db.close();

      // Verify the file was created at the expected location (in tempDir)
      expect(fs.existsSync(expectedAbsolutePath)).toBe(true);

      // Clean up the file from the temp directory
      await rm(expectedAbsolutePath);
    } finally {
      // Always restore original working directory
      process.chdir(originalCwd);
    }
  });

  test("sequential database access to same file", () => {
    // Create and populate database
    const db1 = new DatabaseSync(dbPath);
    db1.exec("CREATE TABLE test (id INTEGER, value TEXT)");
    db1.exec("INSERT INTO test VALUES (1, 'first')");
    db1.close();

    // Reopen and verify data persists
    const db2 = new DatabaseSync(dbPath);
    const result = db2.prepare("SELECT * FROM test").get();
    expect(result).toEqual({ id: 1, value: "first" });

    // Add more data
    db2.exec("INSERT INTO test VALUES (2, 'second')");
    db2.close();

    // Open again and verify all data exists
    const db3 = new DatabaseSync(dbPath);
    const allResults = db3.prepare("SELECT * FROM test ORDER BY id").all();
    expect(allResults).toEqual([
      { id: 1, value: "first" },
      { id: 2, value: "second" },
    ]);
    db3.close();
  });

  test("database backup and restore", () => {
    const backupPath = getDbPath("backup.db");

    // Create source database with data
    const sourceDb = new DatabaseSync(dbPath);
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
    `);

    // Create backup database
    const backupDb = new DatabaseSync(backupPath);

    // Note: This is a simple copy approach since backup() function isn't implemented yet
    sourceDb.close();
    fs.copyFileSync(dbPath, backupPath);

    // Verify backup contains same data
    const restoredDb = new DatabaseSync(backupPath);
    const users = restoredDb
      .prepare("SELECT name FROM users ORDER BY id")
      .all();
    expect(users).toEqual([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
    ]);

    restoredDb.close();
    backupDb.close();
  });

  test("large dataset file operations", () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE large_test (
        id INTEGER PRIMARY KEY,
        data TEXT,
        number REAL,
        flag INTEGER
      )
    `);

    // Use a transaction for much better performance
    const insert = db.prepare(
      "INSERT INTO large_test (data, number, flag) VALUES (?, ?, ?)",
    );

    const startTime = Date.now();
    db.exec("BEGIN TRANSACTION");

    for (let i = 0; i < 1000; i++) {
      // Reduced to 1000 rows for faster tests
      insert.run(`data_${i}`, Math.random() * 1000, i % 2);
    }

    db.exec("COMMIT");
    const insertTime = Date.now() - startTime;

    // Query large dataset
    const queryStart = Date.now();
    const count = db.prepare("SELECT COUNT(*) as count FROM large_test").get();
    const queryTime = Date.now() - queryStart;

    expect(count.count).toBe(1000);

    // Performance should be reasonable with transactions
    expect(insertTime).toBeLessThan(5000); // Less than 5 seconds for 1k inserts in transaction
    expect(queryTime).toBeLessThan(100); // Less than 100ms for count query

    db.close();

    // Check file size
    const stats = fs.statSync(dbPath);
    expect(stats.size).toBeGreaterThan(5000); // Should be reasonably sized
  });

  test("database file error handling", () => {
    // Test opening database in non-existent directory
    const invalidPath = "/nonexistent/directory/test.db";
    expect(() => new DatabaseSync(invalidPath)).toThrow();

    // Create a fresh directory to test opening directory as database file
    const testDir = path.join(tempDir, "test-directory");
    fs.mkdirSync(testDir, { recursive: true });
    expect(() => new DatabaseSync(testDir)).toThrow();

    // Test corrupted database file - create a file that definitely isn't SQLite
    const corruptedPath = getDbPath("corrupted.db");
    fs.writeFileSync(corruptedPath, "This is not a SQLite database file");

    // SQLite might auto-repair or create new database, so test operations instead
    const db = new DatabaseSync(corruptedPath);
    // Try an operation that would fail on a truly corrupted database
    expect(() => db.exec("SELECT * FROM sqlite_master")).toThrow();

    try {
      db.close();
    } catch {
      // Ignore close errors for corrupted databases
    }
  });

  test("transaction persistence across sessions", () => {
    // First session: transaction with commit
    const db1 = new DatabaseSync(dbPath);
    db1.exec("CREATE TABLE txn_test (id INTEGER, value TEXT)");

    db1.exec("BEGIN TRANSACTION");
    db1.exec("INSERT INTO txn_test VALUES (1, 'committed')");
    db1.exec("COMMIT");
    db1.close();

    // Second session: verify committed data exists
    const db2 = new DatabaseSync(dbPath);
    const result = db2.prepare("SELECT * FROM txn_test").get();
    expect(result).toEqual({ id: 1, value: "committed" });

    // Third session: transaction with rollback
    db2.exec("BEGIN TRANSACTION");
    db2.exec("INSERT INTO txn_test VALUES (2, 'rollback')");
    db2.exec("ROLLBACK");
    db2.close();

    // Fourth session: verify rollback worked
    const db3 = new DatabaseSync(dbPath);
    const allResults = db3.prepare("SELECT * FROM txn_test").all();
    expect(allResults).toEqual([{ id: 1, value: "committed" }]);
    db3.close();
  });
});
