/**
 * Worker thread implementations for multi-process tests
 * These use worker_threads instead of child processes for better control and reliability
 */

const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { DatabaseSync } = require(path.resolve(__dirname, "../dist/index.cjs"));

// Lock holder worker implementation
if (workerData?.type === "lockHolder") {
  let db = null;
  let lockAcquired = false;

  try {
    // Open database
    db = new DatabaseSync(workerData.dbPath);
    
    // Ensure table exists
    db.exec("CREATE TABLE IF NOT EXISTS lock_test (id INTEGER PRIMARY KEY, value INTEGER)");
    db.exec("INSERT OR IGNORE INTO lock_test (id, value) VALUES (1, 0)");
    
    // Begin exclusive transaction
    db.exec("BEGIN EXCLUSIVE");
    
    // Write to ensure lock is taken
    db.exec("UPDATE lock_test SET value = 1 WHERE id = 1");
    lockAcquired = true;
    
    // Notify parent that lock is acquired
    parentPort?.postMessage({ type: "LOCK_ACQUIRED" });
    
    // Hold the lock for specified time
    setTimeout(() => {
      try {
        if (db) {
          // Final update before releasing
          db.exec("UPDATE lock_test SET value = 999 WHERE id = 1");
          db.exec("COMMIT");
          parentPort?.postMessage({ type: "LOCK_RELEASED" });
          db.close();
          db = null;
        }
      } catch (e) {
        parentPort?.postMessage({ type: "ERROR", error: e.message });
      }

      // Exit the worker - close parentPort to allow worker thread to exit
      parentPort?.postMessage({ type: "EXIT", code: 0 });
      parentPort?.close();
    }, workerData.lockHoldTime);
    
  } catch (e) {
    parentPort?.postMessage({ type: "ERROR", error: e.message });
    if (db) {
      try {
        if (lockAcquired) {
          db.exec("ROLLBACK");
        }
        db.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
    parentPort?.postMessage({ type: "EXIT", code: 1 });
    parentPort?.close();
  }
}

// Lock writer worker implementation
else if (workerData?.type === "lockWriter") {
  const tableName = workerData.tableName ?? "lock_test";
  let db = null;

  try {
    // Open database with very short timeout
    db = new DatabaseSync(workerData.dbPath, { timeout: 1 });

    // Try to write
    const stmt = db.prepare(
      `UPDATE ${tableName} SET value = value + 1 WHERE id = 1`,
    );
    stmt.run();

    parentPort?.postMessage({ type: "WRITE_SUCCESS" });
    db.close();
    parentPort?.postMessage({ type: "EXIT", code: 0 });
    parentPort?.close();
  } catch (e) {
    if (
      e.message.includes("SQLITE_BUSY") ||
      e.message.includes("database is locked")
    ) {
      parentPort?.postMessage({ type: "DATABASE_LOCKED" });
      parentPort?.postMessage({ type: "EXIT", code: 0 });
    } else {
      parentPort?.postMessage({ type: "ERROR", error: e.message });
      parentPort?.postMessage({ type: "EXIT", code: 1 });
    }

    if (db) {
      try {
        db.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
    parentPort?.close();
  }
}