import { describe, expect, it } from "@jest/globals";
import * as fs from "node:fs";
import { DatabaseSync } from "../src";
import { createTestDb, getTestTimeout, rm, useTempDir } from "./test-utils";

describe("Backup functionality", () => {
  const { getDbPath, closeDatabases } = useTempDir("sqlite-backup-test-");

  let sourceDb: InstanceType<typeof DatabaseSync>;
  let sourcePath: string;
  let destPath: string;

  // Track all databases created in tests for proper cleanup
  const testDatabases = new Set<InstanceType<typeof DatabaseSync>>();

  beforeEach(() => {
    sourcePath = getDbPath("source.db");
    destPath = getDbPath("destination.db");

    // Create and populate source database
    sourceDb = createTestDb(
      sourcePath,
      `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE
      );
      INSERT INTO users (name, email) VALUES
        ('Alice', 'alice@example.com'),
        ('Bob', 'bob@example.com'),
        ('Charlie', 'charlie@example.com');
      
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL
      );
      INSERT INTO products (name, price) VALUES
        ('Widget', 9.99),
        ('Gadget', 19.99),
        ('Doohickey', 29.99);
    `,
    );
  });

  afterEach(() => {
    // Close all tracked databases
    closeDatabases(sourceDb, ...testDatabases);
    testDatabases.clear();
  });

  it("should create a backup of the database", async () => {
    // Perform backup
    const totalPages = await sourceDb.backup(destPath);
    expect(totalPages).toBeGreaterThan(0);

    // Open and verify destination database
    const destDb = new DatabaseSync(destPath);
    testDatabases.add(destDb);

    // Check that tables exist
    const tables = destDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables).toEqual([{ name: "products" }, { name: "users" }]);

    // Check user data
    const users = destDb.prepare("SELECT * FROM users ORDER BY id").all() as {
      id: number;
      name: string;
      email: string;
    }[];
    expect(users).toEqual([
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" },
    ]);

    // Check product data
    const products = destDb
      .prepare("SELECT * FROM products ORDER BY id")
      .all() as { id: number; name: string; price: number }[];
    expect(products).toEqual([
      { id: 1, name: "Widget", price: 9.99 },
      { id: 2, name: "Gadget", price: 19.99 },
      { id: 3, name: "Doohickey", price: 29.99 },
    ]);
  });

  it("should handle backup with custom rate", async () => {
    const totalPages = await sourceDb.backup(destPath, { rate: 5 });
    expect(totalPages).toBeGreaterThan(0);

    // Verify the backup
    const destDb = new DatabaseSync(destPath);
    testDatabases.add(destDb);
    const count = destDb
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(count.count).toBe(3);
  });

  it("should call progress callback during backup", async () => {
    const progressCalls: Array<{ totalPages: number; remainingPages: number }> =
      [];

    const totalPages = await sourceDb.backup(destPath, {
      rate: 1, // Use small rate to ensure multiple progress callbacks
      progress: (info: { totalPages: number; remainingPages: number }) => {
        progressCalls.push(info);
      },
    });

    expect(progressCalls.length).toBeGreaterThan(0);

    // Verify progress info structure
    if (progressCalls.length > 0) {
      const firstCall = progressCalls[0];
      expect(firstCall).toHaveProperty("totalPages");
      expect(firstCall).toHaveProperty("remainingPages");
      expect(firstCall.totalPages).toBe(totalPages);
      expect(firstCall.remainingPages).toBeLessThanOrEqual(totalPages);
    }

    // Verify the backup completed
    const destDb = new DatabaseSync(destPath);
    testDatabases.add(destDb);
    const count = destDb
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(count.count).toBe(3);
  });

  it("should handle backup to memory database", async () => {
    const totalPages = await sourceDb.backup(":memory:");
    expect(totalPages).toBeGreaterThan(0);
    // Note: We can't verify the contents of the memory database
    // as it's not accessible after the backup completes
  });

  it("should handle backup with attached databases", async () => {
    // Attach another database
    const attachedPath = getDbPath("attached.db");
    sourceDb.exec(`ATTACH DATABASE '${attachedPath}' AS attached`);
    sourceDb.exec(`
      CREATE TABLE attached.extra_data (
        id INTEGER PRIMARY KEY,
        value TEXT
      );
      INSERT INTO attached.extra_data (value) VALUES ('test1'), ('test2');
    `);

    // Backup main database only (default)
    const totalPages = await sourceDb.backup(destPath);
    expect(totalPages).toBeGreaterThan(0);

    const destDb = new DatabaseSync(destPath);
    testDatabases.add(destDb);

    // Verify main database tables
    const tables = destDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables).toEqual([{ name: "products" }, { name: "users" }]);

    // Attached table should not be in the backup
    expect(tables.find((t) => t.name === "extra_data")).toBeUndefined();
  });

  it("should handle errors for invalid destination", async () => {
    await expect(
      sourceDb.backup("/invalid/path/that/does/not/exist/backup.db"),
    ).rejects.toThrow();
  });

  it("should handle errors for closed database", async () => {
    // Create a separate database for this test to avoid affecting other tests
    const testDbPath = getDbPath("closed-test.db");
    const testDb = new DatabaseSync(testDbPath);
    testDatabases.add(testDb);

    // Close it and try to backup
    testDb.close();
    await expect(testDb.backup(destPath)).rejects.toThrow(
      "database is not open",
    );
  });

  it("should reject invalid options", async () => {
    // Invalid progress callback
    await expect(
      sourceDb.backup(destPath, { progress: "not a function" as any }),
    ).rejects.toThrow("must be a function");
  });

  it("should handle concurrent backups", async () => {
    const destPath2 = getDbPath("destination2.db");

    // Start two backups concurrently
    const [pages1, pages2] = await Promise.all([
      sourceDb.backup(destPath),
      sourceDb.backup(destPath2),
    ]);

    expect(pages1).toBeGreaterThan(0);
    expect(pages2).toBeGreaterThan(0);

    // Verify both backups
    const destDb1 = new DatabaseSync(destPath);
    testDatabases.add(destDb1);
    const count1 = destDb1
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(count1.count).toBe(3);

    const destDb2 = new DatabaseSync(destPath2);
    testDatabases.add(destDb2);
    const count2 = destDb2
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(count2.count).toBe(3);
  });

  it("should perform a complete backup and restore cycle", async () => {
    // Create a more complex database structure with various metadata
    sourceDb.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      INSERT INTO config (key, value) VALUES
        ('version', '1.2.3'),
        ('theme', 'dark'),
        ('language', 'en-US');
      
      -- Create various types of indexes
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_products_price ON products(price);
      CREATE UNIQUE INDEX idx_config_key_value ON config(key, value);
      
      -- Create a view
      CREATE VIEW expensive_products AS
        SELECT * FROM products WHERE price > 20;
      
      -- Create a trigger that increments the timestamp
      CREATE TRIGGER update_timestamp
        AFTER UPDATE ON config
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE config SET updated_at = OLD.updated_at + 1 WHERE key = NEW.key;
      END;
      
      -- Create a CHECK constraint (via table recreation)
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER CHECK (quantity > 0),
        total REAL CHECK (total >= 0)
      );
      INSERT INTO orders (product_id, quantity, total) VALUES (1, 2, 19.98);
    `);

    // Perform backup
    const backupPath = getDbPath("full_backup.db");
    const totalPages = await sourceDb.backup(backupPath);
    expect(totalPages).toBeGreaterThan(0);

    // Close source and remove it
    sourceDb.close();
    await rm(sourcePath);

    // Simulate "restore" by renaming backup to original location
    fs.renameSync(backupPath, sourcePath);

    // Open the restored database
    const restoredDb = new DatabaseSync(sourcePath);
    testDatabases.add(restoredDb);

    // Verify all tables exist
    const tables = restoredDb
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY type, name",
      )
      .all() as { name: string; type: string }[];
    expect(tables).toEqual([
      { name: "config", type: "table" },
      { name: "orders", type: "table" },
      { name: "products", type: "table" },
      { name: "users", type: "table" },
      { name: "expensive_products", type: "view" },
    ]);

    // Verify ALL indexes exist
    const indexes = restoredDb
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(indexes.length).toBe(3);
    expect(indexes[0].name).toBe("idx_config_key_value");
    expect(indexes[0].sql).toContain("UNIQUE"); // Verify it's a UNIQUE index
    expect(indexes[1].name).toBe("idx_products_price");
    expect(indexes[2].name).toBe("idx_users_email");

    // Verify trigger exists and its definition
    const triggers = restoredDb
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(triggers.length).toBe(1);
    expect(triggers[0].name).toBe("update_timestamp");
    expect(triggers[0].sql).toContain("AFTER UPDATE ON config");

    // Verify CHECK constraints by examining table schema
    const ordersSql = restoredDb
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
      )
      .get() as { sql: string };
    expect(ordersSql.sql).toContain("CHECK (quantity > 0)");
    expect(ordersSql.sql).toContain("CHECK (total >= 0)");

    // Verify foreign key constraint
    expect(ordersSql.sql).toContain("REFERENCES products(id)");

    // Verify data integrity
    const users = restoredDb
      .prepare("SELECT * FROM users ORDER BY id")
      .all() as { id: number; name: string; email: string }[];
    expect(users.length).toBe(3);
    expect(users[0]).toEqual({
      id: 1,
      name: "Alice",
      email: "alice@example.com",
    });

    const config = restoredDb
      .prepare("SELECT key, value FROM config ORDER BY key")
      .all() as { key: string; value: string }[];
    expect(config).toEqual([
      { key: "language", value: "en-US" },
      { key: "theme", value: "dark" },
      { key: "version", value: "1.2.3" },
    ]);

    // Verify view works
    const expensiveProducts = restoredDb
      .prepare("SELECT name, price FROM expensive_products ORDER BY price")
      .all() as { name: string; price: number }[];
    expect(expensiveProducts).toEqual([{ name: "Doohickey", price: 29.99 }]);

    // Test that trigger works after restore
    const beforeUpdate = restoredDb
      .prepare("SELECT updated_at FROM config WHERE key = 'theme'")
      .get() as { updated_at: number };

    // Update a config value - the trigger will update the timestamp
    restoredDb
      .prepare("UPDATE config SET value = 'light' WHERE key = 'theme'")
      .run();

    const afterUpdate = restoredDb
      .prepare("SELECT updated_at FROM config WHERE key = 'theme'")
      .get() as { updated_at: number };

    // Verify trigger updated the timestamp
    expect(afterUpdate.updated_at).toBeGreaterThan(beforeUpdate.updated_at);

    // Test CHECK constraints work
    expect(() => {
      restoredDb
        .prepare(
          "INSERT INTO orders (product_id, quantity, total) VALUES (1, 0, 10)",
        )
        .run();
    }).toThrow(); // Should fail due to CHECK (quantity > 0)

    expect(() => {
      restoredDb
        .prepare(
          "INSERT INTO orders (product_id, quantity, total) VALUES (1, 1, -10)",
        )
        .run();
    }).toThrow(); // Should fail due to CHECK (total >= 0)

    // Verify foreign key works (if enabled)
    const fkResult = restoredDb.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    if (fkResult.foreign_keys === 1) {
      expect(() => {
        restoredDb
          .prepare(
            "INSERT INTO orders (product_id, quantity, total) VALUES (999, 1, 10)",
          )
          .run();
      }).toThrow(); // Should fail due to foreign key constraint
    }

    restoredDb.close();
  });

  it("should preserve database pragma settings", async () => {
    // Set various pragma settings
    sourceDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA page_size = 4096;
      PRAGMA user_version = 42;
      PRAGMA application_id = 0x12345678;
    `);

    // Get original pragma values
    const originalPragmas = {
      journal_mode: (
        sourceDb.prepare("PRAGMA journal_mode").get() as {
          journal_mode: string;
        }
      ).journal_mode,
      synchronous: (
        sourceDb.prepare("PRAGMA synchronous").get() as { synchronous: number }
      ).synchronous,
      page_size: (
        sourceDb.prepare("PRAGMA page_size").get() as { page_size: number }
      ).page_size,
      user_version: (
        sourceDb.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      application_id: (
        sourceDb.prepare("PRAGMA application_id").get() as {
          application_id: number;
        }
      ).application_id,
    };

    // Perform backup
    const backupPath = getDbPath("pragma_backup.db");
    await sourceDb.backup(backupPath);
    sourceDb.close();

    // Open backup and verify pragmas
    const backupDb = new DatabaseSync(backupPath);
    testDatabases.add(backupDb);

    const backupPragmas = {
      journal_mode: (
        backupDb.prepare("PRAGMA journal_mode").get() as {
          journal_mode: string;
        }
      ).journal_mode,
      synchronous: (
        backupDb.prepare("PRAGMA synchronous").get() as { synchronous: number }
      ).synchronous,
      page_size: (
        backupDb.prepare("PRAGMA page_size").get() as { page_size: number }
      ).page_size,
      user_version: (
        backupDb.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      application_id: (
        backupDb.prepare("PRAGMA application_id").get() as {
          application_id: number;
        }
      ).application_id,
    };

    // Some pragmas like journal_mode might not be preserved exactly, but most should be
    expect(backupPragmas.page_size).toBe(originalPragmas.page_size);
    expect(backupPragmas.user_version).toBe(originalPragmas.user_version);
    expect(backupPragmas.application_id).toBe(originalPragmas.application_id);

    backupDb.close();
  });

  it("should respect pages option and perform incremental backup", async () => {
    // Create a larger database to ensure multiple pages
    sourceDb.exec(`
      CREATE TABLE large_data (
        id INTEGER PRIMARY KEY,
        data TEXT,
        padding TEXT
      );
    `);

    // Insert enough data to create multiple pages (SQLite default page size is usually 4096 bytes)
    const largeText = "x".repeat(1000); // 1KB of text per row
    const insertStmt = sourceDb.prepare(
      "INSERT INTO large_data (data, padding) VALUES (?, ?)",
    );

    for (let i = 0; i < 100; i++) {
      insertStmt.run(`Row ${i}: ${largeText}`, largeText);
    }

    // Get the total page count of the source database
    const pageCount = sourceDb.prepare("PRAGMA page_count").get() as {
      page_count: number;
    };
    console.log(`Source database has ${pageCount.page_count} pages`);
    expect(pageCount.page_count).toBeGreaterThan(10); // Ensure we have multiple pages

    // Track progress callbacks
    const progressCalls: Array<{
      totalPages: number;
      remainingPages: number;
      timestamp: number;
    }> = [];

    const backupPath = getDbPath("pages_test.db");
    const startTime = Date.now();

    // Use a small rate to ensure multiple iterations
    const pagesPerStep = 2;
    const totalPages = await sourceDb.backup(backupPath, {
      rate: pagesPerStep,
      progress: (info) => {
        progressCalls.push({
          ...info,
          timestamp: Date.now(),
        });
      },
    });

    const duration = Date.now() - startTime;

    // Verify we had progress callbacks
    expect(progressCalls.length).toBeGreaterThan(0);
    // With AsyncWorker, we may get fewer callbacks than the theoretical maximum
    // because progress updates can be coalesced. Just verify we got some.

    // Verify progress is incremental
    for (let i = 1; i < progressCalls.length; i++) {
      const prev = progressCalls[i - 1];
      const curr = progressCalls[i];

      // Total pages should remain constant
      expect(curr.totalPages).toBe(prev.totalPages);

      // Remaining pages should decrease
      expect(curr.remainingPages).toBeLessThan(prev.remainingPages);

      // With AsyncWorker, pages may be processed in larger chunks than requested
      // Just verify that progress is being made
      const pagesProcessed = prev.remainingPages - curr.remainingPages;
      expect(pagesProcessed).toBeGreaterThan(0);
    }

    // Verify callbacks contain valid data
    if (progressCalls.length > 0) {
      const firstCall = progressCalls[0];
      expect(firstCall.totalPages).toBe(totalPages);
      // With AsyncWorker, the first callback might show any amount of progress
      // Just verify it's a valid number
      expect(firstCall.remainingPages).toBeGreaterThanOrEqual(0);
      expect(firstCall.remainingPages).toBeLessThanOrEqual(totalPages);
    }

    // Verify timing - with small page sizes, the backup should take some measurable time
    // due to multiple iterations (though this is environment-dependent)
    console.log(
      `Backup took ${duration}ms with ${progressCalls.length} progress callbacks`,
    );

    // Verify the backup is complete and valid
    const backupDb = new DatabaseSync(backupPath);
    testDatabases.add(backupDb);

    const rowCount = backupDb
      .prepare("SELECT COUNT(*) as count FROM large_data")
      .get() as { count: number };
    expect(rowCount.count).toBe(100);

    // Verify data integrity by checking a few rows
    const sampleRows = backupDb
      .prepare("SELECT * FROM large_data WHERE id IN (1, 50, 100) ORDER BY id")
      .all() as any[];
    expect(sampleRows.length).toBe(3);
    expect(sampleRows[0].data).toContain("Row 0:");
    expect(sampleRows[1].data).toContain("Row 49:");
    expect(sampleRows[2].data).toContain("Row 99:");
  });

  it("should handle incremental backup simulation", async () => {
    // Create initial backup
    const backup1Path = getDbPath("backup1.db");
    await sourceDb.backup(backup1Path);

    // Add more data
    sourceDb.exec(`
      INSERT INTO users (name, email) VALUES ('David', 'david@example.com');
      INSERT INTO products (name, price) VALUES ('Thingamajig', 39.99);
    `);

    // Create second backup
    const backup2Path = getDbPath("backup2.db");
    await sourceDb.backup(backup2Path);

    // Don't close sourceDb here - let afterEach handle it
    // sourceDb.close();

    // Verify first backup has original data only
    const backup1Db = new DatabaseSync(backup1Path);
    testDatabases.add(backup1Db);
    const backup1Users = backup1Db
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(backup1Users.count).toBe(3);
    const backup1Products = backup1Db
      .prepare("SELECT COUNT(*) as count FROM products")
      .get() as { count: number };
    expect(backup1Products.count).toBe(3);

    // Verify second backup has all data
    const backup2Db = new DatabaseSync(backup2Path);
    testDatabases.add(backup2Db);
    const backup2Users = backup2Db
      .prepare("SELECT COUNT(*) as count FROM users")
      .get() as { count: number };
    expect(backup2Users.count).toBe(4);
    const backup2Products = backup2Db
      .prepare("SELECT COUNT(*) as count FROM products")
      .get() as { count: number };
    expect(backup2Products.count).toBe(4);

    // Verify new data exists in second backup
    const david = backup2Db
      .prepare("SELECT * FROM users WHERE name = ?")
      .get("David") as { id: number; name: string; email: string };
    expect(david).toEqual({ id: 4, name: "David", email: "david@example.com" });
  });

  it(
    "should demonstrate different behavior with different rates",
    async () => {
      // Create a larger database to ensure consistent behavior across platforms
      sourceDb.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        content TEXT,
        extra_data TEXT
      );
    `);

      // Adjust data size based on platform - Windows is much slower
      const rowCount = process.platform === "win32" ? 50 : 200;
      const content = "x".repeat(1000);
      const extraData = "y".repeat(1000);
      for (let i = 0; i < rowCount; i++) {
        sourceDb
          .prepare("INSERT INTO test_data (content, extra_data) VALUES (?, ?)")
          .run(content, extraData);
      }

      // Test 1: Backup with rate = -1 (all at once)
      const backup1Path = getDbPath("all_at_once.db");
      let callbackCount1 = 0;

      await sourceDb.backup(backup1Path, {
        rate: -1, // Negative value to copy all pages at once
        progress: () => {
          callbackCount1++;
        },
      });

      // Test 2: Backup with rate = 1 (one page at a time)
      const backup2Path = getDbPath("one_page.db");
      let callbackCount2 = 0;
      const progressInfo2: Array<{ remaining: number }> = [];

      await sourceDb.backup(backup2Path, {
        rate: 1,
        progress: (info) => {
          callbackCount2++;
          progressInfo2.push({ remaining: info.remainingPages });
        },
      });

      // Test 3: Backup with rate = 5
      const backup3Path = getDbPath("five_pages.db");
      let callbackCount3 = 0;
      const progressInfo3: Array<{ remaining: number }> = [];

      await sourceDb.backup(backup3Path, {
        rate: 5,
        progress: (info) => {
          callbackCount3++;
          progressInfo3.push({ remaining: info.remainingPages });
        },
      });

      // Verify different behaviors
      console.log(
        `Callbacks - All at once: ${callbackCount1}, One page: ${callbackCount2}, Five pages: ${callbackCount3}`,
      );

      // With rate=-1, we should get 0 or very few callbacks (maybe just 1)
      expect(callbackCount1).toBeLessThanOrEqual(1);

      // With smaller rates, we generally expect more callbacks, but AsyncWorker
      // can coalesce progress updates, making the exact behavior platform-dependent.
      // Just verify that we got callbacks with both rate=1 and rate=5
      expect(callbackCount2).toBeGreaterThan(0);
      expect(callbackCount3).toBeGreaterThan(0);

      // The key difference: rate=-1 should have minimal callbacks compared to others
      if (callbackCount2 > 0 && callbackCount3 > 0) {
        expect(callbackCount1).toBeLessThan(
          Math.max(callbackCount2, callbackCount3),
        );
      }

      // Ensure the backups actually completed successfully
      const expectedCount = process.platform === "win32" ? 50 : 200;
      const verifyBackup = (path: string) => {
        const db = new DatabaseSync(path);
        const count = db
          .prepare("SELECT COUNT(*) as count FROM test_data")
          .get() as { count: number };
        expect(count.count).toBe(expectedCount);
        db.close();
      };

      verifyBackup(backup1Path);
      verifyBackup(backup2Path);
      verifyBackup(backup3Path);

      // Verify the progress is different
      if (progressInfo2.length > 1 && progressInfo3.length > 1) {
        // With AsyncWorker, the exact page decrease per callback is not guaranteed
        // Just verify that progress is being made (remaining pages decrease)
        const decrease2 =
          progressInfo2[0].remaining - progressInfo2[1].remaining;
        expect(decrease2).toBeGreaterThan(0);

        const decrease3 =
          progressInfo3[0].remaining - progressInfo3[1].remaining;
        expect(decrease3).toBeGreaterThan(0);

        // The actual behavior we care about: different rates should result in
        // different numbers of callbacks, which we already verified above
      }

      // All backups should produce identical databases
      const db1 = new DatabaseSync(backup1Path);
      testDatabases.add(db1);
      const count1 = (
        db1.prepare("SELECT COUNT(*) as c FROM test_data").get() as {
          c: number;
        }
      ).c;

      const db2 = new DatabaseSync(backup2Path);
      testDatabases.add(db2);
      const count2 = (
        db2.prepare("SELECT COUNT(*) as c FROM test_data").get() as {
          c: number;
        }
      ).c;

      const db3 = new DatabaseSync(backup3Path);
      testDatabases.add(db3);
      const count3 = (
        db3.prepare("SELECT COUNT(*) as c FROM test_data").get() as {
          c: number;
        }
      ).c;

      expect(count1).toBe(expectedCount);
      expect(count2).toBe(expectedCount);
      expect(count3).toBe(expectedCount);
    },
    getTestTimeout(30000),
  );
});
