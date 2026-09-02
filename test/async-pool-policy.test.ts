import { DatabasePool } from "../src/experimental";

describe("DatabasePool authorizer policy", () => {
  test("strict permits ordinary main-schema reads and writes", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "strict" });
    try {
      await pool.run("CREATE TABLE item(value TEXT)");
      await pool.run("INSERT INTO item VALUES ('allowed')");
      await expect(pool.get("SELECT value FROM item")).resolves.toEqual({
        value: "allowed",
      });
    } finally {
      await pool.close();
    }
  });

  test.each([
    "PRAGMA user_version",
    "ATTACH DATABASE ':memory:' AS attached",
    "DETACH DATABASE attached",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT user_savepoint",
    "RELEASE user_savepoint",
    "CREATE TEMP TABLE temp_item(value)",
    "CREATE TABLE temp.temp_item(value)",
    "SELECT last_insert_rowid()",
    "SELECT changes()",
    "SELECT total_changes()",
    "SELECT load_extension('not-available')",
  ])("strict rejects connection-affine SQL: %s", async (sql) => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "strict" });
    try {
      await expect(pool.run(sql)).rejects.toThrow(/not authorized/i);
    } finally {
      await pool.close();
    }
  });

  test("strict permits executor-owned transactions while rejecting user control in a batch", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "strict" });
    try {
      await pool.run("CREATE TABLE item(value TEXT)");
      await expect(
        pool.batch(
          [{ kind: "run", sql: "INSERT INTO item VALUES ('committed')" }],
          { transaction: "immediate" },
        ),
      ).resolves.toEqual([{ changes: 1 }]);

      for (const operations of [
        [
          { kind: "run" as const, sql: "BEGIN" },
          { kind: "run" as const, sql: "INSERT INTO item VALUES ('bad')" },
        ],
        [
          { kind: "run" as const, sql: "INSERT INTO item VALUES ('bad')" },
          { kind: "run" as const, sql: "COMMIT" },
        ],
      ]) {
        await expect(
          pool.batch(operations, { transaction: "deferred" }),
        ).rejects.toThrow(/not authorized/i);
      }
      await expect(pool.all("SELECT value FROM item")).resolves.toEqual([
        { value: "committed" },
      ]);
    } finally {
      await pool.close();
    }
  });

  test.each([
    "INSERT INTO temp_item VALUES ('denied')",
    "UPDATE temp_item SET value = 'denied'",
    "DELETE FROM temp_item",
    "ALTER TABLE temp_item RENAME TO renamed_temp_item",
    "DROP TABLE temp_item",
    "CREATE INDEX temp.temp_item_value ON temp_item(value)",
    "CREATE VIRTUAL TABLE temp.temp_search USING fts5(value)",
  ])("strict rejects every tested temp-schema mutation: %s", async (sql) => {
    const pool = await DatabasePool.open(":memory:", {
      authorizer: "strict",
      connectionSetup: [
        { sql: "CREATE TEMP TABLE temp_item(value TEXT)" },
        { sql: "INSERT INTO temp_item VALUES ('kept')" },
      ],
    });
    try {
      await expect(pool.run(sql)).rejects.toThrow(/not authorized/i);
      await expect(pool.all("SELECT value FROM temp_item")).resolves.toEqual([
        { value: "kept" },
      ]);
    } finally {
      await pool.close();
    }
  });

  test("none installs no restrictive authorizer", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(pool.get("PRAGMA user_version")).resolves.toEqual({
        user_version: 0,
      });
      await expect(pool.get("SELECT changes() AS value")).resolves.toEqual({
        value: 0,
      });
    } finally {
      await pool.close();
    }
  });
});
