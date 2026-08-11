import * as path from "node:path";
import { DatabaseSync } from "../src";
import { DatabasePool } from "../src/experimental";
import { getDirname, useTempDir } from "./test-utils";

const extensionDir = path.join(getDirname(), "fixtures", "test-extension");
const extensionBase = path.join(extensionDir, "test_extension");
const testWithExtension =
  process.env["TEST_EXTENSION_BUILT"] === "1" ? test : test.skip;

describe("DatabasePool connection setup", () => {
  const tempDir = useTempDir("sqlite-async-pool-setup-");

  test("runs ordered parameterized setup before admitting the connection", async () => {
    const attachedPath = tempDir.getDbPath("attached.db");
    const pool = await DatabasePool.open(tempDir.getDbPath("main.db"), {
      authorizer: "strict",
      connectionSetup: [
        { sql: "PRAGMA foreign_keys=ON" },
        { sql: "ATTACH DATABASE ? AS analytics", params: [attachedPath] },
        { sql: "CREATE TABLE analytics.config(value TEXT)" },
        { sql: "INSERT INTO analytics.config VALUES (?)", params: ["ready"] },
      ],
    });
    try {
      await expect(
        pool.get("SELECT value FROM analytics.config"),
      ).resolves.toEqual({
        value: "ready",
      });
    } finally {
      await pool.close();
    }
  });

  test("copies setup descriptors before opening connections sequentially", async () => {
    const setup: any[] = [
      { sql: "CREATE TEMP TABLE configured(value TEXT)" },
      { sql: "INSERT INTO configured VALUES (?)", params: ["ready"] },
    ];
    const opening = DatabasePool.open(tempDir.getDbPath("copied-setup.db"), {
      connections: 2,
      authorizer: "strict",
      connectionSetup: setup,
    });
    setup[0].sql = "SELECT * FROM missing_after_open";
    setup[1].params[0] = "mutated";

    const pool = await opening;
    try {
      const [first, second] = await Promise.all([
        pool.get("SELECT value FROM configured"),
        pool.get("SELECT value FROM configured"),
      ]);
      expect(first).toEqual({ value: "ready" });
      expect(second).toEqual({ value: "ready" });
    } finally {
      await pool.close();
    }
  });

  testWithExtension.each(["none", "strict"] as const)(
    "loads an extension during setup and revokes it under %s",
    async (authorizer) => {
      const pool = await DatabasePool.open(":memory:", {
        authorizer,
        allowExtension: true,
        connectionSetup: [
          {
            sql: "SELECT load_extension(?, ?)",
            params: [extensionBase, "sqlite3_testextension_init"],
          },
        ],
      });
      try {
        await expect(
          pool.get("SELECT test_extension_add(?, ?) AS sum", [2, 3]),
        ).resolves.toEqual({ sum: 5 });
        await expect(
          pool.get("SELECT load_extension(?)", [extensionBase]),
        ).rejects.toThrow(/not authorized|not enabled/i);
      } finally {
        await pool.close();
      }
    },
  );

  test("does not enable SQL extension loading unless explicitly allowed", async () => {
    await expect(
      DatabasePool.open(":memory:", {
        authorizer: "none",
        connectionSetup: [
          { sql: "SELECT load_extension(?)", params: [extensionBase] },
        ],
      }),
    ).rejects.toThrow(/not authorized|not enabled/i);
  });

  test("rejects open when an enabled extension fails to load", async () => {
    await expect(
      DatabasePool.open(":memory:", {
        authorizer: "none",
        allowExtension: true,
        connectionSetup: [
          { sql: "SELECT load_extension(?)", params: ["missing-extension"] },
        ],
      }),
    ).rejects.toThrow(/missing-extension|load|shared|dynamic/i);
  });

  test("rejects open on setup errors and releases the database handle", async () => {
    const dbPath = tempDir.getDbPath("failed-open.db");
    await expect(
      DatabasePool.open(dbPath, {
        authorizer: "none",
        connectionSetup: [{ sql: "SELECT * FROM missing_setup_table" }],
      }),
    ).rejects.toThrow(/missing_setup_table|no such table/i);

    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE handle_was_released(value)");
    db.close();
  });

  test("rejects setup that contains multiple statements or leaks a transaction", async () => {
    await expect(
      DatabasePool.open(":memory:", {
        authorizer: "none",
        connectionSetup: [{ sql: "SELECT 1; SELECT 2" }],
      }),
    ).rejects.toThrow(/one statement|multiple statements/i);
    await expect(
      DatabasePool.open(":memory:", {
        authorizer: "none",
        connectionSetup: [{ sql: "BEGIN" }],
      }),
    ).rejects.toThrow(/transaction|autocommit/i);
  });

  test.each(["", " -- setup comment only\n "])(
    "rejects setup without an executable statement: %p",
    async (sql) => {
      const dbPath = tempDir.getDbPath("empty-setup.db");
      await expect(
        DatabasePool.open(dbPath, {
          authorizer: "none",
          connectionSetup: [{ sql }],
        }),
      ).rejects.toThrow(/one statement|statement/i);

      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE handle_was_released(value)");
      db.close();
    },
  );
});
