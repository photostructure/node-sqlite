import * as stable from "@photostructure/sqlite";
import {
  DatabasePool,
  type DatabasePoolOptions,
  type PoolOperationResult,
} from "@photostructure/sqlite/experimental";

type AssertFalse<T extends false> = T;
type StableRootHasNoPool = AssertFalse<
  "DatabasePool" extends keyof typeof stable ? true : false
>;

const options = {
  connections: 1,
  authorizer: "none",
  returnArrays: true,
} satisfies DatabasePoolOptions;

// @ts-expect-error DatabasePool instances must come from DatabasePool.open().
new DatabasePool();

async function consumeEsmDeclarations(): Promise<void> {
  await using pool = await DatabasePool.open(":memory:", options);
  const results: PoolOperationResult[] = await pool.batch([
    { kind: "get", sql: "SELECT 1" },
  ]);
  void results;
}

void consumeEsmDeclarations;
void (null as unknown as StableRootHasNoPool);
