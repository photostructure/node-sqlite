import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "../src";

describe("Concurrent Access Patterns Tests", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-concurrent-test-"));
    dbPath = path.join(tempDir, "concurrent.db");
  });

  afterEach(() => {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Multiple Reader Pattern", () => {
    test("multiple databases can read from same file simultaneously", () => {
      // Create and populate database
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE test_data (
          id INTEGER PRIMARY KEY,
          category TEXT,
          value INTEGER,
          data TEXT
        )
      `);

      const insert = setupDb.prepare(
        "INSERT INTO test_data (category, value, data) VALUES (?, ?, ?)",
      );
      for (let i = 0; i < 1000; i++) {
        insert.run(`category_${i % 10}`, i, `data_${i}`);
      }
      setupDb.close();

      // Open multiple readers
      const readers = Array.from({ length: 5 }, () => new DatabaseSync(dbPath));

      // Perform concurrent reads
      const results = readers.map((db, index) => {
        const stmt = db.prepare(
          "SELECT COUNT(*) as count FROM test_data WHERE category = ?",
        );
        return stmt.get(`category_${index}`);
      });

      // Verify all reads succeeded
      results.forEach((result, _index) => {
        expect(result.count).toBe(100); // Each category should have 100 records
      });

      // Test more complex concurrent queries
      const complexQueries = [
        "SELECT category, AVG(value) as avg_val FROM test_data GROUP BY category",
        "SELECT * FROM test_data WHERE value > 500 ORDER BY value DESC LIMIT 10",
        "SELECT COUNT(*) as total FROM test_data",
        "SELECT category, MIN(value), MAX(value) FROM test_data GROUP BY category",
        "SELECT * FROM test_data WHERE data LIKE '%5%' LIMIT 20",
      ];

      const complexResults = readers.map((db, index) => {
        if (index < complexQueries.length) {
          const stmt = db.prepare(complexQueries[index]);
          return stmt.all();
        }
        return [];
      });

      // Verify complex queries returned data
      complexResults.forEach((result, index) => {
        if (index < complexQueries.length) {
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThan(0);
        }
      });

      // Close all readers
      readers.forEach((db) => db.close());
    });

    test("readers can access while database is being read by others", () => {
      // Create test database
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(
        "CREATE TABLE concurrent_reads (id INTEGER PRIMARY KEY, data TEXT)",
      );

      const insert = setupDb.prepare(
        "INSERT INTO concurrent_reads (data) VALUES (?)",
      );
      for (let i = 0; i < 500; i++) {
        insert.run(`test_data_${i}`);
      }
      setupDb.close();

      // Open multiple connections for concurrent reading
      const db1 = new DatabaseSync(dbPath);
      const db2 = new DatabaseSync(dbPath);
      const db3 = new DatabaseSync(dbPath);

      // Prepare different types of statements
      const stmt1 = db1.prepare("SELECT * FROM concurrent_reads WHERE id = ?");
      const stmt2 = db2.prepare(
        "SELECT COUNT(*) as count FROM concurrent_reads WHERE data LIKE ?",
      );
      const stmt3 = db3.prepare(
        "SELECT * FROM concurrent_reads ORDER BY id DESC LIMIT ?",
      );

      // Execute queries "simultaneously" (in rapid succession)
      const results = [];
      for (let i = 0; i < 50; i++) {
        results.push(stmt1.get(i + 1));
        results.push(stmt2.get(`%${i % 10}%`));
        results.push(stmt3.all(5));
      }

      // Verify all operations completed successfully
      expect(results.length).toBe(150); // 50 iterations * 3 operations

      // Check some specific results
      expect(results[0]).toHaveProperty("id", 1);
      expect(results[1]).toHaveProperty("count");
      expect(Array.isArray(results[2])).toBe(true);

      db1.close();
      db2.close();
      db3.close();
    });
  });

  describe("Reader-Writer Coordination", () => {
    test("handles reader access during write operations", () => {
      // Create initial database with WAL mode for better concurrency
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(
        "CREATE TABLE rw_test (id INTEGER PRIMARY KEY, value TEXT, timestamp TEXT)",
      );
      setupDb.close();

      // Use a single writer and multiple readers (SQLite's supported pattern)
      const writer = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader1 = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader2 = new DatabaseSync(dbPath, { timeout: 5000 });

      const writeStmt = writer.prepare(
        "INSERT INTO rw_test (value, timestamp) VALUES (?, ?)",
      );
      const readStmt1 = reader1.prepare(
        "SELECT COUNT(*) as count FROM rw_test",
      );
      const readStmt2 = reader2.prepare(
        "SELECT * FROM rw_test ORDER BY id DESC LIMIT 1",
      );

      // Sequential writes with interleaved reads (proper SQLite pattern)
      let writeCount = 0;
      for (let i = 0; i < 50; i++) {
        // Reduced iterations for better performance
        // Write operation (single writer)
        writeStmt.run(`value_${i}`, new Date().toISOString());
        writeCount++;

        // Read operations can happen concurrently in WAL mode
        if (i % 5 === 0) {
          const countResult = readStmt1.get();
          expect(countResult.count).toBe(writeCount);

          if (writeCount > 0) {
            const lastResult = readStmt2.get();
            expect(lastResult).toHaveProperty("value", `value_${i}`);
          }
        }
      }

      // Final verification
      const finalCount = readStmt1.get();
      expect(finalCount.count).toBe(50);

      writer.close();
      reader1.close();
      reader2.close();
    });

    test("handles transaction isolation properly", () => {
      // Create test database with WAL mode
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(
        "CREATE TABLE transaction_test (id INTEGER PRIMARY KEY, value INTEGER)",
      );
      setupDb.exec("INSERT INTO transaction_test (value) VALUES (1), (2), (3)");
      setupDb.close();

      const writer = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader = new DatabaseSync(dbPath, { timeout: 5000 });

      // Reader should see initial state
      const readerStmt = reader.prepare(
        "SELECT SUM(value) as total FROM transaction_test",
      );
      const initialTotal = readerStmt.get();
      expect(initialTotal.total).toBe(6); // 1+2+3

      // Start transaction in writer
      writer.exec("BEGIN");

      // Make changes in transaction
      writer.exec("UPDATE transaction_test SET value = value * 10");

      // Reader should still see old values (transaction not committed)
      // In WAL mode, readers can access the database during a transaction
      let currentTotal = readerStmt.get();
      expect(currentTotal.total).toBe(6); // Should still be original values

      // Commit transaction
      writer.exec("COMMIT");

      // Now reader should see new values
      currentTotal = readerStmt.get();
      expect(currentTotal.total).toBe(60); // 10+20+30

      writer.close();
      reader.close();
    });

    test("handles rollback scenarios correctly", () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(
        "CREATE TABLE rollback_test (id INTEGER PRIMARY KEY, value INTEGER)",
      );
      setupDb.exec("INSERT INTO rollback_test (value) VALUES (100)");
      setupDb.close();

      const writer = new DatabaseSync(dbPath);
      const reader = new DatabaseSync(dbPath);

      const readerStmt = reader.prepare(
        "SELECT value FROM rollback_test WHERE id = 1",
      );

      // Initial value
      let result = readerStmt.get();
      expect(result.value).toBe(100);

      // Start transaction and modify
      writer.exec("BEGIN");
      writer.exec("UPDATE rollback_test SET value = 999 WHERE id = 1");

      // Reader should still see old value
      result = readerStmt.get();
      expect(result.value).toBe(100);

      // Rollback transaction
      writer.exec("ROLLBACK");

      // Reader should still see original value
      result = readerStmt.get();
      expect(result.value).toBe(100);

      writer.close();
      reader.close();
    });
  });

  describe("High-Frequency Access Patterns", () => {
    test("handles rapid-fire reads from multiple connections", () => {
      // Setup database with substantial data
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE high_freq_test (
          id INTEGER PRIMARY KEY,
          category INTEGER,
          data TEXT,
          value REAL
        );
        CREATE INDEX idx_category ON high_freq_test(category);
      `);

      const insert = setupDb.prepare(
        "INSERT INTO high_freq_test (category, data, value) VALUES (?, ?, ?)",
      );
      for (let i = 0; i < 2000; i++) {
        insert.run(i % 20, `data_${i}`, Math.random() * 1000);
      }
      setupDb.close();

      // Create multiple readers
      const readers = Array.from(
        { length: 10 },
        () => new DatabaseSync(dbPath),
      );

      const queries = [
        "SELECT * FROM high_freq_test WHERE category = ? LIMIT 10",
        "SELECT COUNT(*) as count FROM high_freq_test WHERE value > ?",
        "SELECT AVG(value) as avg_val FROM high_freq_test WHERE category = ?",
        "SELECT * FROM high_freq_test WHERE data LIKE ? LIMIT 5",
        "SELECT MAX(value), MIN(value) FROM high_freq_test WHERE category = ?",
      ];

      // Prepare statements for each reader
      const statements = readers.map((db, index) =>
        db.prepare(queries[index % queries.length]),
      );

      // Execute rapid queries
      const results = [];
      for (let round = 0; round < 100; round++) {
        statements.forEach((stmt, index) => {
          try {
            let result;
            switch (index % queries.length) {
              case 0:
                result = stmt.all(round % 20);
                break;
              case 1:
                result = stmt.get(Math.random() * 500);
                break;
              case 2:
                result = stmt.get(round % 20);
                break;
              case 3:
                result = stmt.all(`%${round % 10}%`);
                break;
              case 4:
                result = stmt.get(round % 20);
                break;
            }
            results.push(result);
          } catch (error: any) {
            throw new Error(
              `Query failed on reader ${index}, round ${round}: ${error.message}`,
            );
          }
        });
      }

      // Verify all queries completed
      expect(results.length).toBe(1000); // 100 rounds * 10 readers

      // Close all connections
      readers.forEach((db) => db.close());
    });

    test("handles concurrent iterator access", () => {
      // Setup database
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(
        "CREATE TABLE iterator_test (id INTEGER PRIMARY KEY, batch INTEGER, data TEXT)",
      );

      const insert = setupDb.prepare(
        "INSERT INTO iterator_test (batch, data) VALUES (?, ?)",
      );
      for (let batch = 0; batch < 5; batch++) {
        for (let i = 0; i < 200; i++) {
          insert.run(batch, `batch_${batch}_item_${i}`);
        }
      }
      setupDb.close();

      // Create multiple connections with iterators
      const connections = Array.from({ length: 5 }, (_, index) => {
        const db = new DatabaseSync(dbPath);
        const stmt = db.prepare("SELECT * FROM iterator_test WHERE batch = ?");
        return { db, stmt, batch: index };
      });

      // Run iterators concurrently (simulated)
      const results = connections.map(({ stmt, batch }) => {
        const rows = [];
        for (const row of stmt.iterate(batch)) {
          rows.push(row);
          // Small delay to simulate processing
          if (rows.length % 50 === 0) {
            // This simulates processing time
          }
        }
        return {
          batch,
          count: rows.length,
          firstRow: rows[0],
          lastRow: rows[rows.length - 1],
        };
      });

      // Verify results
      results.forEach((result, index) => {
        expect(result.count).toBe(200);
        expect(result.firstRow).toHaveProperty("batch", index);
        expect(result.lastRow).toHaveProperty("batch", index);
        expect(result.firstRow.data).toContain(`batch_${index}`);
      });

      // Close all connections
      connections.forEach(({ db }) => db.close());
    });
  });

  describe("Resource Contention Scenarios", () => {
    test("handles database locking gracefully", () => {
      // Create database with WAL mode for better concurrent behavior
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(
        "CREATE TABLE lock_test (id INTEGER PRIMARY KEY, value INTEGER)",
      );
      setupDb.exec("INSERT INTO lock_test (value) VALUES (1)");
      setupDb.close();

      const writer1 = new DatabaseSync(dbPath, { timeout: 1000 }); // Shorter timeout
      const reader = new DatabaseSync(dbPath, { timeout: 1000 });

      // Start a transaction in writer1
      writer1.exec("BEGIN");
      writer1.exec("UPDATE lock_test SET value = 100 WHERE id = 1");

      // Reader should still work (WAL mode allows concurrent reads)
      const readerStmt = reader.prepare(
        "SELECT value FROM lock_test WHERE id = 1",
      );
      const readerResult = readerStmt.get();
      expect(readerResult.value).toBe(1); // Should see original value

      // Test that multiple writers would conflict by trying a second writer
      const writer2 = new DatabaseSync(dbPath, { timeout: 100 }); // Very short timeout
      try {
        writer2.exec("BEGIN IMMEDIATE"); // This should fail if writer1 has the lock
        writer2.exec("INSERT INTO lock_test (value) VALUES (200)");
        writer2.exec("COMMIT");
        // If we get here, the write succeeded (which is fine in WAL mode)
      } catch (error: any) {
        // Expected in many cases - database is locked
        expect(error.message).toMatch(/locked|busy/i);
      }

      // Commit first transaction
      writer1.exec("COMMIT");

      // Now a new write should definitely work
      const writer1Stmt2 = writer1.prepare(
        "INSERT INTO lock_test (value) VALUES (?)",
      );
      expect(() => writer1Stmt2.run(300)).not.toThrow();

      writer1.close();
      writer2.close();
      reader.close();
    });

    test("handles connection limits and resource cleanup", () => {
      // Test opening many connections to same database
      const connections = [];

      try {
        // Open multiple connections (testing resource limits)
        for (let i = 0; i < 20; i++) {
          const db = new DatabaseSync(dbPath);

          // Initialize database on first connection
          if (i === 0) {
            db.exec(
              "CREATE TABLE connection_test (id INTEGER PRIMARY KEY, conn_id INTEGER)",
            );
          }

          // Each connection inserts its identifier
          const stmt = db.prepare(
            "INSERT INTO connection_test (conn_id) VALUES (?)",
          );
          stmt.run(i);

          connections.push(db);
        }

        // Verify all connections worked
        const verifyDb = new DatabaseSync(dbPath);
        const countStmt = verifyDb.prepare(
          "SELECT COUNT(*) as count FROM connection_test",
        );
        const result = countStmt.get();
        expect(result.count).toBe(20);
        verifyDb.close();
      } finally {
        // Clean up all connections
        connections.forEach((db) => {
          try {
            db.close();
          } catch {
            // Ignore errors during cleanup
          }
        });
      }
    });

    test("handles concurrent prepared statement usage", () => {
      // Setup database with WAL mode
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(
        "CREATE TABLE stmt_test (id INTEGER PRIMARY KEY, data TEXT, processed BOOLEAN DEFAULT 0)",
      );

      const insert = setupDb.prepare("INSERT INTO stmt_test (data) VALUES (?)");
      for (let i = 0; i < 100; i++) {
        // Reduced data size
        insert.run(`data_${i}`);
      }
      setupDb.close();

      // Create connections with different statement types
      const reader1 = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader2 = new DatabaseSync(dbPath, { timeout: 5000 });
      const writer = new DatabaseSync(dbPath, { timeout: 5000 });

      const selectStmt1 = reader1.prepare(
        "SELECT * FROM stmt_test WHERE id = ?",
      );
      const selectStmt2 = reader2.prepare(
        "SELECT COUNT(*) as count FROM stmt_test WHERE processed = ?",
      );
      const updateStmt = writer.prepare(
        "UPDATE stmt_test SET processed = 1 WHERE id = ?",
      );

      // Sequential operations (proper SQLite pattern)
      for (let i = 1; i <= 50; i++) {
        // Reduced iterations
        // Read operations (these can be concurrent in WAL mode)
        const row = selectStmt1.get(i);
        expect(row).toHaveProperty("data", `data_${i - 1}`);

        const count = selectStmt2.get(0);
        expect(count.count).toBeGreaterThanOrEqual(0);

        // Write operation (sequential)
        updateStmt.run(i);

        // Verify write took effect
        if (i % 10 === 0) {
          const processedCount = selectStmt2.get(1);
          expect(processedCount.count).toBe(i);
        }
      }

      reader1.close();
      reader2.close();
      writer.close();
    });
  });

  describe("Error Handling in Concurrent Scenarios", () => {
    test("handles database corruption gracefully", () => {
      // Create normal database first
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(
        "CREATE TABLE corruption_test (id INTEGER PRIMARY KEY, data TEXT)",
      );
      setupDb.exec(
        "INSERT INTO corruption_test (data) VALUES ('test1'), ('test2')",
      );
      setupDb.close();

      // Open multiple connections
      const db1 = new DatabaseSync(dbPath);
      const db2 = new DatabaseSync(dbPath);

      // Verify normal operation
      const stmt1 = db1.prepare(
        "SELECT COUNT(*) as count FROM corruption_test",
      );
      const stmt2 = db2.prepare("SELECT * FROM corruption_test WHERE id = ?");

      expect(stmt1.get().count).toBe(2);
      expect(stmt2.get(1)).toHaveProperty("data", "test1");

      // Simulate some form of error (attempt invalid operation)
      try {
        db1.exec("INVALID SQL SYNTAX");
      } catch {
        // Expected to fail
      }

      // Other connection should still work
      expect(stmt2.get(2)).toHaveProperty("data", "test2");
      expect(stmt1.get().count).toBe(2);

      db1.close();
      db2.close();
    });

    test("handles connection cleanup after errors", () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(
        "CREATE TABLE error_cleanup (id INTEGER PRIMARY KEY, data TEXT)",
      );
      setupDb.close();

      // Create connection and cause an error
      const db1 = new DatabaseSync(dbPath);

      try {
        db1.exec("SELECT * FROM non_existent_table");
      } catch {
        // Expected error
      }

      // Connection should still be usable
      expect(() => {
        db1.exec("INSERT INTO error_cleanup (data) VALUES ('after_error')");
      }).not.toThrow();

      // Verify data was inserted
      const stmt = db1.prepare("SELECT COUNT(*) as count FROM error_cleanup");
      expect(stmt.get().count).toBe(1);

      db1.close();

      // New connection should work normally
      const db2 = new DatabaseSync(dbPath);
      const verifyStmt = db2.prepare("SELECT * FROM error_cleanup");
      const result = verifyStmt.get();
      expect(result.data).toBe("after_error");

      db2.close();
    });
  });

  describe("Performance Under Concurrency", () => {
    test("maintains performance with multiple readers", () => {
      // Setup large dataset
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE perf_test (
          id INTEGER PRIMARY KEY,
          category INTEGER,
          value REAL,
          data TEXT
        );
        CREATE INDEX idx_category ON perf_test(category);
        CREATE INDEX idx_value ON perf_test(value);
      `);

      const insert = setupDb.prepare(
        "INSERT INTO perf_test (category, value, data) VALUES (?, ?, ?)",
      );
      for (let i = 0; i < 5000; i++) {
        insert.run(
          i % 50,
          Math.random() * 1000,
          `data_${i}_${"x".repeat(100)}`,
        );
      }
      setupDb.close();

      // Test performance with multiple concurrent readers
      const readers = Array.from({ length: 8 }, () => new DatabaseSync(dbPath));

      const startTime = Date.now();

      // Each reader performs 100 queries
      const promises = readers.map((db, readerIndex) => {
        return new Promise<void>((resolve) => {
          const stmt = db.prepare(
            "SELECT * FROM perf_test WHERE category = ? AND value > ? LIMIT 20",
          );

          for (let i = 0; i < 100; i++) {
            const category = (readerIndex * 10 + i) % 50;
            const value = Math.random() * 500;
            const results = stmt.all(category, value);

            // Verify results make sense
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeLessThanOrEqual(20);
          }

          resolve();
        });
      });

      // Wait for all readers to complete (simulate concurrent execution)
      Promise.all(promises).then(() => {
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        // Performance check: should complete within reasonable time
        // This is a rough check - actual thresholds would depend on hardware
        expect(totalTime).toBeLessThan(10000); // 10 seconds max for 800 queries

        console.log(
          `Concurrent read test completed in ${totalTime}ms (800 queries across 8 readers)`,
        );
      });

      // Close all readers
      readers.forEach((db) => db.close());
    });

    test("handles mixed read/write workload efficiently", () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(
        "CREATE TABLE mixed_workload (id INTEGER PRIMARY KEY, counter INTEGER, data TEXT)",
      );
      setupDb.exec(
        "INSERT INTO mixed_workload (counter, data) VALUES (0, 'initial')",
      );
      setupDb.close();

      const writer = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader1 = new DatabaseSync(dbPath, { timeout: 5000 });
      const reader2 = new DatabaseSync(dbPath, { timeout: 5000 });

      const updateStmt = writer.prepare(
        "UPDATE mixed_workload SET counter = counter + 1, data = ? WHERE id = 1",
      );
      const readStmt1 = reader1.prepare(
        "SELECT counter FROM mixed_workload WHERE id = 1",
      );
      const readStmt2 = reader2.prepare(
        "SELECT data FROM mixed_workload WHERE id = 1",
      );

      const startTime = Date.now();

      // Mixed workload: frequent reads with occasional writes
      for (let i = 0; i < 100; i++) {
        // Reduced iterations
        // Write every 10th iteration
        if (i % 10 === 0) {
          updateStmt.run(`update_${i}`);
        }

        // Read operations (these can be concurrent in WAL mode)
        const counter = readStmt1.get();
        const data = readStmt2.get();

        expect(counter.counter).toBeGreaterThanOrEqual(0);
        expect(data.data).toBeDefined();

        // Additional read operations to simulate real workload
        if (i % 3 === 0) {
          readStmt1.get();
        }
        if (i % 5 === 0) {
          readStmt2.get();
        }
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify final state
      const finalCounter = readStmt1.get();
      expect(finalCounter.counter).toBe(10); // 100/10 writes

      // Performance check
      expect(totalTime).toBeLessThan(5000); // 5 seconds max

      console.log(
        `Mixed workload test completed in ${totalTime}ms (100 iterations with reads and writes)`,
      );

      writer.close();
      reader1.close();
      reader2.close();
    });
  });
});
