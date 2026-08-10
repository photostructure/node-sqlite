import { DatabasePool } from "../src/experimental";

describe("DatabasePool values and rows", () => {
  test("run, get, and all execute one operation without exposing connection state", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.run("CREATE TABLE item(id INTEGER PRIMARY KEY, name TEXT)"),
      ).resolves.toEqual({ changes: 0 });
      await expect(
        pool.run("INSERT INTO item(name) VALUES (?)", ["Ada"]),
      ).resolves.toEqual({ changes: 1 });
      await expect(pool.get("SELECT id, name FROM item", [])).resolves.toEqual({
        id: 1,
        name: "Ada",
      });
      await expect(pool.all("SELECT id, name FROM item", [])).resolves.toEqual([
        { id: 1, name: "Ada" },
      ]);
    } finally {
      await pool.close();
    }
  });

  test("returns null-prototype object rows and duplicate columns are last-wins", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      const row = await pool.get(
        "SELECT 1 AS first, 2 AS duplicate, 3 AS duplicate, 4 AS last",
      );
      expect(Object.getPrototypeOf(row!)).toBeNull();
      expect(Object.keys(row!)).toEqual(["first", "duplicate", "last"]);
      expect(row).toEqual({ first: 1, duplicate: 3, last: 4 });
    } finally {
      await pool.close();
    }
  });

  test("returnArrays and readBigInts are immutable pool-wide result policies", async () => {
    const pool = await DatabasePool.open(":memory:", {
      authorizer: "none",
      readBigInts: true,
      returnArrays: true,
    });
    try {
      await expect(
        pool.get("SELECT 9007199254740992, 'value'"),
      ).resolves.toEqual([9007199254740992n, "value"]);
      await expect(pool.run("CREATE TABLE item(value TEXT)")).resolves.toEqual({
        changes: 0n,
      });
    } finally {
      await pool.close();
    }
  });

  test("unsafe integers reject unless readBigInts is enabled", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.get("SELECT 9007199254740992 AS value"),
      ).rejects.toMatchObject({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
      });
    } finally {
      await pool.close();
    }
  });

  test("positional arrays skip named parameter slots like DatabaseSync", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.get(
          "SELECT $named AS named, ? AS first_positional, ? AS second_positional",
          [42, 84],
        ),
      ).resolves.toEqual({
        named: null,
        first_positional: 42,
        second_positional: 84,
      });
    } finally {
      await pool.close();
    }
  });

  test("copies every supported input value before asynchronous execution", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await pool.run("CREATE TABLE values_table(n, i, f, s, b)");
      const blocker = pool.get(`
        WITH RECURSIVE n(x) AS (
          VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 250000
        )
        SELECT max(x) AS value FROM n
      `);
      const backing = new Uint8Array([99, 1, 2, 3, 88]);
      const view = new DataView(backing.buffer, 1, 3);
      const params: any[] = [null, 42n, 1.5, "text", view];
      const promise = pool.run(
        "INSERT INTO values_table VALUES (?, ?, ?, ?, ?)",
        params,
      );
      backing.fill(0);
      params[3] = "mutated";
      params[4] = new Uint8Array([9]);
      await blocker;
      await promise;

      const row = await pool.get("SELECT n, i, f, s, b FROM values_table");
      expect(row).toMatchObject({ n: null, i: 42, f: 1.5, s: "text" });
      expect(Array.from((row as any).b)).toEqual([1, 2, 3]);
    } finally {
      await pool.close();
    }
  });

  test.each([true, undefined, Symbol("value"), {}, new ArrayBuffer(2)])(
    "rejects unsupported bind value %p",
    async (value) => {
      const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
      try {
        await expect(
          pool.get("SELECT ? AS value", [value as any]),
        ).rejects.toThrow(/bind|parameter/i);
      } finally {
        await pool.close();
      }
    },
  );

  test("accepts bare and prefixed names and rejects conflicts and unknown names", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.get("SELECT $name AS value", { name: "bare" }),
      ).resolves.toEqual({ value: "bare" });
      await expect(
        pool.get("SELECT $name AS value", { $name: "full" }),
      ).resolves.toEqual({ value: "full" });
      await expect(pool.get("SELECT $name", { unknown: 1 })).rejects.toThrow(
        /unknown named parameter/i,
      );
      await expect(
        pool.get("SELECT $value, :value", { value: 1 }),
      ).rejects.toThrow(/conflicting names/i);
    } finally {
      await pool.close();
    }
  });

  test("rejects a second executable statement but permits trailing comments", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(pool.get("SELECT 1; SELECT 2")).rejects.toThrow(
        /one statement|multiple statements/i,
      );
      await expect(
        pool.get("SELECT 1 AS value; -- trailing comment\n"),
      ).resolves.toEqual({ value: 1 });
    } finally {
      await pool.close();
    }
  });
});
