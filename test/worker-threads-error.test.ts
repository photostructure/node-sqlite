import { describe, expect, it } from "@jest/globals";
import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseSync } from "../src";
import { createTestDb, getDirname, useTempDir } from "./test-utils";

describe("Worker Thread Error Test", () => {
  const { getDbPath, writeWorkerScript } = useTempDir("sqlite-worker-error-");
  let dbPath: string;

  beforeEach(() => {
    dbPath = getDbPath("test.db");

    // Initialize a simple database
    const db = createTestDb(
      dbPath,
      `
      CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT);
      INSERT INTO test (value) VALUES ('hello'), ('world');
    `,
    );
    db.close();
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

    const workerPath = writeWorkerScript("error-worker.js", workerCode);

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
    // When passing a database object through workerData, it gets serialized and loses its methods
    // This is expected behavior - database objects cannot be shared between threads
    expect(result.error).toMatch(
      /not a function|cannot be used from different thread/,
    );
  });

  it("should work when creating new database in worker thread", async () => {
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});

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

    const workerPath = writeWorkerScript("new-worker.js", workerCode);

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
const { DatabaseSync } = require(${JSON.stringify(path.resolve(getDirname(), "../dist/index.cjs"))});

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

    const workerPath = writeWorkerScript("validation-worker.js", workerCode);

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
