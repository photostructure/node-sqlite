import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseSync } from "../src";

describe("Worker Thread Initialization Test", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-worker-init-"));
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

  it("should work reliably when main thread initializes module first", async () => {
    // HYPOTHESIS: Initialize the module in main thread first
    console.log("Initializing module in main thread...");
    const mainDb = new DatabaseSync(":memory:");
    mainDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    mainDb.close();
    console.log("Main thread initialization complete");

    const results = [];
    const numWorkers = 10; // Test multiple workers

    // Run multiple workers concurrently after main thread initialization
    const workerPromises = Array.from({ length: numWorkers }, (_, i) => {
      const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  console.log('Worker ${i} starting...');
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  console.log('Worker ${i} completed successfully');
  
  parentPort.postMessage({ 
    success: true, 
    count: result.count, 
    workerId: ${i}
  });
} catch (error) {
  console.error('Worker ${i} failed:', error.message);
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error),
    workerId: ${i}
  });
}
`;

      const workerPath = path.join(tempDir, `init-worker-${i}.js`);
      fs.writeFileSync(workerPath, workerCode);

      const worker = new Worker(workerPath, {
        workerData: { dbPath, workerId: i },
      });

      return new Promise<any>((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0)
            reject(new Error(`Worker ${i} exited with code ${code}`));
        });
      });
    });

    const workerResults = await Promise.all(workerPromises);

    console.log("All workers completed");

    // All workers should succeed
    for (const result of workerResults) {
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    }

    expect(workerResults).toHaveLength(numWorkers);
  });

  it("should test multiple sequential workers after main thread init", async () => {
    // Initialize in main thread first
    const mainDb = new DatabaseSync(":memory:");
    mainDb.close();

    // Run workers sequentially
    for (let i = 0; i < 20; i++) {
      const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ 
    success: true, 
    count: result.count, 
    workerId: workerData.workerId
  });
} catch (error) {
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error),
    workerId: workerData.workerId
  });
}
`;

      const workerPath = path.join(tempDir, `seq-worker-${i}.js`);
      fs.writeFileSync(workerPath, workerCode);

      const worker = new Worker(workerPath, {
        workerData: { dbPath, workerId: i },
      });

      const result = await new Promise<any>((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0)
            reject(new Error(`Worker ${i} exited with code ${code}`));
        });
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      console.log(`Sequential worker ${i} completed successfully`);
    }
  });

  it("should test workers without main thread initialization (control)", async () => {
    // DON'T initialize in main thread - this should have higher failure rate
    console.log("Testing workers without main thread initialization...");

    const results = [];
    let failures = 0;

    // Run multiple workers to see failure rate
    for (let i = 0; i < 10; i++) {
      try {
        const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ 
    success: true, 
    count: result.count, 
    workerId: ${i}
  });
} catch (error) {
  parentPort.postMessage({ 
    success: false, 
    error: error.message || String(error),
    workerId: ${i}
  });
}
`;

        const workerPath = path.join(tempDir, `control-worker-${i}.js`);
        fs.writeFileSync(workerPath, workerCode);

        const worker = new Worker(workerPath, {
          workerData: { dbPath, workerId: i },
        });

        const result = await new Promise<any>((resolve, reject) => {
          worker.on("message", resolve);
          worker.on("error", (error) => {
            resolve({ success: false, error: error.message, workerId: i });
          });
          worker.on("exit", (code) => {
            if (code !== 0) {
              resolve({
                success: false,
                error: `Worker exited with code ${code}`,
                workerId: i,
              });
            }
          });
        });

        results.push(result);
        if (!result.success) {
          failures++;
          console.log(`Control worker ${i} failed: ${result.error}`);
        } else {
          console.log(`Control worker ${i} succeeded`);
        }
      } catch (error) {
        failures++;
        console.log(`Control worker ${i} crashed: ${String(error)}`);
        results.push({ success: false, error: String(error), workerId: i });
      }
    }

    console.log(
      `Control test: ${failures}/${results.length} failures (${((failures / results.length) * 100).toFixed(1)}% failure rate)`,
    );

    // We expect some failures in the control group, but still test the successful ones
    const successfulResults = results.filter((r) => r.success);
    for (const result of successfulResults) {
      expect(result.count).toBe(2);
    }
  });
});
