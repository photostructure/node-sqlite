import { createHook } from "node:async_hooks";
import { DatabaseSync } from "../src";
import { DatabasePool } from "../src/experimental";
import { waitForCondition } from "./test-reliability-utils";
import { useTempDir } from "./test-utils";

describe("DatabasePool scheduling", () => {
  const tempDir = useTempDir("sqlite-async-pool-concurrency-");

  test("awaited calls preserve application order", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(id INTEGER PRIMARY KEY, value TEXT)");
      await pool.run("INSERT INTO item VALUES (1, 'first')");
      await pool.run("UPDATE item SET value = 'second' WHERE id = 1");
      await expect(
        pool.get("SELECT value FROM item WHERE id = 1"),
      ).resolves.toEqual({
        value: "second",
      });
    } finally {
      await pool.close();
    }
  });

  test("a failed request does not stall queued work", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      const failed = pool.get("SELECT * FROM missing_table");
      const succeeded = pool.get("SELECT 42 AS value");
      await expect(failed).rejects.toThrow(/missing_table|no such table/i);
      await expect(succeeded).resolves.toEqual({ value: 42 });
    } finally {
      await pool.close();
    }
  });

  test("replays connection-local setup on every physical connection", async () => {
    const pool = await DatabasePool.open(tempDir.getDbPath("setup-replay.db"), {
      connections: 2,
      authorizer: "strict",
      connectionSetup: [
        { sql: "CREATE TEMP TABLE configured(value TEXT)" },
        { sql: "INSERT INTO configured VALUES ('ready')" },
      ],
    });
    try {
      const [first, second] = await Promise.all([
        pool.get(`
          WITH RECURSIVE n(x) AS (
            VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 100000
          )
          SELECT (SELECT value FROM configured) AS value, max(x) AS count FROM n
        `),
        pool.get(`
          WITH RECURSIVE n(x) AS (
            VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 100000
          )
          SELECT (SELECT value FROM configured) AS value, max(x) AS count FROM n
        `),
      ]);
      expect(first).toEqual({ value: "ready", count: 100000 });
      expect(second).toEqual({ value: "ready", count: 100000 });
    } finally {
      await pool.close();
    }
  });

  test("waiting requests remain in JavaScript rather than occupying libuv workers", async () => {
    const dbPath = tempDir.getDbPath("queued-workers.db");
    const setup = new DatabaseSync(dbPath);
    setup.exec("CREATE TABLE item(value TEXT); BEGIN IMMEDIATE");
    let blockerActive = true;

    const pool = await DatabasePool.open(dbPath, {
      connections: 2,
      authorizer: "none",
      connectionSetup: [{ sql: "PRAGMA busy_timeout=10000" }],
    });
    let requestResources = 0;
    const hook = createHook({
      init(_asyncId, type) {
        if (type === "photostructure.sqlite.pool.request") {
          requestResources++;
        }
      },
    });
    hook.enable();

    try {
      const writes = Array.from({ length: 6 }, (_, i) =>
        pool.run("INSERT INTO item VALUES (?)", [`value-${i}`]),
      );
      expect(
        await waitForCondition(() => requestResources === 2, {
          maxAttempts: 100,
          delay: 10,
          description: "two leased native requests",
        }),
      ).toBe(true);
      expect(requestResources).toBe(2);

      setup.exec("ROLLBACK");
      blockerActive = false;
      await expect(Promise.all(writes)).resolves.toHaveLength(6);
    } finally {
      hook.disable();
      if (setup.isOpen) {
        if (blockerActive) setup.exec("ROLLBACK");
        setup.close();
      }
      await pool.close();
    }
  });

  test("a later connection setup failure closes earlier slots", async () => {
    const dbPath = tempDir.getDbPath("partial-open.db");
    await expect(
      DatabasePool.open(dbPath, {
        connections: 2,
        authorizer: "none",
        connectionSetup: [{ sql: "CREATE TABLE only_once(value)" }],
      }),
    ).rejects.toThrow(/already exists/i);

    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE only_once");
    db.close();
  });
});
