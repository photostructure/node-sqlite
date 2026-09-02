import { DatabaseSync } from "../src";
import { DatabasePool } from "../src/experimental";
import { useTempDir } from "./test-utils";

describe("DatabasePool batches", () => {
  const tempDir = useTempDir("sqlite-async-pool-batch-");

  test("returns ordered results from one native job", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(id INTEGER PRIMARY KEY, value TEXT)");
      const results = await pool.batch([
        {
          kind: "run",
          sql: "INSERT INTO item(value) VALUES (?)",
          params: ["a"],
        },
        {
          kind: "run",
          sql: "INSERT INTO item(value) VALUES (?)",
          params: ["b"],
        },
        {
          kind: "get",
          sql: "SELECT value FROM item WHERE id = ?",
          params: [2],
        },
        { kind: "all", sql: "SELECT value FROM item ORDER BY id" },
      ]);

      expect(results).toEqual([
        { changes: 1 },
        { changes: 1 },
        { value: "b" },
        [{ value: "a" }, { value: "b" }],
      ]);
    } finally {
      await pool.close();
    }
  });

  test("an empty batch is a successful no-op", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(pool.batch([])).resolves.toEqual([]);
      await expect(
        pool.batch([], { transaction: "immediate" }),
      ).resolves.toEqual([]);
    } finally {
      await pool.close();
    }
  });

  test("copies every batch descriptor before it waits for a connection", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(value BLOB)");
      const blocker = pool.get(`
        WITH RECURSIVE n(x) AS (
          VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 250000
        )
        SELECT max(x) AS value FROM n
      `);
      const bytes = new Uint8Array([1, 2, 3]);
      const params: any[] = [bytes];
      const operations: any[] = [
        { kind: "run", sql: "INSERT INTO item VALUES (?)", params },
        { kind: "get", sql: "SELECT value FROM item" },
      ];
      const pending = pool.batch(operations);

      operations[0].sql = "SELECT * FROM missing_after_submission";
      operations.push({ kind: "run", sql: "SELECT 2" });
      params[0] = new Uint8Array([9]);
      bytes.fill(8);

      await blocker;
      const results = await pending;
      expect(results[0]).toEqual({ changes: 1 });
      expect(Array.from((results[1] as any).value)).toEqual([1, 2, 3]);
    } finally {
      await pool.close();
    }
  });

  test.each(["deferred", "immediate", "exclusive"] as const)(
    "commits a %s transaction",
    async (transaction) => {
      const dbPath = tempDir.getDbPath(`${transaction}.db`);
      const pool = await DatabasePool.open(dbPath, { authorizer: "none" });
      try {
        await pool.run("CREATE TABLE item(value TEXT)");
        await pool.batch(
          [
            { kind: "run", sql: "INSERT INTO item VALUES ('one')" },
            { kind: "run", sql: "INSERT INTO item VALUES ('two')" },
          ],
          { transaction },
        );
      } finally {
        await pool.close();
      }

      const check = new DatabaseSync(dbPath);
      expect(check.prepare("SELECT count(*) AS count FROM item").get()).toEqual(
        {
          count: 2,
        },
      );
      check.close();
    },
  );

  test("rolls back the whole transactional batch on failure", async () => {
    const dbPath = tempDir.getDbPath("rollback.db");
    const setup = new DatabaseSync(dbPath);
    setup.exec("CREATE TABLE item(value TEXT UNIQUE)");
    setup.close();

    const pool = await DatabasePool.open(dbPath, { authorizer: "none" });
    try {
      await expect(
        pool.batch(
          [
            { kind: "run", sql: "INSERT INTO item VALUES ('same')" },
            { kind: "run", sql: "INSERT INTO item VALUES ('same')" },
          ],
          { transaction: "immediate" },
        ),
      ).rejects.toThrow(/unique/i);
    } finally {
      await pool.close();
    }

    const check = new DatabaseSync(dbPath);
    expect(check.prepare("SELECT count(*) AS count FROM item").get()).toEqual({
      count: 0,
    });
    check.close();
  });

  test("an explicit rollback does not poison an already-restored connection", async () => {
    const pool = await DatabasePool.open(":memory:", {
      connections: 1,
      authorizer: "none",
    });
    try {
      const error = await pool
        .batch([{ kind: "run", sql: "ROLLBACK" }], {
          transaction: "deferred",
        })
        .then(
          () => undefined,
          (reason: unknown) => reason,
        );

      expect(error).toMatchObject({
        name: "Error",
        code: "ERR_SQLITE_ERROR",
      });
      expect(error).not.toHaveProperty("fatal", true);
      // ROLLBACK already made sqlite3_get_autocommit() true, so the failed
      // wrapper COMMIT must reject without retiring this native connection.
      await expect(pool.get("SELECT 42 AS value")).resolves.toEqual({
        value: 42,
      });
    } finally {
      await pool.close();
    }
  });

  test("rolls back when a transactional result cannot be represented", async () => {
    const dbPath = tempDir.getDbPath("result-conversion-rollback.db");
    const setup = new DatabaseSync(dbPath);
    setup.exec("CREATE TABLE item(value TEXT)");
    setup.close();

    const pool = await DatabasePool.open(dbPath, { authorizer: "none" });
    try {
      await expect(
        pool.batch(
          [
            { kind: "run", sql: "INSERT INTO item VALUES ('rolled back')" },
            { kind: "get", sql: "SELECT 9007199254740992 AS value" },
          ],
          { transaction: "immediate" },
        ),
      ).rejects.toMatchObject({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
      });
    } finally {
      await pool.close();
    }

    const check = new DatabaseSync(dbPath);
    expect(check.prepare("SELECT count(*) AS count FROM item").get()).toEqual({
      count: 0,
    });
    check.close();
  });

  test("non-transactional batches fail fast without undoing earlier work", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(value TEXT UNIQUE)");
      await expect(
        pool.batch([
          { kind: "run", sql: "INSERT INTO item VALUES ('kept')" },
          { kind: "run", sql: "INSERT INTO item VALUES ('kept')" },
          { kind: "run", sql: "INSERT INTO item VALUES ('not-run')" },
        ]),
      ).rejects.toThrow(/unique/i);
      await expect(pool.all("SELECT value FROM item")).resolves.toEqual([
        { value: "kept" },
      ]);
    } finally {
      await pool.close();
    }
  });

  test("does not accept callbacks or data-dependent batch construction", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(pool.batch([() => undefined] as any)).rejects.toThrow(
        /operation|descriptor/i,
      );
    } finally {
      await pool.close();
    }
  });
});
