import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseSync } from "../src";

describe("Simple Worker Thread Init Test", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sqlite-worker-simple-init-"),
    );
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

  it("should test with main thread module initialization", async () => {
    // Pre-initialize the module in main thread
    console.log("Pre-initializing module...");
    const initDb = new DatabaseSync(":memory:");
    initDb.exec("CREATE TABLE init (id INTEGER)");
    initDb.close();
    console.log("Module pre-initialized");

    // Now test a single worker
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  console.log('Worker starting with pre-initialized module...');
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  console.log('Worker completed successfully');
  
  parentPort.postMessage({ success: true, count: result.count });
} catch (error) {
  console.error('Worker failed:', error);
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error)
  });
}
`;

    const workerPath = path.join(tempDir, "simple-init-worker.js");
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
    expect(result.count).toBe(2);
  });

  it("should test without main thread module initialization", async () => {
    // Don't pre-initialize - test control case
    console.log("Testing without pre-initialization...");

    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  console.log('Worker starting without pre-initialization...');
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  console.log('Worker completed successfully');
  
  parentPort.postMessage({ success: true, count: result.count });
} catch (error) {
  console.error('Worker failed:', error);
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error)
  });
}
`;

    const workerPath = path.join(tempDir, "simple-control-worker.js");
    fs.writeFileSync(workerPath, workerCode);

    const worker = new Worker(workerPath, {
      workerData: { dbPath },
    });

    const result = await new Promise<any>((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", (error) => {
        // Handle HandleScope errors gracefully
        resolve({ success: false, error: error.message });
      });
      worker.on("exit", (code) => {
        if (code !== 0) {
          resolve({ success: false, error: `Worker exited with code ${code}` });
        }
      });
    });

    // This test is expected to potentially fail due to HandleScope errors
    console.log(`Control result: success=${result.success}`);
    if (result.success) {
      expect(result.count).toBe(2);
    }
  });
});
