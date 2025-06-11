/**
 * Script templates for multi-process tests
 * These are used as child process scripts that are executed via node -e
 */

// Helper to resolve the DatabaseSync module path
// Use a simple path relative to the test directory
const getModulePath = () => {
  // When scripts are executed, they run from the project root
  return JSON.stringify("./dist/index.cjs");
};

/**
 * Script that reads from the database and returns count/sum
 */
export const readerScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const db = new DatabaseSync(process.env.DB_PATH);
  const stmt = db.prepare("SELECT COUNT(*) as count, SUM(value) as sum FROM shared_data");
  const result = stmt.get();
  console.log(JSON.stringify(result));
  db.close();
`;

/**
 * Script that writes to database with proper locking
 */
export const writerScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const processId = parseInt(process.env.PROCESS_ID);
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 10000 });
  
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

/**
 * Script that performs a transaction with delay
 */
export const transactionScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const processId = parseInt(process.env.PROCESS_ID);
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 5000 });
  
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
    updateStmt.run(balance + processId * 100);
    
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

/**
 * Script that conditionally rolls back
 */
export const rollbackScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const shouldRollback = process.env.SHOULD_ROLLBACK === 'true';
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 5000 });
  
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

/**
 * Script that holds a write lock
 */
export const lockHolderScript = `
  const { DatabaseSync } = require(${getModulePath()});
  let db;
  
  try {
    db = new DatabaseSync(process.env.DB_PATH);
    const lockHoldTime = parseInt(process.env.LOCK_HOLD_TIME) || 1000;
    
    // Start exclusive transaction and perform a write to ensure lock is held
    db.exec("BEGIN EXCLUSIVE");
    // Do a write operation to ensure the exclusive lock is actually taken
    db.exec("UPDATE lock_test SET value = 1 WHERE id = 1");
    
    console.log("LOCK_ACQUIRED");
    console.error("Lock acquired at:", new Date().toISOString());
    
    // Hold lock for specified time
    setTimeout(() => {
      try {
        // Final update before releasing
        db.exec("UPDATE lock_test SET value = 999 WHERE id = 1");
        db.exec("COMMIT");
        console.log("LOCK_RELEASED");
        console.error("Lock released at:", new Date().toISOString());
      } catch (e) {
        console.error("Error during commit:", e.message);
        try {
          db.exec("ROLLBACK");
        } catch (rollbackError) {
          console.error("Error during rollback:", rollbackError.message);
        }
      } finally {
        try {
          db.close();
        } catch (closeError) {
          console.error("Error closing database:", closeError.message);
        }
        process.exit(0);
      }
    }, lockHoldTime);
    
  } catch (e) {
    console.error("Error acquiring lock:", e.message);
    if (db) {
      try {
        db.close();
      } catch (closeError) {
        console.error("Error closing database after failure:", closeError.message);
      }
    }
    process.exit(1);
  }
`;

/**
 * Script that tries to write while database is locked
 */
export const lockWriterScript = `
  const { DatabaseSync } = require(${getModulePath()});
  let db;
  
  try {
    // Use very short timeout to fail fast when database is locked
    db = new DatabaseSync(process.env.DB_PATH, { timeout: 50 });
    
    console.error("Writer attempting at:", new Date().toISOString());
    
    // Try to start an immediate transaction - this should fail if another process has exclusive lock
    db.exec("BEGIN IMMEDIATE");
    
    // If we got here, the database wasn't locked
    db.exec("UPDATE lock_test SET value = 111 WHERE id = 1");
    db.exec("COMMIT");
    
    console.log("WRITE_SUCCESS");
    console.error("Writer succeeded unexpectedly");
    
  } catch (error) {
    console.error("Writer error:", error.message);
    
    // Check for various SQLite busy/locked error patterns
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes("locked") || 
        errorMsg.includes("busy") || 
        errorMsg.includes("sqlite_busy") ||
        errorMsg.includes("database is locked") ||
        errorMsg.includes("database table is locked")) {
      console.log("DATABASE_LOCKED");
    } else {
      console.log("UNEXPECTED_ERROR:", error.message);
    }
  } finally {
    if (db) {
      try {
        db.close();
      } catch (closeError) {
        console.error("Error closing writer database:", closeError.message);
      }
    }
  }
`;

/**
 * Script that tries to alter schema
 */
export const schemaChangeScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const columnName = process.env.COLUMN_NAME;
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 5000 });
  
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

/**
 * Script that increments a counter
 */
export const incrementScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const processId = parseInt(process.env.PROCESS_ID);
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 10000 });
  
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

/**
 * Script that performs mixed operations for stress testing
 */
export const stressTestScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const processId = parseInt(process.env.PROCESS_ID);
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 10000 });
  
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

/**
 * Script that simulates a crash during transaction
 */
export const crashScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const shouldCrash = process.env.SHOULD_CRASH === 'true';
  const db = new DatabaseSync(process.env.DB_PATH);
  
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

/**
 * Script that handles WAL checkpointing
 */
export const walScript = `
  const { DatabaseSync } = require(${getModulePath()});
  const shouldCheckpoint = process.env.SHOULD_CHECKPOINT === 'true';
  const processId = parseInt(process.env.PROCESS_ID);
  const db = new DatabaseSync(process.env.DB_PATH, { timeout: 5000 });
  
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
