import * as stable from "@photostructure/sqlite";
import {
  DatabasePool,
  type DatabasePoolOptions,
  type PoolOperation,
  type PoolRow,
  type PoolRunResult,
} from "@photostructure/sqlite/experimental";

type AssertFalse<T extends false> = T;
type StableRootHasNoPool = AssertFalse<
  "DatabasePool" extends keyof typeof stable ? true : false
>;

const options = {
  connections: 1,
  authorizer: "strict",
  readBigInts: true,
  returnArrays: false,
  connectionSetup: [{ sql: "PRAGMA foreign_keys=ON" }],
} satisfies DatabasePoolOptions;

const operations = [
  { kind: "run", sql: "INSERT INTO item(value) VALUES (?)", params: [1n] },
  { kind: "get", sql: "SELECT value FROM item" },
] satisfies readonly PoolOperation[];

// @ts-expect-error DatabasePool instances must come from DatabasePool.open().
new DatabasePool();

async function consumeCommonJsDeclarations(): Promise<void> {
  const pool = await DatabasePool.open(":memory:", options);
  const run: PoolRunResult = await pool.run("CREATE TABLE item(value INTEGER)");
  const row: PoolRow | undefined = await pool.get("SELECT value FROM item");
  await pool.batch(operations, { transaction: "immediate" });
  await pool[Symbol.asyncDispose]();
  void run;
  void row;
}

void consumeCommonJsDeclarations;
void (null as unknown as StableRootHasNoPool);
