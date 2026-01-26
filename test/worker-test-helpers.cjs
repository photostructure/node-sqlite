/**
 * Common worker thread helper for tests
 * This file handles various worker thread test scenarios
 */

const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { DatabaseSync } = require(path.resolve(__dirname, "../dist/index.cjs"));

// Helper to send results back to parent
function sendResult(success, data = {}) {
  parentPort?.postMessage({ success, ...data });
}

// Helper to handle errors
function handleError(error) {
  sendResult(false, {
    error: error.message ?? String(error),
    errorType: error.constructor.name,
    threadId: workerData.threadId,
    workerId: workerData.workerId,
  });
}

// Main worker logic based on operation type
try {
  const { operation, dbPath } = workerData;

  switch (operation) {
    case "read": {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare("SELECT * FROM test");
      const rows = stmt.all();
      // Note: finalize() not needed - statements are auto-finalized on GC
      db.close();
      sendResult(true, { rows });
      break;
    }

    case "count": {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare("SELECT COUNT(*) as count FROM test");
      const result = stmt.get();
      // Note: finalize() not needed - statements are auto-finalized on GC
      db.close();
      sendResult(true, {
        count: result.count,
        threadId: workerData.threadId,
        workerId: workerData.workerId,
      });
      break;
    }

    case "write": {
      const { value, workerId } = workerData;
      const db = new DatabaseSync(dbPath);
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");
      const result = stmt.run(value || `worker-${workerId}`);
      // Note: finalize() not needed - statements are auto-finalized on GC
      db.close();
      sendResult(true, {
        lastInsertRowid: result.lastInsertRowid,
        workerId,
      });
      break;
    }

    case "transaction": {
      const { operations, workerId } = workerData;
      const db = new DatabaseSync(dbPath);
      
      db.exec("BEGIN");
      try {
        for (const op of operations) {
          if (op.type === "insert") {
            db.prepare("INSERT INTO test (value) VALUES (?)").run(op.value);
          } else if (op.type === "update") {
            db.prepare("UPDATE test SET value = ? WHERE id = ?").run(op.value, op.id);
          }
        }
        db.exec("COMMIT");
        sendResult(true, { workerId });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        db.close();
      }
      break;
    }

    case "error-test": {
      // Intentionally cause an error for testing error handling
      const db = new DatabaseSync(dbPath);
      db.exec("INVALID SQL");
      break;
    }

    case "custom": {
      // For tests that need custom behavior, they can pass a custom handler
      // This allows tests to still use inline code when needed
      if (workerData.customCode) {
        // Using Function constructor instead of eval for better security
        const customFunction = new Function('workerData', 'DatabaseSync', 'sendResult', 'handleError', workerData.customCode);
        customFunction(workerData, DatabaseSync, sendResult, handleError);
      } else {
        throw new Error("No custom code provided for custom operation");
      }
      break;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
} catch (error) {
  handleError(error);
}