import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import { DatabaseSync } from "../src";
import {
  getTestTimeout,
  getTimingMultiplier,
  isAlpineLinux,
  isEmulated,
  useTempDir,
} from "./test-utils";

const execFile = promisify(childProcess.execFile);
const scripts = require("./multi-process-scripts.js");

/**
 * Multi-process tests can be sensitive to test parallelization.
 * If these tests fail intermittently, run them in isolation with:
 * npm run test:serial -- test/multi-process.test.ts
 */
describe("Multi-Process Database Access", () => {
  const { getDbPath } = useTempDir("sqlite-multiproc-", {
    cleanupWalFiles: true,
  });
  let dbPath: string;

  // Helper to execute a script with environment variables
  const execScript = (scriptName: string, env: Record<string, string> = {}) => {
    return execFile("node", ["-e", scripts[scriptName]], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        ...env,
      },
    });
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

      // Spawn multiple child processes to read simultaneously
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(execScript("readerScript"));
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

      // Spawn multiple writer processes
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(execScript("writerScript", { PROCESS_ID: i.toString() }));
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

      // Run two processes that try to update the same row
      const [result1, result2] = await Promise.all([
        execScript("transactionScript", { PROCESS_ID: "1" }),
        execScript("transactionScript", { PROCESS_ID: "2" }),
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

      // Run one process that commits and one that rolls back
      const [commitResult, rollbackResult] = await Promise.all([
        execScript("rollbackScript", { SHOULD_ROLLBACK: "false" }),
        execScript("rollbackScript", { SHOULD_ROLLBACK: "true" }),
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
    test(
      "handles database locked errors gracefully",
      async () => {
        // Use reasonable timeouts even on slower CI platforms
        const multiplier = getTimingMultiplier();
        // Use shorter base time but allow platform multiplier
        const lockHoldTime = 500 * multiplier;

        console.log(
          `Test environment: CI=${process.env.CI}, Alpine=${isAlpineLinux()}, Emulated=${isEmulated()}, multiplier=${multiplier}, lockHoldTime=${lockHoldTime}ms`,
        );

        const setupDb = new DatabaseSync(dbPath);
        setupDb.exec(`
          CREATE TABLE lock_test (
            id INTEGER PRIMARY KEY,
            value INTEGER
          )
        `);
        setupDb.exec("INSERT INTO lock_test (id, value) VALUES (1, 0)");
        setupDb.close();

        // Start lock holder process
        const lockHolder = childProcess.spawn(
          "node",
          ["-e", scripts.lockHolderScript],
          {
            env: {
              ...process.env,
              DB_PATH: dbPath,
              LOCK_HOLD_TIME: lockHoldTime.toString(),
            },
          },
        );

        let lockHolderOutput = "";
        let lockHolderError = "";
        lockHolder.stdout.on("data", (data) => {
          lockHolderOutput += data.toString();
        });
        lockHolder.stderr.on("data", (data) => {
          lockHolderError += data.toString();
        });

        // Wait for lock to be acquired with timeout
        const lockAcquireTimeout = 5000 * multiplier;
        const lockAcquireStart = Date.now();

        try {
          await new Promise<void>((resolve, reject) => {
            const checkLock = setInterval(() => {
              if (lockHolderOutput.includes("LOCK_ACQUIRED")) {
                clearInterval(checkLock);
                resolve();
              } else if (lockHolderError.includes("Error")) {
                clearInterval(checkLock);
                reject(new Error(`Lock holder failed: ${lockHolderError}`));
              } else if (Date.now() - lockAcquireStart > lockAcquireTimeout) {
                clearInterval(checkLock);
                reject(
                  new Error(
                    `Timeout waiting for lock acquisition after ${lockAcquireTimeout}ms. ` +
                      `Output: "${lockHolderOutput}", Error: "${lockHolderError}"`,
                  ),
                );
              }
            }, 50); // Check less frequently to reduce CPU usage
          });
        } catch (error) {
          console.error("Failed to acquire lock:", error);
          // Kill the lock holder process if it's still running
          try {
            lockHolder.kill("SIGTERM");
            // Give it time to terminate gracefully
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (!lockHolder.killed) {
              lockHolder.kill("SIGKILL");
            }
          } catch (killError) {
            console.error("Error killing lock holder:", killError);
          }
          throw error;
        }

        console.log("Lock acquired, waiting for it to be fully established...");

        // Add a delay to ensure lock is fully established
        // The lock holder now performs an actual write during BEGIN EXCLUSIVE
        // to ensure the lock is truly held
        const establishDelay = 300 * multiplier;
        console.log(
          `Waiting ${establishDelay}ms for lock to be fully established...`,
        );
        await new Promise((resolve) => setTimeout(resolve, establishDelay));

        // Try to write while locked
        console.log("Attempting to write to locked database...");
        let writerResult;
        try {
          writerResult = await execScript("lockWriterScript");
          const output = writerResult.stdout.trim();
          const errorOutput = writerResult.stderr.trim();

          console.log("Writer stdout:", output);
          if (errorOutput) {
            console.log("Writer stderr:", errorOutput);
          }

          // The writer should have been blocked
          expect(output).toBe("DATABASE_LOCKED");
        } catch (error: any) {
          console.error("Writer script failed:", error);
          console.error("Writer stdout:", error.stdout);
          console.error("Writer stderr:", error.stderr);
          throw error;
        }

        // Wait for lock holder to finish with timeout
        console.log("Waiting for lock holder to finish...");
        const lockFinishTimeout = lockHoldTime + 5000;
        let timeoutHandle: NodeJS.Timeout | undefined;

        const exitCode = await Promise.race([
          new Promise<number>((resolve) => {
            lockHolder.on("close", (code) => {
              console.log(`Lock holder exited with code ${code}`);
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
              }
              resolve(code || 0);
            });
          }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              console.error("Lock holder timeout - killing process");
              lockHolder.kill("SIGKILL");
              reject(
                new Error(
                  `Lock holder didn't finish within ${lockFinishTimeout}ms`,
                ),
              );
            }, lockFinishTimeout);
          }),
        ]);

        expect(exitCode).toBe(0);
        expect(lockHolderOutput).toContain("LOCK_RELEASED");

        // Verify lock holder's update succeeded
        const verifyDb = new DatabaseSync(dbPath);
        const stmt = verifyDb.prepare(
          "SELECT value FROM lock_test WHERE id = 1",
        );
        const { value } = stmt.get();
        expect(value).toBe(999);
        verifyDb.close();
      },
      getTestTimeout(60000), // Base timeout of 60s for this complex multi-process test
    );

    test("handles concurrent schema changes", async () => {
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("PRAGMA journal_mode = WAL");
      setupDb.exec("CREATE TABLE schema_test (id INTEGER PRIMARY KEY)");
      setupDb.close();

      // Try to add different columns concurrently
      const [result1, result2] = await Promise.all([
        execScript("schemaChangeScript", { COLUMN_NAME: "column1" }),
        execScript("schemaChangeScript", { COLUMN_NAME: "column2" }),
      ]);

      // Both operations should succeed (WAL mode helps)
      expect(result1.stdout.trim()).toMatch(/ADDED_column1|LOCKED_column1/);
      expect(result2.stdout.trim()).toMatch(/ADDED_column2|LOCKED_column2/);

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

      // Spawn many processes
      const processCount = 10;
      const promises = [];
      for (let i = 0; i < processCount; i++) {
        promises.push(
          execScript("incrementScript", { PROCESS_ID: i.toString() }),
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

      // Run stress test with multiple processes
      const processCount = 5;
      const promises = [];
      for (let i = 0; i < processCount; i++) {
        promises.push(
          execScript("stressTestScript", { PROCESS_ID: i.toString() }),
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

      // First, simulate a crash
      try {
        await execScript("crashScript", { SHOULD_CRASH: "true" });
      } catch (error: any) {
        // Expected to fail with exit code 1
        expect(error.code).toBe(1);
      }

      // Then run a successful transaction
      const successResult = await execScript("crashScript", {
        SHOULD_CRASH: "false",
      });
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

      // Multiple processes insert data
      const writers = await Promise.all([
        execScript("walScript", {
          SHOULD_CHECKPOINT: "false",
          PROCESS_ID: "1",
        }),
        execScript("walScript", {
          SHOULD_CHECKPOINT: "false",
          PROCESS_ID: "2",
        }),
        execScript("walScript", {
          SHOULD_CHECKPOINT: "false",
          PROCESS_ID: "3",
        }),
      ]);

      writers.forEach(({ stdout }) => {
        expect(stdout).toContain("DATA_INSERTED");
        expect(stdout).toContain("Inserted 100 rows");
      });

      // One process performs checkpoint
      const checkpointer = await execScript("walScript", {
        SHOULD_CHECKPOINT: "true",
        PROCESS_ID: "4",
      });
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
