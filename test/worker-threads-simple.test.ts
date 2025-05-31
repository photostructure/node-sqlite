import { describe, expect, it } from "@jest/globals";
import * as path from "path";
import { Worker } from "worker_threads";
import { createTestDb, getDirname, useTempDir } from "./test-utils";

describe("Simple Worker Thread Test", () => {
  const { getDbPath, writeWorkerScript } = useTempDir("sqlite-worker-simple-");
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

  it("should read from database in worker thread", async () => {
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('${path.resolve(getDirname(), "../dist/index.cjs")}');

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

    const workerPath = writeWorkerScript("simple-worker.js", workerCode);

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
const { DatabaseSync } = require('${path.resolve(getDirname(), "../dist/index.cjs")}');

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

    const workerPath = writeWorkerScript("count-worker.js", workerCode);

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
