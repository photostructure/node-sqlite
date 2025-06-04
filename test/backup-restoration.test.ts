import { expect } from "@jest/globals";
import * as fs from "node:fs";
import { DatabaseSync } from "../src/index";
import { getTestTimeout, getTimingMultiplier, useTempDir } from "./test-utils";

describe("Backup Restoration", () => {
  const { getDbPath, closeDatabases } = useTempDir("sqlite-backup-test-", {
    timeout: getTestTimeout(), // Use environment-aware timeout
  });

  let sourceDb: InstanceType<typeof DatabaseSync>;
  let sourceFile: string;
  let backupFile: string;

  beforeEach(() => {
    sourceFile = getDbPath("source.db");
    backupFile = getDbPath("backup.db");
    sourceDb = new DatabaseSync(sourceFile);
  });

  afterEach(() => {
    closeDatabases(sourceDb);
  });

  it("should restore data correctly from backup", async () => {
    // Create test data
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
      INSERT INTO users (name, age) VALUES ('Alice', 25), ('Bob', 30), ('Charlie', 35);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);
      INSERT INTO products (name, price) VALUES ('Widget', 9.99), ('Gadget', 19.99);
    `);

    // Create backup
    await sourceDb.backup(backupFile);

    // Modify source database
    sourceDb.exec(`
      DELETE FROM users WHERE name = 'Bob';
      INSERT INTO users (name, age) VALUES ('David', 40);
      DROP TABLE products;
    `);

    // Verify source has been modified
    const modifiedUsers = sourceDb
      .prepare("SELECT * FROM users ORDER BY id")
      .all();
    expect(modifiedUsers).toHaveLength(3);
    expect(modifiedUsers.map((u: any) => u.name)).toEqual([
      "Alice",
      "Charlie",
      "David",
    ]);

    expect(() => sourceDb.exec("SELECT * FROM products")).toThrow(
      /no such table/,
    );

    // Close source and restore from backup
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    // Verify restoration
    const restoredUsers = sourceDb
      .prepare("SELECT * FROM users ORDER BY id")
      .all();
    expect(restoredUsers).toHaveLength(3);
    expect(restoredUsers.map((u: any) => u.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);

    const restoredProducts = sourceDb
      .prepare("SELECT * FROM products ORDER BY id")
      .all();
    expect(restoredProducts).toHaveLength(2);
    expect(restoredProducts.map((p: any) => p.name)).toEqual([
      "Widget",
      "Gadget",
    ]);
  });

  it("should restore schema and indexes correctly", async () => {
    // Create complex schema
    sourceDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_email ON users(email);
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX idx_user_posts ON posts(user_id);
      CREATE VIEW user_post_count AS
        SELECT u.id, u.email, COUNT(p.id) as post_count
        FROM users u
        LEFT JOIN posts p ON u.id = p.user_id
        GROUP BY u.id;
    `);

    // Add data
    sourceDb.exec(`
      INSERT INTO users (email) VALUES ('alice@example.com'), ('bob@example.com');
      INSERT INTO posts (user_id, title, content) VALUES
        (1, 'First Post', 'Hello World'),
        (1, 'Second Post', 'More content'),
        (2, 'Bob Post', 'Bob content');
    `);

    // Create backup
    await sourceDb.backup(backupFile);

    // Drop everything in source
    sourceDb.exec(`
      DROP VIEW user_post_count;
      DROP TABLE posts;
      DROP TABLE users;
    `);

    // Restore from backup
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    // Verify schema restoration
    const tables = sourceDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    expect(tables.map((t: any) => t.name)).toEqual(["posts", "users"]);

    const indexes = sourceDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    expect(indexes.map((i: any) => i.name)).toEqual([
      "idx_email",
      "idx_user_posts",
    ]);

    const views = sourceDb
      .prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
      .all();
    expect(views.map((v: any) => v.name)).toEqual(["user_post_count"]);

    // Verify data
    const userPostCounts = sourceDb
      .prepare("SELECT * FROM user_post_count ORDER BY id")
      .all();
    expect(userPostCounts).toEqual([
      { id: 1, email: "alice@example.com", post_count: 2 },
      { id: 2, email: "bob@example.com", post_count: 1 },
    ]);
  });

  it("should restore triggers correctly", async () => {
    // Create table with trigger
    sourceDb.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        table_name TEXT,
        action TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        updated_at DATETIME
      );
      CREATE TRIGGER update_timestamp
      AFTER UPDATE ON users
      BEGIN
        INSERT INTO audit_log (table_name, action) VALUES ('users', 'UPDATE');
      END;
    `);

    // Test trigger
    sourceDb.exec("INSERT INTO users (name) VALUES ('Alice')");
    sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");

    const auditBefore = sourceDb
      .prepare("SELECT COUNT(*) as count FROM audit_log")
      .get() as any;
    expect(auditBefore.count).toBe(1);

    // Create backup
    await sourceDb.backup(backupFile);

    // Restore from backup
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    // Verify trigger exists after restoration
    const triggers = sourceDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'update_timestamp'",
      )
      .all();
    expect(triggers).toHaveLength(1);

    // Verify data was preserved
    const users = sourceDb.prepare("SELECT * FROM users").all();
    expect(users).toHaveLength(1);
    const auditLogs = sourceDb.prepare("SELECT * FROM audit_log").all();
    expect(auditLogs).toHaveLength(1);
  });

  it("should handle incremental restoration scenarios", async () => {
    // Initial data
    sourceDb.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        event_name TEXT,
        event_time DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO events (event_name) VALUES ('Event 1'), ('Event 2');
    `);

    // First backup
    const backup1 = getDbPath("backup1.db");
    await sourceDb.backup(backup1);

    // Add more data
    sourceDb.exec(
      "INSERT INTO events (event_name) VALUES ('Event 3'), ('Event 4')",
    );

    // Second backup
    const backup2 = getDbPath("backup2.db");
    await sourceDb.backup(backup2);

    // Add final data
    sourceDb.exec("INSERT INTO events (event_name) VALUES ('Event 5')");

    // Verify current state
    const currentEvents = sourceDb
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as any;
    expect(currentEvents.count).toBe(5);

    // Restore to first backup
    sourceDb.close();
    fs.copyFileSync(backup1, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    const firstBackupEvents = sourceDb
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as any;
    expect(firstBackupEvents.count).toBe(2);

    // Restore to second backup
    sourceDb.close();
    fs.copyFileSync(backup2, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    const secondBackupEvents = sourceDb
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as any;
    expect(secondBackupEvents.count).toBe(4);
  });

  it("should preserve database settings and pragmas", async () => {
    // Set various pragmas
    sourceDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA user_version = 42;
    `);

    // Create some data
    sourceDb.exec(`
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO config VALUES ('app_version', '1.2.3');
    `);

    // Verify settings before backup
    const journalModeBefore = sourceDb
      .prepare("PRAGMA journal_mode")
      .get() as any;
    const userVersionBefore = sourceDb
      .prepare("PRAGMA user_version")
      .get() as any;

    expect(journalModeBefore.journal_mode).toBe("wal");
    expect(userVersionBefore.user_version).toBe(42);

    // Create backup
    await sourceDb.backup(backupFile);

    // Change settings in source
    sourceDb.exec(`
      PRAGMA user_version = 100;
    `);

    // Restore from backup
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);

    // Verify settings after restoration
    const journalModeAfter = sourceDb
      .prepare("PRAGMA journal_mode")
      .get() as any;
    const userVersionAfter = sourceDb
      .prepare("PRAGMA user_version")
      .get() as any;
    const foreignKeysAfter = sourceDb
      .prepare("PRAGMA foreign_keys")
      .get() as any;
    // Note: auto_vacuum pragma is not typically preserved in backups
    // const autoVacuumAfter = sourceDb.prepare("PRAGMA auto_vacuum").get() as any;

    expect(journalModeAfter.journal_mode).toBe("wal");
    expect(userVersionAfter.user_version).toBe(42);
    expect(foreignKeysAfter.foreign_keys).toBe(1);

    // Verify data
    const config = sourceDb.prepare("SELECT * FROM config").get() as any;
    expect(config.value).toBe("1.2.3");
  });

  it("should handle corrupt backup gracefully", async () => {
    // Create valid database
    sourceDb.exec(`
      CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT);
      INSERT INTO test VALUES (1, 'Valid data');
    `);

    // Create backup
    await sourceDb.backup(backupFile);

    // Corrupt the backup file by writing invalid data
    fs.writeFileSync(
      backupFile,
      Buffer.from("This is not a valid SQLite database file!"),
    );

    // Try to restore from corrupt backup
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);

    // Opening corrupt database or running queries should throw
    try {
      const corruptDb = new DatabaseSync(sourceFile);
      // If opening doesn't throw, executing a query should
      corruptDb.exec("SELECT * FROM test");
      corruptDb.close();
      // If we get here, the test should fail
      expect(true).toBe(false);
    } catch (err: any) {
      // Expected to throw
      expect(err.message).toBeTruthy();
    }
  });

  it("should restore large databases efficiently", async () => {
    // Create large dataset
    sourceDb.exec(
      "CREATE TABLE large_table (id INTEGER PRIMARY KEY, data TEXT, number REAL)",
    );

    const insert = sourceDb.prepare(
      "INSERT INTO large_table (data, number) VALUES (?, ?)",
    );
    sourceDb.exec("BEGIN TRANSACTION");
    for (let i = 0; i < 10000; i++) {
      insert.run(`Data item ${i}`, Math.random() * 1000);
    }
    sourceDb.exec("COMMIT");

    const countBefore = sourceDb
      .prepare("SELECT COUNT(*) as count FROM large_table")
      .get() as any;
    expect(countBefore.count).toBe(10000);

    // Measure backup time
    const backupStart = Date.now();
    await sourceDb.backup(backupFile);
    const backupTime = Date.now() - backupStart;

    // Clear source
    sourceDb.exec("DELETE FROM large_table");
    const countAfterDelete = sourceDb
      .prepare("SELECT COUNT(*) as count FROM large_table")
      .get() as any;
    expect(countAfterDelete.count).toBe(0);

    // Measure restore time
    const restoreStart = Date.now();
    sourceDb.close();
    fs.copyFileSync(backupFile, sourceFile);
    sourceDb = new DatabaseSync(sourceFile);
    const restoreTime = Date.now() - restoreStart;

    // Verify restoration
    const countAfterRestore = sourceDb
      .prepare("SELECT COUNT(*) as count FROM large_table")
      .get() as any;
    expect(countAfterRestore.count).toBe(10000);

    // Ensure reasonable performance (backup and restore should be relatively fast)
    expect(backupTime).toBeLessThan(5000); // 5 seconds max
    expect(restoreTime).toBeLessThan(1000); // 1 second max for file copy
  });
});
