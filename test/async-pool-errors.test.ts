import { DatabasePool } from "../src/experimental";

describe("DatabasePool errors and connection invariants", () => {
  test("returns detailed SQLite errors", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.get("SELECT * FROM missing_table"),
      ).rejects.toMatchObject({
        code: "ERR_SQLITE_ERROR",
        sqliteCode: expect.any(Number),
        sqliteExtendedCode: expect.any(Number),
        sqliteCodeName: expect.stringMatching(/^SQLITE_/),
      });
    } finally {
      await pool.close();
    }
  });

  test("does not discard a terminal step error after producing a row", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.all(`
          WITH input(value) AS (VALUES ('{"ok": 1}'), ('not-json'))
          SELECT json_extract(value, '$.ok') AS value FROM input
        `),
      ).rejects.toThrow(/malformed JSON/i);
    } finally {
      await pool.close();
    }
  });

  test("checks the complete SQL tail before allowing first-statement side effects", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.run("CREATE TABLE should_not_exist(value); SELECT 1"),
      ).rejects.toThrow(/one statement|multiple statements/i);
      await expect(
        pool.get(
          "SELECT name FROM sqlite_schema WHERE name = 'should_not_exist'",
        ),
      ).resolves.toBeUndefined();
    } finally {
      await pool.close();
    }
  });

  test.each([
    "PRAGMA foreign_keys=OFF; SELECT 1",
    "SELECT 1; PRAGMA foreign_keys=OFF",
  ])(
    "tail validation prevents prepare-time PRAGMA side effects: %s",
    async (sql) => {
      const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
      try {
        // SQLite applies foreign_keys during sqlite3_prepare_v2(), not step.
        // Validation must therefore compile under an IGNORE authorizer before
        // preparing the one accepted statement under the real policy.
        await expect(pool.run(sql)).rejects.toThrow(
          /one statement|multiple statements/i,
        );
        await expect(pool.get("PRAGMA foreign_keys")).resolves.toEqual({
          foreign_keys: 1,
        });
      } finally {
        await pool.close();
      }
    },
  );

  test.each(["", "  -- comments only\n  "])(
    "rejects SQL without an executable statement: %p",
    async (sql) => {
      const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
      try {
        await expect(pool.get(sql)).rejects.toThrow(/one statement|statement/i);
      } finally {
        await pool.close();
      }
    },
  );

  test("run changes are operation-local and never expose lastInsertRowid", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(id INTEGER PRIMARY KEY, value TEXT)");
      const inserted = await pool.run(
        "INSERT INTO item(value) VALUES ('first'), ('second')",
      );
      const noUpdate = await pool.run(
        "UPDATE item SET value = 'missing' WHERE id = 999",
      );
      const selected = await pool.run("SELECT * FROM item");
      const ddl = await pool.run("CREATE INDEX item_value ON item(value)");

      expect(inserted).toEqual({ changes: 2 });
      expect(noUpdate).toEqual({ changes: 0 });
      expect(selected).toEqual({ changes: 0 });
      expect(ddl).toEqual({ changes: 0 });
      expect("lastInsertRowid" in inserted).toBe(false);
    } finally {
      await pool.close();
    }
  });

  test("rolls back user SQL that leaves autocommit disabled", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE item(value TEXT)");
      await expect(pool.run("BEGIN")).rejects.toThrow(
        /transaction|autocommit/i,
      );
      await expect(
        pool.run("INSERT INTO item VALUES ('usable')"),
      ).resolves.toEqual({
        changes: 1,
      });
    } finally {
      await pool.close();
    }
  });
});
