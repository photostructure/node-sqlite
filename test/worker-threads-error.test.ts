import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseSync } from "../src";

describe("Worker Thread Error Test", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-worker-error-"));
    dbPath = path.join(tempDir, "test.db");

    // Initialize a simple database
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO test (value) VALUES ('hello'), ('world')");
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should throw clear error when accessing database from main thread in worker", async () => {
    // Create a database in main thread
    const mainDb = new DatabaseSync(dbPath, { readOnly: true });

    const workerCode = `
const { parentPort, workerData } = require('worker_threads');

try {
  // Try to access the database object passed from main thread
  // This should fail with thread validation error
  const stmt = workerData.db.prepare('SELECT * FROM test');
  const rows = stmt.all();
  stmt.finalize();
  
  parentPort.postMessage({ success: true, rows });
} catch (error) {
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error),
    errorType: error.constructor.name 
  });
}
`;

    const workerPath = path.join(tempDir, "error-worker.js");
    fs.writeFileSync(workerPath, workerCode);

    const worker = new Worker(workerPath, {
      workerData: { db: mainDb },
    });

    const result = await new Promise<any>((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });

    mainDb.close();

    expect(result.success).toBe(false);
    expect(result.error).toContain("cannot be used from different thread");
  });

  it("should work when creating new database in worker thread", async () => {
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  // Create a NEW database connection in the worker thread
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT * FROM test');
  const rows = stmt.all();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ success: true, rows });
} catch (error) {
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error),
    errorType: error.constructor.name 
  });
}
`;

    const workerPath = path.join(tempDir, "new-worker.js");
    fs.writeFileSync(workerPath, workerCode);

    const worker = new Worker(workerPath, {
      workerData: { dbPath },
    });

    const result = await new Promise<any>((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it("should enforce thread safety validation", async () => {
    // Create a database connection in main thread
    const mainDb = new DatabaseSync(dbPath, { readOnly: true });

    // Test that methods throw errors when called from worker thread
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  // Create a database in worker thread  
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  
  // This should work fine - same thread
  const stmt = db.prepare('SELECT * FROM test');
  const count = stmt.get();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ success: true, threadValidation: "working" });
} catch (error) {
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error) 
  });
}
`;

    const workerPath = path.join(tempDir, "validation-worker.js");
    fs.writeFileSync(workerPath, workerCode);

    const worker = new Worker(workerPath, {
      workerData: { dbPath },
    });

    const result = await new Promise<any>((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });

    mainDb.close();

    expect(result.success).toBe(true);
    expect(result.threadValidation).toBe("working");
  });
});
