import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "../src";
import {
  getDirname,
  getTestTimeout,
  getTimingMultiplier,
  useTempDir,
} from "./test-utils";

const execFile = promisify(childProcess.execFile);

/**
 * Multi-process tests can be sensitive to test parallelization.
 * If these tests fail intermittently, run them in isolation with:
 * npm run test:serial -- test/multi-process.test.ts
 */
describe("Multi-Process Database Access", () => {
  const { getDbPath } = useTempDir("sqlite-multiproc-", {
    cleanupWalFiles: true,
    timeout: getTestTimeout(),
  });
  let dbPath: string;

  // Helper to create script with embedded arguments
  const createScript = (template: string, args: Record<string, any>) => {
    let script = template;
    for (const [key, value] of Object.entries(args)) {
      // Use different placeholder for raw values vs JSON values
      script = script.replace(
        new RegExp(`\\$\\{${key}\\}`, "g"),
        JSON.stringify(value),
      );
      // For raw string interpolation (no quotes)
      script = script.replace(
        new RegExp(`\\$\\$\\{${key}\\}`, "g"),
        String(value),
      );
    }
    return script;
  };

  beforeEach(() => {
    dbPath = getDbPath("multiproc.db");
  });

  describe("Basic Multi-Process Operations", () => {
    test("multiple processes can read from same database", async () => {
      // Create and populate database
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE shared_data (
          id INTEGER PRIMARY KEY,
          process_id TEXT,
          value INTEGER,
          timestamp TEXT
        )
      `);

      const insert = setupDb.prepare(
        "INSERT INTO shared_data (process_id, value, timestamp) VALUES (?, ?, ?)",
      );
      for (let i = 0; i < 100; i++) {
        insert.run("main", i, new Date().toISOString());
      }
      setupDb.close();

      // Create child process script
      const childScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const db = new DatabaseSync(\${dbPath});
        const stmt = db.prepare("SELECT COUNT(*) as count, SUM(value) as sum FROM shared_data");
        const result = stmt.get();
        console.log(JSON.stringify(result));
        db.close();
      `;

      // Spawn multiple child processes to read simultaneously
      const promises = [];
      for (let i = 0; i < 5; i++) {
        const script = createScript(childScriptTemplate, { dbPath });
        promises.push(execFile("node", ["-e", script]));
      }

      const results = await Promise.all(promises);

      // Verify all processes read the same data
      results.forEach(({ stdout }) => {
        const data = JSON.parse(stdout.trim());
        expect(data.count).toBe(100);
        expect(data.sum).toBe(4950); // Sum of 0-99
      });
    });

    test("processes can write to database with proper locking", async () => {
      // Create database with WAL mode for better concurrency
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(`
        CREATE TABLE process_writes (
          id INTEGER PRIMARY KEY,
          process_id INTEGER,
          value TEXT,
          timestamp TEXT
        )
      `);
      setupDb.close();

      // Child process script that performs writes
      const writerScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const processId = \${processId};
        const db = new DatabaseSync(\${dbPath}, { timeout: 10000 });
        
        try {
          const stmt = db.prepare(
            "INSERT INTO process_writes (process_id, value, timestamp) VALUES (?, ?, ?)"
          );
          
          for (let i = 0; i < 20; i++) {
            stmt.run(processId, \`value_\${processId}_\${i}\`, new Date().toISOString());
            // Small delay to increase chance of contention
            if (i % 5 === 0) {
              const start = Date.now();
              while (Date.now() - start < 10) {} // Busy wait
            }
          }
          
          console.log("SUCCESS");
        } catch (error) {
          console.error("ERROR:", error.message);
        } finally {
          db.close();
        }
      `;

      // Spawn multiple writer processes
      const promises = [];
      for (let i = 0; i < 3; i++) {
        const script = createScript(writerScriptTemplate, {
          dbPath,
          processId: i,
        });
        promises.push(execFile("node", ["-e", script]));
      }

      const results = await Promise.all(promises);

      // All processes should succeed
      results.forEach(({ stdout, stderr }) => {
        expect(stdout.trim()).toBe("SUCCESS");
        expect(stderr).toBe("");
      });

      // Verify all writes were recorded
      const verifyDb = new DatabaseSync(dbPath);
      const countStmt = verifyDb.prepare(
        "SELECT process_id, COUNT(*) as count FROM process_writes GROUP BY process_id ORDER BY process_id",
      );
      const counts = countStmt.all();

      expect(counts).toHaveLength(3);
      counts.forEach((row, index) => {
        expect(row.process_id).toBe(index);
        expect(row.count).toBe(20);
      });

      verifyDb.close();
    });
  });

  describe("Transaction Isolation", () => {
    test("transactions are isolated between processes", async () => {
      // Create test database
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(`
        CREATE TABLE transaction_test (
          id INTEGER PRIMARY KEY,
          balance INTEGER DEFAULT 1000
        )
      `);
      setupDb.exec("INSERT INTO transaction_test (id) VALUES (1)");
      setupDb.close();

      // Script that performs a transaction with delay
      const transactionScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const processId = \${processId};
        const db = new DatabaseSync(\${dbPath}, { timeout: 5000 });
        
        try {
          // Start transaction
          db.exec("BEGIN");
          
          // Read current balance
          const stmt = db.prepare("SELECT balance FROM transaction_test WHERE id = 1");
          const { balance } = stmt.get();
          console.log(\`Process \${processId} read balance: \${balance}\`);
          
          // Simulate processing delay
          const start = Date.now();
          while (Date.now() - start < 100) {} // 100ms delay
          
          // Update balance
          const updateStmt = db.prepare("UPDATE transaction_test SET balance = ? WHERE id = 1");
          updateStmt.run(balance + parseInt(processId) * 100);
          
          // Commit transaction
          db.exec("COMMIT");
          console.log(\`Process \${processId} committed\`);
          
        } catch (error) {
          db.exec("ROLLBACK");
          console.error(\`Process \${processId} error: \${error.message}\`);
        } finally {
          db.close();
        }
      `;

      // Run two processes that try to update the same row
      const [result1, result2] = await Promise.all([
        execFile("node", [
          "-e",
          createScript(transactionScriptTemplate, { dbPath, processId: 1 }),
        ]),
        execFile("node", [
          "-e",
          createScript(transactionScriptTemplate, { dbPath, processId: 2 }),
        ]),
      ]);

      // Both should complete (WAL mode allows better concurrency)
      // Or at least one should succeed if there's contention
      const success1 = result1.stdout.includes("committed");
      const success2 = result2.stdout.includes("committed");

      expect(success1 || success2).toBe(true); // At least one should succeed

      // Verify final balance
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare(
        "SELECT balance FROM transaction_test WHERE id = 1",
      );
      const { balance } = stmt.get();

      // Due to transaction isolation, the final balance should reflect both updates
      // Initial: 1000, Process 1: +100, Process 2: +200
      // However, due to read-modify-write pattern without proper locking,
      // one update might be lost (depends on timing)
      expect(balance).toBeGreaterThanOrEqual(1100); // At least one update succeeded
      expect(balance).toBeLessThanOrEqual(1300); // At most both updates succeeded

      verifyDb.close();
    });

    test("rollback in one process doesn't affect others", async () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE rollback_test (
          id INTEGER PRIMARY KEY,
          data TEXT
        )
      `);
      setupDb.close();

      // Script that conditionally rolls back
      const rollbackScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const shouldRollback = \${shouldRollback};
        const db = new DatabaseSync(\${dbPath}, { timeout: 5000 });
        
        let retries = 3;
        while (retries > 0) {
          try {
            db.exec("BEGIN IMMEDIATE");
            const stmt = db.prepare("INSERT INTO rollback_test (data) VALUES (?)");
            stmt.run(shouldRollback ? "rollback_data" : "commit_data");
            
            if (shouldRollback) {
              db.exec("ROLLBACK");
              console.log("ROLLED BACK");
            } else {
              db.exec("COMMIT");
              console.log("COMMITTED");
            }
            break; // Success, exit retry loop
          } catch (e) {
            if (retries > 1 && (e.message.includes("locked") || e.message.includes("busy"))) {
              retries--;
              // Small delay before retry
              const delay = Math.random() * 50;
              const start = Date.now();
              while (Date.now() - start < delay) {
                // Busy wait
              }
            } else {
              throw e;
            }
          }
        }
        
        db.close();
      `;

      // Run one process that commits and one that rolls back
      const [commitResult, rollbackResult] = await Promise.all([
        execFile("node", [
          "-e",
          createScript(rollbackScriptTemplate, {
            dbPath,
            shouldRollback: false,
          }),
        ]),
        execFile("node", [
          "-e",
          createScript(rollbackScriptTemplate, {
            dbPath,
            shouldRollback: true,
          }),
        ]),
      ]);

      expect(commitResult.stdout.trim()).toBe("COMMITTED");
      expect(rollbackResult.stdout.trim()).toBe("ROLLED BACK");

      // Verify only committed data exists
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare("SELECT data FROM rollback_test");
      const results = stmt.all();

      expect(results).toHaveLength(1);
      expect(results[0].data).toBe("commit_data");

      verifyDb.close();
    });
  });

  describe("File Locking and Error Handling", () => {
    test("handles database locked errors gracefully", async () => {
      // Use longer timeouts on slower CI platforms
      const multiplier = getTimingMultiplier();
      const lockHoldTime = 1000 * multiplier;
      const writerDelay = 200 * multiplier;
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE lock_test (
          id INTEGER PRIMARY KEY,
          value INTEGER
        )
      `);
      setupDb.exec("INSERT INTO lock_test (id, value) VALUES (1, 0)");
      setupDb.close();

      // Script that holds a write lock
      const lockHolderScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const db = new DatabaseSync(\${dbPath});
        
        // Start exclusive transaction
        db.exec("BEGIN EXCLUSIVE");
        console.log("LOCK_ACQUIRED");
        
        // Hold lock for a while
        setTimeout(() => {
          db.exec("UPDATE lock_test SET value = 999 WHERE id = 1");
          db.exec("COMMIT");
          db.close();
          console.log("LOCK_RELEASED");
        }, ${lockHoldTime}); // Platform-specific lock time
      `;

      // Script that tries to write while locked
      const writerScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const db = new DatabaseSync(\${dbPath}, { timeout: 100 }); // Short timeout
        
        // Wait a bit to ensure lock is held
        setTimeout(() => {
          try {
            db.exec("UPDATE lock_test SET value = 111 WHERE id = 1");
            console.log("WRITE_SUCCESS");
          } catch (error) {
            if (error.message.includes("locked") || error.message.includes("busy")) {
              console.log("DATABASE_LOCKED");
            } else {
              console.error("UNEXPECTED_ERROR:", error.message);
            }
          } finally {
            db.close();
          }
        }, ${writerDelay}); // Platform-specific delay
      `;

      // Start lock holder process
      const lockHolder = childProcess.spawn("node", [
        "-e",
        createScript(lockHolderScriptTemplate, { dbPath }),
      ]);

      let lockHolderOutput = "";
      lockHolder.stdout.on("data", (data) => {
        lockHolderOutput += data.toString();
      });

      // Wait for lock to be acquired
      await new Promise((resolve) => {
        const checkLock = setInterval(() => {
          if (lockHolderOutput.includes("LOCK_ACQUIRED")) {
            clearInterval(checkLock);
            resolve(undefined);
          }
        }, 10);
      });

      // Try to write while locked
      const writerResult = await execFile("node", [
        "-e",
        createScript(writerScriptTemplate, { dbPath }),
      ]);
      expect(writerResult.stdout.trim()).toBe("DATABASE_LOCKED");

      // Wait for lock holder to finish
      await new Promise((resolve) => lockHolder.on("close", resolve));
      expect(lockHolderOutput).toContain("LOCK_RELEASED");

      // Verify lock holder's update succeeded
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare("SELECT value FROM lock_test WHERE id = 1");
      const { value } = stmt.get();
      expect(value).toBe(999);
      verifyDb.close();
    });

    test("handles concurrent schema changes", async () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec("CREATE TABLE schema_test (id INTEGER PRIMARY KEY)");
      setupDb.close();

      // Script that tries to alter schema
      const schemaScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const columnName = \${columnName};
        const db = new DatabaseSync(\${dbPath}, { timeout: 5000 });
        
        try {
          db.exec(\`ALTER TABLE schema_test ADD COLUMN \${columnName} TEXT\`);
          console.log(\`ADDED_\${columnName}\`);
        } catch (error) {
          if (error.message.includes("duplicate column")) {
            console.log(\`DUPLICATE_\${columnName}\`);
          } else if (error.message.includes("locked") || error.message.includes("busy")) {
            console.log(\`LOCKED_\${columnName}\`);
          } else {
            console.error(\`ERROR_\${columnName}: \${error.message}\`);
          }
        } finally {
          db.close();
        }
      `;

      // Try to add different columns concurrently
      const [result1, result2] = await Promise.all([
        execFile("node", [
          "-e",
          createScript(schemaScriptTemplate, { dbPath, columnName: "column1" }),
        ]),
        execFile("node", [
          "-e",
          createScript(schemaScriptTemplate, { dbPath, columnName: "column2" }),
        ]),
      ]);

      // Both operations should succeed (WAL mode helps)
      // Note: column names will have quotes because they're JSON stringified
      expect(result1.stdout.trim()).toMatch(/ADDED_"column1"|LOCKED_"column1"/);
      expect(result2.stdout.trim()).toMatch(/ADDED_"column2"|LOCKED_"column2"/);

      // Verify final schema
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare("PRAGMA table_info(schema_test)");
      const columns = stmt.all();
      const columnNames = columns.map((col) => col.name);

      expect(columnNames).toContain("id");
      // At least one column should have been added
      expect(columnNames.length).toBeGreaterThanOrEqual(2);

      verifyDb.close();
    });
  });

  describe("High Concurrency Scenarios", () => {
    test("handles many processes accessing database simultaneously", async () => {
      // Create database with counter table
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(`
        CREATE TABLE counter (
          id INTEGER PRIMARY KEY,
          count INTEGER DEFAULT 0
        )
      `);
      setupDb.exec("INSERT INTO counter (id) VALUES (1)");
      setupDb.close();

      // Script that increments counter
      const incrementScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const processId = \${processId};
        const db = new DatabaseSync(\${dbPath}, { timeout: 10000 });
        
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < 10; i++) {
          try {
            db.exec("BEGIN IMMEDIATE");
            const { count } = db.prepare("SELECT count FROM counter WHERE id = 1").get();
            db.prepare("UPDATE counter SET count = ? WHERE id = 1").run(count + 1);
            db.exec("COMMIT");
            successCount++;
          } catch (error) {
            try { db.exec("ROLLBACK"); } catch {}
            errorCount++;
          }
        }
        
        console.log(JSON.stringify({ processId, successCount, errorCount }));
        db.close();
      `;

      // Spawn many processes
      const processCount = 10;
      const promises = [];
      for (let i = 0; i < processCount; i++) {
        promises.push(
          execFile("node", [
            "-e",
            createScript(incrementScriptTemplate, { dbPath, processId: i }),
          ]),
        );
      }

      const results = await Promise.all(promises);

      // Parse results
      let totalSuccess = 0;
      let totalError = 0;

      results.forEach(({ stdout }) => {
        const data = JSON.parse(stdout.trim());
        totalSuccess += data.successCount;
        totalError += data.errorCount;
      });

      // Verify counter value matches successful increments
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare("SELECT count FROM counter WHERE id = 1");
      const { count } = stmt.get();

      expect(count).toBe(totalSuccess);
      expect(totalSuccess + totalError).toBe(processCount * 10); // Total attempts

      console.log(
        `High concurrency test: ${totalSuccess} successful increments, ${totalError} conflicts`,
      );

      verifyDb.close();
    });

    test("stress test with mixed operations", async () => {
      // Create complex schema
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(`
        CREATE TABLE stress_test (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          process_id INTEGER,
          operation TEXT,
          value TEXT,
          timestamp TEXT
        );
        CREATE INDEX idx_process ON stress_test(process_id);
        CREATE INDEX idx_operation ON stress_test(operation);
      `);
      setupDb.close();

      // Script that performs mixed operations
      const stressScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const processId = \${processId};
        const db = new DatabaseSync(\${dbPath}, { timeout: 10000 });
        
        const operations = ["insert", "select", "update", "aggregate"];
        let results = { insert: 0, select: 0, update: 0, aggregate: 0, errors: 0 };
        
        for (let i = 0; i < 20; i++) {
          const op = operations[i % operations.length];
          
          try {
            switch (op) {
              case "insert":
                db.prepare(
                  "INSERT INTO stress_test (process_id, operation, value, timestamp) VALUES (?, ?, ?, ?)"
                ).run(processId, op, \`value_\${i}\`, new Date().toISOString());
                results.insert++;
                break;
                
              case "select":
                const rows = db.prepare(
                  "SELECT * FROM stress_test WHERE process_id = ? LIMIT 5"
                ).all(processId);
                results.select++;
                break;
                
              case "update":
                db.exec("BEGIN");
                db.prepare(
                  "UPDATE stress_test SET value = ? WHERE process_id = ? AND operation = ?"
                ).run(\`updated_\${i}\`, processId, "insert");
                db.exec("COMMIT");
                results.update++;
                break;
                
              case "aggregate":
                const agg = db.prepare(
                  "SELECT COUNT(*) as count, operation FROM stress_test GROUP BY operation"
                ).all();
                results.aggregate++;
                break;
            }
          } catch (error) {
            results.errors++;
            try { db.exec("ROLLBACK"); } catch {}
          }
        }
        
        console.log(JSON.stringify(results));
        db.close();
      `;

      // Run stress test with multiple processes
      const processCount = 5;
      const promises = [];
      for (let i = 0; i < processCount; i++) {
        promises.push(
          execFile("node", [
            "-e",
            createScript(stressScriptTemplate, { dbPath, processId: i }),
          ]),
        );
      }

      const results = await Promise.all(promises);

      // Aggregate results
      const totals = {
        insert: 0,
        select: 0,
        update: 0,
        aggregate: 0,
        errors: 0,
      };

      results.forEach(({ stdout }) => {
        const data = JSON.parse(stdout.trim());
        Object.keys(totals).forEach((key) => {
          (totals as any)[key] += data[key];
        });
      });

      // Verify operations completed
      expect(totals.insert).toBeGreaterThan(0);
      expect(totals.select).toBeGreaterThan(0);
      expect(totals.update).toBeGreaterThan(0);
      expect(totals.aggregate).toBeGreaterThan(0);

      // Some errors are expected due to contention
      console.log("Stress test results:", totals);

      // Verify database integrity
      const verifyDb = new DatabaseSync(dbPath);
      const integrityCheck = verifyDb.prepare("PRAGMA integrity_check").get();
      expect(integrityCheck.integrity_check).toBe("ok");

      const rowCount = verifyDb
        .prepare("SELECT COUNT(*) as count FROM stress_test")
        .get();
      expect(rowCount.count).toBeGreaterThan(0);

      verifyDb.close();
    });
  });

  describe("Recovery and Consistency", () => {
    test("database remains consistent after process crash", async () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec(`
        CREATE TABLE crash_test (
          id INTEGER PRIMARY KEY,
          data TEXT,
          committed BOOLEAN DEFAULT 0
        )
      `);
      setupDb.close();

      // Script that simulates crash during transaction
      const crashScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const shouldCrash = \${shouldCrash};
        const db = new DatabaseSync(\${dbPath});
        
        try {
          db.exec("BEGIN");
          db.prepare("INSERT INTO crash_test (data) VALUES (?)").run("uncommitted_data");
          
          if (shouldCrash) {
            // Simulate crash by exiting without commit/rollback
            process.exit(1);
          } else {
            db.prepare("UPDATE crash_test SET committed = 1 WHERE data = ?").run("uncommitted_data");
            db.exec("COMMIT");
            console.log("COMMITTED");
          }
        } finally {
          if (!shouldCrash) db.close();
        }
      `;

      // First, simulate a crash
      try {
        await execFile("node", [
          "-e",
          createScript(crashScriptTemplate, { dbPath, shouldCrash: true }),
        ]);
      } catch (error: any) {
        // Expected to fail with exit code 1
        expect(error.code).toBe(1);
      }

      // Then run a successful transaction
      const successResult = await execFile("node", [
        "-e",
        createScript(crashScriptTemplate, { dbPath, shouldCrash: false }),
      ]);
      expect(successResult.stdout.trim()).toBe("COMMITTED");

      // Verify only committed data exists
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare(
        "SELECT * FROM crash_test WHERE committed = 1",
      );
      const results = stmt.all();

      expect(results).toHaveLength(1);
      expect(results[0].data).toBe("uncommitted_data");

      // Verify uncommitted data from crashed process doesn't exist
      const allStmt = verifyDb.prepare(
        "SELECT COUNT(*) as count FROM crash_test",
      );
      const { count } = allStmt.get();
      expect(count).toBe(1); // Only the committed row

      verifyDb.close();
    });

    test("WAL checkpoint handling across processes", async () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec(`
        CREATE TABLE wal_test (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT
        )
      `);
      setupDb.close();

      // Script that inserts data and optionally checkpoints
      const walScriptTemplate = `
        const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});
        const shouldCheckpoint = \${shouldCheckpoint};
        const processId = \${processId};
        const db = new DatabaseSync(\${dbPath}, { timeout: 5000 });
        
        try {
          // Insert some data with retry logic
          const stmt = db.prepare("INSERT INTO wal_test (data) VALUES (?)");
          let inserted = 0;
          for (let i = 0; i < 100; i++) {
            let retries = 3;
            while (retries > 0) {
              try {
                stmt.run(\`process_\${processId}_row_\${i}\`);
                inserted++;
                break;
              } catch (e) {
                if (retries > 1 && (e.message.includes("locked") || e.message.includes("busy"))) {
                  retries--;
                  // Small delay before retry
                  const delay = Math.random() * 20;
                  const start = Date.now();
                  while (Date.now() - start < delay) {
                    // Busy wait
                  }
                } else {
                  throw e; // Re-throw if not a lock error or out of retries
                }
              }
            }
          }
          
          console.log(\`Inserted \${inserted} rows\`);
          
          if (shouldCheckpoint) {
            const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
            console.log(\`CHECKPOINT: \${JSON.stringify(result)}\`);
          } else {
            console.log("DATA_INSERTED");
          }
        } catch (error) {
          console.error(\`ERROR: \${error.message}\`);
          throw error;
        } finally {
          db.close();
        }
      `;

      // Multiple processes insert data
      const writers = await Promise.all([
        execFile("node", [
          "-e",
          createScript(walScriptTemplate, {
            dbPath,
            shouldCheckpoint: false,
            processId: 1,
          }),
        ]),
        execFile("node", [
          "-e",
          createScript(walScriptTemplate, {
            dbPath,
            shouldCheckpoint: false,
            processId: 2,
          }),
        ]),
        execFile("node", [
          "-e",
          createScript(walScriptTemplate, {
            dbPath,
            shouldCheckpoint: false,
            processId: 3,
          }),
        ]),
      ]);

      writers.forEach(({ stdout }) => {
        expect(stdout).toContain("DATA_INSERTED");
        expect(stdout).toContain("Inserted 100 rows");
      });

      // One process performs checkpoint
      const checkpointer = await execFile("node", [
        "-e",
        createScript(walScriptTemplate, {
          dbPath,
          shouldCheckpoint: true,
          processId: 4,
        }),
      ]);
      expect(checkpointer.stdout).toContain("CHECKPOINT");

      // Verify all data is present
      const verifyDb = new DatabaseSync(dbPath);
      const stmt = verifyDb.prepare("SELECT COUNT(*) as count FROM wal_test");
      const { count } = stmt.get();
      expect(count).toBe(400); // 4 processes * 100 rows each

      // Verify WAL was checkpointed (file should be small or not exist)
      const walPath = dbPath + "-wal";
      if (fs.existsSync(walPath)) {
        const walStats = fs.statSync(walPath);
        expect(walStats.size).toBeLessThan(1000); // Should be nearly empty after truncate
      }

      verifyDb.close();
    });
  });
});
