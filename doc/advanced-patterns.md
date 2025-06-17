# Advanced Patterns

This guide covers advanced usage patterns including worker threads, database backups, sessions/changesets, and performance optimization.

## Worker Thread Support

This package has full support for Node.js worker threads. Each worker thread gets its own isolated SQLite environment.

### Basic Worker Thread Usage

**main.js:**

```javascript
const { Worker } = require("worker_threads");
const path = require("path");

// Create multiple workers for parallel database operations
const worker1 = new Worker(path.join(__dirname, "db-worker.js"));
const worker2 = new Worker(path.join(__dirname, "db-worker.js"));

// Send queries to workers
worker1.postMessage({
  sql: "SELECT COUNT(*) as count FROM large_table WHERE category = ?",
  params: ["electronics"],
});

worker1.on("message", (result) => {
  console.log("Worker 1 result:", result);
});

// Clean up
worker1.terminate();
worker2.terminate();
```

**db-worker.js:**

```javascript
const { parentPort } = require("worker_threads");
const { DatabaseSync } = require("@photostructure/sqlite");

// Each worker creates its own database connection
const db = new DatabaseSync("./app.db");

parentPort.on("message", ({ sql, params }) => {
  try {
    const stmt = db.prepare(sql);
    const result = stmt.all(...(params || []));
    stmt.finalize();
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Cleanup on exit
process.on("exit", () => {
  db.close();
});
```

### Worker Pool Pattern

```javascript
const { Worker } = require("worker_threads");
const os = require("os");

class DatabaseWorkerPool {
  constructor(dbPath, poolSize = os.cpus().length) {
    this.dbPath = dbPath;
    this.workers = [];
    this.queue = [];
    this.busyWorkers = new Set();

    // Create worker pool
    for (let i = 0; i < poolSize; i++) {
      this.createWorker();
    }
  }

  createWorker() {
    const worker = new Worker(
      `
      const { parentPort } = require('worker_threads');
      const { DatabaseSync } = require('@photostructure/sqlite');
      
      const db = new DatabaseSync('${this.dbPath}');
      
      parentPort.on('message', ({ id, sql, params }) => {
        try {
          const stmt = db.prepare(sql);
          const result = stmt.all(...(params || []));
          stmt.finalize();
          parentPort.postMessage({ id, success: true, result });
        } catch (error) {
          parentPort.postMessage({ id, success: false, error: error.message });
        }
      });
    `,
      { eval: true },
    );

    worker.on("message", (message) => {
      this.busyWorkers.delete(worker);
      this.processQueue();
    });

    this.workers.push(worker);
  }

  async query(sql, params) {
    return new Promise((resolve, reject) => {
      const request = { sql, params, resolve, reject };
      this.queue.push(request);
      this.processQueue();
    });
  }

  processQueue() {
    if (this.queue.length === 0) return;

    const availableWorker = this.workers.find((w) => !this.busyWorkers.has(w));
    if (!availableWorker) return;

    const { sql, params, resolve, reject } = this.queue.shift();
    const id = Math.random().toString(36);

    this.busyWorkers.add(availableWorker);

    const handler = (message) => {
      if (message.id !== id) return;

      availableWorker.off("message", handler);

      if (message.success) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    };

    availableWorker.on("message", handler);
    availableWorker.postMessage({ id, sql, params });
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// Usage
const pool = new DatabaseWorkerPool("./app.db", 4);

// Execute queries in parallel
const results = await Promise.all([
  pool.query("SELECT COUNT(*) FROM orders WHERE status = ?", ["pending"]),
  pool.query("SELECT SUM(total) FROM orders WHERE date > ?", ["2024-01-01"]),
  pool.query("SELECT * FROM products WHERE category = ?", ["electronics"]),
]);

await pool.close();
```

## Database Backups

### Simple Backup

```javascript
const { DatabaseSync } = require("@photostructure/sqlite");

async function backupDatabase(sourcePath, backupPath) {
  const db = new DatabaseSync(sourcePath);

  try {
    await db.backup(backupPath);
    console.log("Backup completed successfully");
  } catch (error) {
    console.error("Backup failed:", error.message);
  } finally {
    db.close();
  }
}

// Usage
await backupDatabase("./production.db", "./backup-2024-01-15.db");
```

### Backup with Progress Monitoring

```javascript
async function backupWithProgress(sourcePath, backupPath) {
  const db = new DatabaseSync(sourcePath);

  console.log(`Starting backup of ${sourcePath}...`);

  await db.backup(backupPath, {
    rate: 100, // Pages per iteration
    progress: ({ totalPages, remainingPages }) => {
      const completed = totalPages - remainingPages;
      const percent = ((completed / totalPages) * 100).toFixed(1);
      const progressBar = "=".repeat(Math.floor(percent / 2)).padEnd(50);

      process.stdout.write(`\r[${progressBar}] ${percent}%`);
    },
  });

  console.log("\nBackup completed!");
  db.close();
}
```

