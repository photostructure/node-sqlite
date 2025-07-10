import { describe, expect, it } from "@jest/globals";
import * as path from "path";
import { Worker } from "worker_threads";
import { createTestDb, projectRoot, useTempDir } from "./test-utils";

describe("Simple Worker Thread Test", () => {
  const { getDbPath } = useTempDir("sqlite-worker-simple-");
  let dbPath: string;
  const workerPath = path.join(
    projectRoot(),
    "test",
    "worker-test-helpers.cjs",
  );

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
    const worker = new Worker(workerPath, {
      workerData: {
        operation: "read",
        dbPath,
      },
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
    const workers = [
      new Worker(workerPath, {
        workerData: { operation: "count", dbPath, threadId: 1 },
      }),
      new Worker(workerPath, {
        workerData: { operation: "count", dbPath, threadId: 2 },
      }),
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
