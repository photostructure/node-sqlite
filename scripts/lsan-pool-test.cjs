"use strict";

const vm = require("node:vm");
const v8 = require("node:v8");
const { DatabasePool } = require("../dist/experimental.cjs");

v8.setFlagsFromString("--expose_gc");
const collectGarbage = vm.runInNewContext("gc");

async function main() {
  for (let index = 0; index < 100; index++) {
    const pool = await DatabasePool.open(":memory:", {
      authorizer: "strict",
      connectionSetup: [{ sql: "PRAGMA foreign_keys=ON" }],
    });
    try {
      await pool.run(
        "CREATE TABLE item(id INTEGER PRIMARY KEY, value BLOB NOT NULL)",
      );
      const results = await pool.batch(
        [
          {
            kind: "run",
            sql: "INSERT INTO item(value) VALUES (?)",
            params: [new Uint8Array([index & 0xff, 2, 3])],
          },
          { kind: "get", sql: "SELECT id, value FROM item" },
          { kind: "all", sql: "SELECT id, value FROM item" },
        ],
        { transaction: "immediate" },
      );
      if (results.length !== 3) {
        throw new Error("Async pool batch returned the wrong result count");
      }
      await pool.run("INSERT INTO missing_table VALUES (1)").then(
        () => {
          throw new Error("Async pool error path unexpectedly succeeded");
        },
        () => undefined,
      );
    } finally {
      await pool.close();
    }
    if ((index + 1) % 10 === 0) {
      collectGarbage();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