### Automated Backup Strategy

```javascript
const fs = require("fs").promises;
const path = require("path");

class DatabaseBackupManager {
  constructor(dbPath, backupDir, options = {}) {
    this.dbPath = dbPath;
    this.backupDir = backupDir;
    this.maxBackups = options.maxBackups || 7;
    this.backupInterval = options.interval || 24 * 60 * 60 * 1000; // 24 hours
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    const backupName = `backup-${timestamp}.db`;
    const backupPath = path.join(this.backupDir, backupName);

    // Ensure backup directory exists
    await fs.mkdir(this.backupDir, { recursive: true });

    // Create backup
    const db = new DatabaseSync(this.dbPath);
    try {
      await db.backup(backupPath);
      console.log(`Backup created: ${backupName}`);

      // Clean old backups
      await this.cleanOldBackups();
    } finally {
      db.close();
    }

    return backupPath;
  }

  async cleanOldBackups() {
    const files = await fs.readdir(this.backupDir);
    const backups = files
      .filter((f) => f.startsWith("backup-") && f.endsWith(".db"))
      .sort()
      .reverse();

    // Remove old backups
    for (const backup of backups.slice(this.maxBackups)) {
      await fs.unlink(path.join(this.backupDir, backup));
      console.log(`Removed old backup: ${backup}`);
    }
  }

  startAutoBackup() {
    this.createBackup(); // Initial backup
    this.intervalId = setInterval(() => {
      this.createBackup().catch(console.error);
    }, this.backupInterval);
  }

  stopAutoBackup() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}

// Usage
const backupManager = new DatabaseBackupManager("./app.db", "./backups", {
  maxBackups: 7,
  interval: 6 * 60 * 60 * 1000, // 6 hours
});

backupManager.startAutoBackup();
```

## Session-based Change Tracking

SQLite's session extension allows you to record changes and apply them to other databases - perfect for synchronization, replication, or undo/redo functionality.

### Basic Change Tracking

```javascript
const { DatabaseSync } = require("@photostructure/sqlite");

const db = new DatabaseSync("main.db");

// Create a session to track changes to the users table
const session = db.createSession({ table: "users" });

// Make some changes
db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Alice Smith", 1);
db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(
  "Bob",
  "bob@example.com",
);
db.prepare("DELETE FROM users WHERE id = ?").run(3);

// Get the changes as a changeset
const changeset = session.changeset();
console.log(`Changeset size: ${changeset.length} bytes`);

// Close the session
session.close();

// Apply changes to another database
const replicaDb = new DatabaseSync("replica.db");
const result = replicaDb.applyChangeset(changeset);
console.log(`Applied ${result.changesApplied} changes`);

db.close();
replicaDb.close();
```

### Conflict Resolution

```javascript
const { DatabaseSync, constants } = require("@photostructure/sqlite");

function syncDatabases(primaryPath, replicaPath) {
  const primary = new DatabaseSync(primaryPath);
  const replica = new DatabaseSync(replicaPath);

  // Track all changes on primary
  const session = primary.createSession();

  // Make changes on primary
  primary.exec("UPDATE products SET price = price * 1.1"); // 10% price increase

  // Get changeset
  const changeset = session.changeset();
  session.close();

  // Apply to replica with conflict handling
  const result = replica.applyChangeset(changeset, {
    onConflict: (conflict) => {
      console.log(`Conflict detected:`);
      console.log(`  Table: ${conflict.table}`);
      console.log(`  Type: ${conflict.type}`);
      console.log(`  Old value: ${JSON.stringify(conflict.oldRow)}`);
      console.log(`  New value: ${JSON.stringify(conflict.newRow)}`);

      // Conflict resolution strategies:
      // - SQLITE_CHANGESET_OMIT: Skip this change
      // - SQLITE_CHANGESET_REPLACE: Apply the change anyway
      // - SQLITE_CHANGESET_ABORT: Stop applying changes

      return constants.SQLITE_CHANGESET_REPLACE; // Force update
    },
  });

  console.log(`Sync complete: ${result.changesApplied} changes applied`);

  primary.close();
  replica.close();
}
```

### Undo/Redo Implementation

