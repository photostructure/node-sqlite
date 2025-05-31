import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseSync } from "../src";

describe("Simple Worker Thread Test", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-worker-simple-"));
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

  it("should read from database in worker thread", async () => {
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT * FROM test');
  const rows = stmt.all();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ success: true, rows });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message || String(error) });
}
`;

    const workerPath = path.join(tempDir, "simple-worker.js");
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
    expect(result.rows[0].value).toBe("hello");
    expect(result.rows[1].value).toBe("world");
  });

  it("should handle two concurrent workers", async () => {
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(__dirname, "../dist/index.js")}');

try {
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
  const stmt = db.prepare('SELECT COUNT(*) as count FROM test');
  const result = stmt.get();
  stmt.finalize();
  db.close();
  
  parentPort.postMessage({ success: true, count: result.count, threadId: workerData.threadId });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message || String(error), threadId: workerData.threadId });
}
`;

    const workerPath = path.join(tempDir, "count-worker.js");
    fs.writeFileSync(workerPath, workerCode);

    const workers = [
      new Worker(workerPath, { workerData: { dbPath, threadId: 1 } }),
      new Worker(workerPath, { workerData: { dbPath, threadId: 2 } }),
    ];

    const results = await Promise.all(
      workers.map(
        (worker) =>
          new Promise<any>((resolve, reject) => {
            worker.on("message", resolve);
            worker.on("error", reject);
            worker.on("exit", (code) => {
              if (code !== 0)
                reject(new Error(`Worker exited with code ${code}`));
            });
          }),
      ),
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[0].count).toBe(2);
    expect(results[1].count).toBe(2);
  });
});
