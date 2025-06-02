import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "../src";
import { getDirname } from "./test-utils";

const execFile = promisify(childProcess.execFile);

/**
 * Multi-process tests can be sensitive to test parallelization.
 * If these tests fail intermittently, run them in isolation with:
 * npm run test:serial -- test/multi-process-simple.test.ts
 */
describe("Simple Multi-Process Tests", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    // Add timestamp and random suffix to ensure uniqueness
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `sqlite-simple-mp-${timestamp}-${randomSuffix}-`),
    );
    dbPath = path.join(tempDir, `mp-test-${timestamp}-${randomSuffix}.db`);
  });

  afterEach(async () => {
    // Ensure all database connections are closed before cleanup
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
      if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
      fs.rmdirSync(tempDir);
    } catch (e) {
      // Log cleanup errors for debugging but don't fail the test
      console.warn("Cleanup error in afterEach:", e);
    }
  });

  test("basic multi-process read", async () => {
    // Create database in main process
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO test (value) VALUES ('hello'), ('world')");
    db.close();

    // Read from child process
    const { stdout } = await execFile("node", [
      path.join(getDirname(), "multi-process-helper.cjs"),
      "read",
      dbPath,
    ]);
    const rows = JSON.parse(stdout.trim());

    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe("hello");
    expect(rows[1].value).toBe("world");
  });

  test("concurrent writes with WAL mode", async () => {
    // Create database with WAL mode
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE counters (id INTEGER PRIMARY KEY, value INTEGER)");
    db.exec("INSERT INTO counters VALUES (1, 0)");

    // Ensure WAL mode is properly set and initial state is persisted
    db.exec("PRAGMA wal_checkpoint(FULL)");
    db.close();

    // Verify database file exists
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database file not created at ${dbPath}`);
    }

    // Run 3 processes concurrently
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        execFile("node", [
          path.join(getDirname(), "multi-process-helper.cjs"),
          "increment",
          dbPath,
          i.toString(),
        ]),
      );
    }

    const results = await Promise.all(promises);

    // Longer delay to ensure all WAL changes are visible
    await new Promise((resolve) => setTimeout(resolve, 100));

    const totalSuccesses = results.reduce((sum, result, index) => {
      const { stdout, stderr } = result;
      if (stderr) {
        console.error(`Process ${index} stderr:`, stderr);
      }
      const trimmed = stdout.trim();
      const num = parseInt(trimmed);
      if (isNaN(num)) {
        console.error(
          `Process ${index} stdout was not a number:`,
          JSON.stringify(stdout),
        );
        console.error(`Process ${index} full result:`, result);
      }
      return sum + (isNaN(num) ? 0 : num);
    }, 0);

    // Verify counter value - open in read-only mode to avoid locking issues
    const verifyDb = new DatabaseSync(dbPath);

    // Force a full checkpoint to ensure all WAL changes are written to main database
    try {
      verifyDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Ignore checkpoint errors
    }

    const row = verifyDb
      .prepare("SELECT value FROM counters WHERE id = 1")
      .get();
    verifyDb.close();

    // The value should be 30 if all processes succeeded
    // Each process tries 10 increments, 3 processes = 30 total possible
    expect(row?.value ?? 0).toBe(totalSuccesses);
    expect(totalSuccesses).toBeGreaterThan(0);
    expect(totalSuccesses).toBeLessThanOrEqual(30); // Max possible successes
  });

  test("database locking behavior", async () => {
    // Create database
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE lock_test (id INTEGER PRIMARY KEY, data TEXT)");
    db.close();

    // This test demonstrates SQLite's locking behavior
    // We'll use simpler synchronous operations to avoid timing issues

    const db1 = new DatabaseSync(dbPath);
    const db2 = new DatabaseSync(dbPath, { timeout: 100 }); // Short timeout

    try {
      // Start exclusive transaction in db1
      db1.exec("BEGIN EXCLUSIVE");

      // Try to write in db2 (should fail due to lock)
      let locked = false;
      try {
        db2.exec("INSERT INTO lock_test (data) VALUES ('test')");
      } catch (e: any) {
        if (e.message.includes("locked") || e.message.includes("busy")) {
          locked = true;
        }
      }

      expect(locked).toBe(true);

      // Commit transaction in db1
      db1.exec("COMMIT");

      // Now db2 should be able to write
      expect(() => {
        db2.exec("INSERT INTO lock_test (data) VALUES ('test2')");
      }).not.toThrow();
    } finally {
      db1.close();
      db2.close();
    }
  }, 10000);
});