```javascript
class UndoRedoManager {
  constructor(db) {
    this.db = db;
    this.undoStack = [];
    this.redoStack = [];
    this.session = null;
  }

  startTracking() {
    if (this.session) {
      this.endTracking();
    }
    this.session = this.db.createSession();
  }

  endTracking(description) {
    if (!this.session) return;

    const changeset = this.session.changeset();
    if (changeset.length > 0) {
      this.undoStack.push({
        description,
        changeset,
        inverse: this.session.changesetInvert(changeset),
      });
      this.redoStack = []; // Clear redo stack on new change
    }

    this.session.close();
    this.session = null;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    // Apply inverse changeset
    this.db.applyChangeset(entry.inverse);

    // Move to redo stack
    this.redoStack.push(entry);

    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;

    // Apply original changeset
    this.db.applyChangeset(entry.changeset);

    // Move back to undo stack
    this.undoStack.push(entry);

    return true;
  }

  getHistory() {
    return {
      undo: this.undoStack.map((e) => e.description),
      redo: this.redoStack.map((e) => e.description),
    };
  }
}

// Usage
const db = new DatabaseSync("document.db");
const undoRedo = new UndoRedoManager(db);

// Track a change
undoRedo.startTracking();
db.prepare("UPDATE document SET content = ? WHERE id = ?").run(
  "New content",
  1,
);
undoRedo.endTracking("Update document content");

// Track another change
undoRedo.startTracking();
db.prepare("INSERT INTO document (content) VALUES (?)").run("Another document");
undoRedo.endTracking("Add new document");

// Undo last change
undoRedo.undo();
console.log("Undid: Add new document");

// Redo
undoRedo.redo();
console.log("Redid: Add new document");
```

## Performance Optimization

### URI Configuration for Performance

```javascript
// High-performance read-only configuration
const readOnlyDb = new DatabaseSync(
  "file:reference.db?mode=ro&immutable=1&nolock=1",
);

// Optimized for write-heavy workloads
const writeDb = new DatabaseSync("file:data.db?mode=rwc&cache=private&psow=0");

// Memory-mapped I/O for large databases
const db = new DatabaseSync("large.db");
db.exec("PRAGMA mmap_size = 268435456"); // 256MB memory map
```

### Connection Pooling

```javascript
class DatabasePool {
  constructor(dbPath, poolSize = 5) {
    this.dbPath = dbPath;
    this.connections = [];
    this.available = [];

    // Create pool
    for (let i = 0; i < poolSize; i++) {
      const conn = new DatabaseSync(dbPath);
      this.connections.push(conn);
      this.available.push(conn);
    }
  }

  acquire() {
    if (this.available.length === 0) {
      throw new Error("No connections available");
    }
    return this.available.pop();
  }

  release(conn) {
    if (!this.connections.includes(conn)) {
      throw new Error("Connection not from this pool");
    }
    this.available.push(conn);
  }

  async withConnection(fn) {
    const conn = this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  close() {
    for (const conn of this.connections) {
      conn.close();
    }
  }
}

// Usage
const pool = new DatabasePool("./app.db", 10);

// Execute queries using pool
const results = await Promise.all([
  pool.withConnection((db) => db.prepare("SELECT * FROM users").all()),
  pool.withConnection((db) => db.prepare("SELECT * FROM orders").all()),
  pool.withConnection((db) => db.prepare("SELECT * FROM products").all()),
]);

pool.close();
```

### Bulk Operations

```javascript
// Efficient bulk insert
function bulkInsert(db, data) {
  db.exec("BEGIN IMMEDIATE");

  try {
    const stmt = db.prepare(
      "INSERT INTO measurements (timestamp, sensor_id, value) VALUES (?, ?, ?)",
    );

    for (const record of data) {
      stmt.run(record.timestamp, record.sensorId, record.value);
    }

    stmt.finalize();
    db.exec("COMMIT");

    console.log(`Inserted ${data.length} records`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Usage with performance timing
const data = Array.from({ length: 100000 }, (_, i) => ({
  timestamp: Date.now() + i,
  sensorId: Math.floor(Math.random() * 100),
  value: Math.random() * 100,
}));

const start = Date.now();
bulkInsert(db, data);
const duration = Date.now() - start;

console.log(`Bulk insert completed in ${duration}ms`);
console.log(
  `Rate: ${((data.length / duration) * 1000).toFixed(0)} records/second`,
);
```

## Memory Management

### Setting Memory Limits

```javascript
const db = new DatabaseSync("app.db");

// Set cache size (negative value = KB, positive = pages)
db.exec("PRAGMA cache_size = -64000"); // 64MB cache

// Set memory limit for temp storage
db.exec("PRAGMA temp_store = MEMORY");
db.exec("PRAGMA temp_store_max_size = 67108864"); // 64MB

// Monitor memory usage
const memoryUsed = db.prepare("PRAGMA cache_stats").get();
console.log("Cache statistics:", memoryUsed);
```

## Next Steps

- [Extending SQLite](./extending-sqlite.md) - Custom functions and extensions
- [API Reference](./api-reference.md) - Complete API documentation
- [Library Comparison](./library-comparison.md) - Compare with other SQLite libraries
