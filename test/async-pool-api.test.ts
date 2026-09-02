import { pathToFileURL } from "node:url";
import * as stable from "../src";
import { DatabasePool } from "../src/experimental";
import { useTempDir } from "./test-utils";

describe("experimental DatabasePool API", () => {
  const tempDir = useTempDir("sqlite-async-pool-api-");

  test("does not change the stable root export surface", () => {
    expect(Object.keys(stable).sort()).toEqual([
      "DatabaseSync",
      "SQLTagStore",
      "Session",
      "StatementSync",
      "backup",
      "constants",
      "default",
      "enhance",
      "isEnhanced",
    ]);
    expect("DatabasePool" in stable).toBe(false);
  });

  test("exports only the stateless pool operations", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      expect(DatabasePool.name).toBe("DatabasePool");
      expect(typeof pool.run).toBe("function");
      expect(typeof pool.get).toBe("function");
      expect(typeof pool.all).toBe("function");
      expect(typeof pool.batch).toBe("function");
      expect(typeof pool.close).toBe("function");
      expect(typeof pool[Symbol.asyncDispose]).toBe("function");
      expect("prepare" in pool).toBe(false);
      expect("function" in pool).toBe(false);
      expect("aggregate" in pool).toBe(false);
      expect("iterate" in pool).toBe(false);
      expect("loadExtension" in pool).toBe(false);
    } finally {
      await pool.close();
    }
  });

  test("cannot be constructed directly", () => {
    expect(() => {
      // @ts-expect-error DatabasePool instances must come from the async factory.
      new DatabasePool();
    }).toThrow(/illegal constructor/i);
  });

  test.each([
    ["string", () => tempDir.getDbPath("string.db")],
    ["Buffer", () => Buffer.from(tempDir.getDbPath("buffer.db"))],
    ["URL", () => pathToFileURL(tempDir.getDbPath("url.db"))],
  ])("accepts a %s location", async (_label, makeLocation) => {
    const pool = await DatabasePool.open(makeLocation(), {
      authorizer: "none",
    });
    try {
      await pool.run("CREATE TABLE accepted(value TEXT)");
    } finally {
      await pool.close();
    }
  });

  test("copies Buffer and URL locations before asynchronous open", async () => {
    const pools: DatabasePool[] = [];
    try {
      const bufferPath = tempDir.getDbPath("copied-buffer.db");
      const buffer = Buffer.from(bufferPath);
      const bufferOpening = DatabasePool.open(buffer, { authorizer: "none" });
      buffer.fill("x");
      const bufferPool = await bufferOpening;
      pools.push(bufferPool);
      await bufferPool.run("CREATE TABLE from_buffer(value)");

      const urlPath = tempDir.getDbPath("copied-url.db");
      const url = pathToFileURL(urlPath);
      const urlOpening = DatabasePool.open(url, { authorizer: "none" });
      url.pathname = "/mutated-after-open.db";
      const urlPool = await urlOpening;
      pools.push(urlPool);
      await urlPool.run("CREATE TABLE from_url(value)");
    } finally {
      await Promise.allSettled(pools.map((pool) => pool.close()));
    }
  });

  test.each([
    ":memory:",
    "",
    "file:",
    "file:?cache=shared",
    "file::memory:?cache=shared",
    "file:pool-memory?mode=memory&cache=shared",
  ])(
    "rejects multi-connection private or URI memory location %p",
    async (location) => {
      await expect(
        DatabasePool.open(location, { connections: 2, authorizer: "none" }),
      ).rejects.toThrow(/in-memory|temporary/i);
    },
  );

  test("permits in-memory locations with one connection", async () => {
    const pool = await DatabasePool.open(":memory:", {
      connections: 1,
      authorizer: "none",
    });
    await pool.close();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid connection count %p",
    async (connections) => {
      await expect(
        DatabasePool.open(tempDir.getDbPath(), {
          connections,
          authorizer: "none",
        }),
      ).rejects.toThrow(/connections/i);
    },
  );

  test.each([
    ["connections", { connections: null, authorizer: "none" }],
    ["authorizer", { authorizer: null }],
    ["connectionSetup", { authorizer: "none", connectionSetup: null }],
  ])("rejects explicit null for the %s option", async (name, options) => {
    await expect(
      DatabasePool.open(tempDir.getDbPath(), options as any),
    ).rejects.toThrow(name);
  });

  test("defaults to one strict connection", async () => {
    const pool = await DatabasePool.open(":memory:");
    try {
      await expect(pool.get("PRAGMA user_version")).rejects.toThrow(
        /not authorized/i,
      );
    } finally {
      await pool.close();
    }
  });

  test("validates the closed authorizer and setup option vocabulary", async () => {
    await expect(
      DatabasePool.open(tempDir.getDbPath(), { authorizer: "allow" as any }),
    ).rejects.toThrow(/authorizer/i);
    await expect(
      DatabasePool.open(tempDir.getDbPath(), {
        authorizer: "none",
        connectionSetup: [() => undefined as any] as any,
      }),
    ).rejects.toThrow(/connectionSetup/i);
  });
});
