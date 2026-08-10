#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { pbkdf2 } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { DatabasePool, type PoolAuthorizer } from "../src/experimental.js";
import { DatabaseSync } from "../src/index.js";

type ScenarioGroup =
  | "controls"
  | "pool-scale"
  | "batch"
  | "result-size"
  | "read-write"
  | "repeated-sql"
  | "contention";
type ContentionKind = "crypto" | "fs";

interface Options {
  iterations: number;
  writeIterations: number;
  samples: number;
  warmup: number;
  seedRows: number;
  connections: number[];
  batchSizes: number[];
  resultSizes: number[];
  scenarios: string[] | null;
  contentionWorkers: number;
  cryptoIterations: number;
  heartbeatIntervalMs: number;
  output?: string;
}

interface EventLoopObservation {
  heartbeats: number;
  intervalMs: number;
  maxDelayMs: number | null;
  meanDelayMs: number | null;
}

interface CompetingWorkObservation {
  kind: ContentionKind;
  workers: number;
  completed: number;
  elapsedMs: number;
}

interface Sample {
  sample: number;
  logicalOperations: number;
  materializedRows: number;
  elapsedMs: number;
  operationsPerMs: number;
  rowsPerMs: number;
  eventLoop: EventLoopObservation;
  competingWork?: CompetingWorkObservation;
}

interface Summary {
  medianOperationsPerMs: number;
  medianRowsPerMs: number;
  medianElapsedMs: number;
  relativeMarginOfErrorPct: number;
  minOperationsPerMs: number;
  maxOperationsPerMs: number;
  medianEventLoopHeartbeats: number;
  maxEventLoopDelayMs: number | null;
  competingWorkCompleted?: number;
}

interface TrialContext {
  dbPath: string;
  competingFile: string;
}

interface TrialResult {
  sample: Omit<Sample, "sample">;
}

interface Scenario {
  id: string;
  group: ScenarioGroup;
  description: string;
  settings: Record<string, string | number | boolean>;
  run(context: TrialContext): Promise<TrialResult>;
}

interface ScenarioResult {
  id: string;
  group: ScenarioGroup;
  description: string;
  settings: Record<string, string | number | boolean>;
  samples: Sample[];
  summary: Summary;
}

interface CompetitorController {
  stop(): Promise<CompetingWorkObservation>;
}

const DEFAULT_OPTIONS: Options = {
  iterations: 1_000,
  writeIterations: 200,
  samples: 6,
  warmup: 1,
  seedRows: 2_000,
  connections: [1, 2, 3, 4],
  batchSizes: [10, 100],
  resultSizes: [1, 100, 1_000],
  scenarios: null,
  contentionWorkers: 4,
  cryptoIterations: 10_000,
  heartbeatIntervalMs: 10,
};

const WORKER_SOURCE = String.raw`
  "use strict";
  const { parentPort, workerData } = require("node:worker_threads");
  const { DatabaseSync } = require(workerData.modulePath);
  const db = new DatabaseSync(workerData.dbPath);
  const statement = db.prepare("SELECT value FROM item WHERE id = ?");
  parentPort.on("message", (message) => {
    if (message.type === "get") {
      parentPort.postMessage({
        type: "result",
        id: message.id,
        row: statement.get(message.key),
      });
      return;
    }
    if (message.type === "close") {
      db.close();
      parentPort.postMessage({ type: "closed" });
      parentPort.close();
    }
  });
  parentPort.postMessage({ type: "ready" });
`;

function readArgument(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer`);
  }
  return parsed;
}

function nonNegativeInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative safe integer`);
  }
  return parsed;
}

function integerList(
  value: string | undefined,
  name: string,
  fallback: number[],
): number[] {
  if (value === undefined) return fallback;
  const parsed = value
    .split(",")
    .map((entry) => positiveInteger(entry, name, 0));
  if (parsed.length === 0) throw new Error(`--${name} must not be empty`);
  return [...new Set(parsed)];
}

function parseOptions(args: string[]): Options {
  const output = readArgument(args, "output");
  const scenarios = readArgument(args, "scenarios");
  const options: Options = {
    iterations: positiveInteger(
      readArgument(args, "iterations"),
      "iterations",
      DEFAULT_OPTIONS.iterations,
    ),
    writeIterations: positiveInteger(
      readArgument(args, "write-iterations"),
      "write-iterations",
      DEFAULT_OPTIONS.writeIterations,
    ),
    samples: positiveInteger(
      readArgument(args, "samples"),
      "samples",
      DEFAULT_OPTIONS.samples,
    ),
    warmup: nonNegativeInteger(
      readArgument(args, "warmup"),
      "warmup",
      DEFAULT_OPTIONS.warmup,
    ),
    seedRows: positiveInteger(
      readArgument(args, "seed-rows"),
      "seed-rows",
      DEFAULT_OPTIONS.seedRows,
    ),
    connections: integerList(
      readArgument(args, "connections"),
      "connections",
      DEFAULT_OPTIONS.connections,
    ),
    batchSizes: integerList(
      readArgument(args, "batch-sizes"),
      "batch-sizes",
      DEFAULT_OPTIONS.batchSizes,
    ),
    resultSizes: integerList(
      readArgument(args, "result-sizes"),
      "result-sizes",
      DEFAULT_OPTIONS.resultSizes,
    ),
    scenarios:
      scenarios === undefined
        ? null
        : scenarios
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
    contentionWorkers: positiveInteger(
      readArgument(args, "contention-workers"),
      "contention-workers",
      DEFAULT_OPTIONS.contentionWorkers,
    ),
    cryptoIterations: positiveInteger(
      readArgument(args, "crypto-iterations"),
      "crypto-iterations",
      DEFAULT_OPTIONS.cryptoIterations,
    ),
    heartbeatIntervalMs: positiveInteger(
      readArgument(args, "heartbeat-ms"),
      "heartbeat-ms",
      DEFAULT_OPTIONS.heartbeatIntervalMs,
    ),
  };
  if (output !== undefined) options.output = output;
  if (options.seedRows < Math.max(...options.resultSizes)) {
    throw new Error(
      "--seed-rows must be at least the largest --result-sizes value",
    );
  }
  return options;
}

function showHelp(): void {
  console.log(`
Usage: tsx benchmark/async-pool.ts [options]

Options:
  --iterations=N             Read operations per ordinary sample (default 1000)
  --write-iterations=N       Operations per read/write sample (default 200)
  --samples=N                Measured samples per scenario (default 6)
  --warmup=N                 Discarded warmup rounds (default 1)
  --seed-rows=N              Rows in each fresh trial database (default 2000)
  --connections=1,2,3,4      Pool sizes used by scale scenarios
  --batch-sizes=10,100       Explicit batch sizes
  --result-sizes=1,100,1000  Rows materialized by all() scenarios
  --scenarios=LIST           Scenario groups or exact IDs (default all)
  --contention-workers=N     Concurrent crypto/fs jobs (default 4)
  --crypto-iterations=N      PBKDF2 iterations per competing job (default 10000)
  --heartbeat-ms=N           Event-loop heartbeat interval (default 10)
  --output=PATH              Write the versioned raw JSON report
  --list                     List generated scenarios and exit
  --help                     Show this help

Scenario groups: controls, pool-scale, batch, result-size, read-write,
                 repeated-sql, contention

Quick sanity check:
  npm run bench:async -- --iterations=10 --write-iterations=10 \\
    --samples=2 --warmup=0 --result-sizes=1,10
`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function medianRelativeMarginOfError(values: number[]): number {
  const count = values.length;
  if (count < 2) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const center = median(sorted);
  if (center === 0) return 0;

  let cumulative = 0;
  let combination = 1;
  let lowerIndex = 0;
  for (let index = 0; index <= Math.floor((count - 1) / 2); index++) {
    if (index > 0) combination = (combination * (count - index + 1)) / index;
    cumulative += combination / 2 ** count;
    if (1 - 2 * cumulative >= 0.95) lowerIndex = index + 1;
  }

  const low = sorted[Math.max(0, lowerIndex - 1)];
  const high = sorted[Math.min(count - 1, count - lowerIndex)];
  return (
    (Math.max(Math.abs(center - low), Math.abs(high - center)) /
      Math.abs(center)) *
    100
  );
}

function summarize(samples: Sample[]): Summary {
  const operations = samples.map((sample) => sample.operationsPerMs);
  const delays = samples
    .map((sample) => sample.eventLoop.maxDelayMs)
    .filter((value): value is number => value !== null);
  const summary: Summary = {
    medianOperationsPerMs: median(operations),
    medianRowsPerMs: median(samples.map((sample) => sample.rowsPerMs)),
    medianElapsedMs: median(samples.map((sample) => sample.elapsedMs)),
    relativeMarginOfErrorPct: medianRelativeMarginOfError(operations),
    minOperationsPerMs: Math.min(...operations),
    maxOperationsPerMs: Math.max(...operations),
    medianEventLoopHeartbeats: median(
      samples.map((sample) => sample.eventLoop.heartbeats),
    ),
    maxEventLoopDelayMs: delays.length === 0 ? null : Math.max(...delays),
  };
  const competing = samples.map(
    (sample) => sample.competingWork?.completed ?? 0,
  );
  if (competing.some((completed) => completed > 0)) {
    summary.competingWorkCompleted = competing.reduce(
      (total, completed) => total + completed,
      0,
    );
  }
  return summary;
}

async function measure(
  logicalOperations: number,
  materializedRows: number,
  heartbeatIntervalMs: number,
  operation: () => void | Promise<void>,
): Promise<Omit<Sample, "sample">> {
  let heartbeats = 0;
  let totalDelayMs = 0;
  let maxDelayMs = 0;
  let expectedAt = performance.now() + heartbeatIntervalMs;
  const timer = setInterval(() => {
    const now = performance.now();
    const delay = Math.max(0, now - expectedAt);
    heartbeats++;
    totalDelayMs += delay;
    maxDelayMs = Math.max(maxDelayMs, delay);
    expectedAt = now + heartbeatIntervalMs;
  }, heartbeatIntervalMs);
  timer.unref();

  const started = performance.now();
  try {
    await operation();
  } finally {
    clearInterval(timer);
  }
  const elapsedMs = performance.now() - started;
  return {
    logicalOperations,
    materializedRows,
    elapsedMs,
    operationsPerMs: logicalOperations / elapsedMs,
    rowsPerMs: materializedRows / elapsedMs,
    eventLoop: {
      heartbeats,
      intervalMs: heartbeatIntervalMs,
      maxDelayMs: heartbeats === 0 ? null : maxDelayMs,
      meanDelayMs: heartbeats === 0 ? null : totalDelayMs / heartbeats,
    },
  };
}

function openPool(
  dbPath: string,
  connections: number,
  authorizer: PoolAuthorizer,
): Promise<DatabasePool> {
  return DatabasePool.open(dbPath, {
    connections,
    authorizer,
    connectionSetup: [
      { sql: "PRAGMA journal_mode=WAL" },
      { sql: "PRAGMA busy_timeout=5000" },
    ],
  });
}

function pointReadKey(index: number, seedRows: number): number {
  return (index % seedRows) + 1;
}

async function runConcurrentPointReads(
  pool: DatabasePool,
  operations: number,
  seedRows: number,
  sqlForIndex: (index: number) => string = () =>
    "SELECT value FROM item WHERE id = ?",
): Promise<void> {
  await Promise.all(
    Array.from({ length: operations }, (_, index) =>
      pool.get(sqlForIndex(index), [pointReadKey(index, seedRows)]),
    ),
  );
}

async function startCompetitors(
  kind: ContentionKind,
  file: string,
  workers: number,
  cryptoIterations: number,
): Promise<CompetitorController> {
  let stopping = false;
  let completed = 0;
  let failure: unknown;
  let stopPromise: Promise<CompetingWorkObservation> | undefined;
  const started = performance.now();

  const perform =
    kind === "crypto"
      ? () =>
          new Promise<void>((resolvePromise, rejectPromise) => {
            pbkdf2(
              "sqlite-pool-benchmark",
              "photostructure",
              cryptoIterations,
              32,
              "sha256",
              (error) => (error ? rejectPromise(error) : resolvePromise()),
            );
          })
      : async () => {
          await readFile(file);
        };

  const pumps = Array.from({ length: workers }, async () => {
    while (!stopping) {
      try {
        await perform();
        completed++;
      } catch (error) {
        failure = error;
        stopping = true;
      }
    }
  });

  return {
    async stop(): Promise<CompetingWorkObservation> {
      stopPromise ??= (async () => {
        stopping = true;
        await Promise.all(pumps);
        if (failure !== undefined) throw failure;
        return {
          kind,
          workers,
          completed,
          elapsedMs: performance.now() - started,
        };
      })();
      return stopPromise;
    },
  };
}

async function seedTrial(options: Options): Promise<{
  directory: string;
  context: TrialContext;
}> {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-async-pool-bench-"));
  const dbPath = join(directory, "benchmark.db");
  const competingFile = join(directory, "contention.bin");
  const database = new DatabaseSync(dbPath);
  try {
    database.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE item(" +
        "id INTEGER PRIMARY KEY, value TEXT, payload TEXT, counter INTEGER DEFAULT 0)",
    );
    database.exec("BEGIN");
    const insert = database.prepare(
      "INSERT INTO item(value, payload) VALUES (?, ?)",
    );
    const payload = "x".repeat(128);
    for (let index = 0; index < options.seedRows; index++) {
      insert.run(`value-${index}`, payload);
    }
    database.exec("COMMIT");
  } finally {
    database.close();
  }
  await writeFile(competingFile, Buffer.alloc(1024 * 1024, 0x5a));
  return { directory, context: { dbPath, competingFile } };
}

function createSyncControls(options: Options): Scenario[] {
  const controls: Scenario[] = [
    {
      id: "warm-sync-reused-statement",
      group: "controls",
      description: "Warm DatabaseSync connection with one reused statement",
      settings: { implementation: "DatabaseSync", connection: "warm" },
      async run({ dbPath }): Promise<TrialResult> {
        const database = new DatabaseSync(dbPath);
        const statement = database.prepare(
          "SELECT value FROM item WHERE id = ?",
        );
        try {
          return {
            sample: await measure(
              options.iterations,
              options.iterations,
              options.heartbeatIntervalMs,
              () => {
                for (let index = 0; index < options.iterations; index++) {
                  statement.get(pointReadKey(index, options.seedRows));
                }
              },
            ),
          };
        } finally {
          database.close();
        }
      },
    },
    {
      id: "fresh-sync-connection",
      group: "controls",
      description: "Open, query, and close DatabaseSync for every operation",
      settings: { implementation: "DatabaseSync", connection: "fresh" },
      async run({ dbPath }): Promise<TrialResult> {
        return {
          sample: await measure(
            options.iterations,
            options.iterations,
            options.heartbeatIntervalMs,
            () => {
              for (let index = 0; index < options.iterations; index++) {
                const database = new DatabaseSync(dbPath);
                database
                  .prepare("SELECT value FROM item WHERE id = ?")
                  .get(pointReadKey(index, options.seedRows));
                database.close();
              }
            },
          ),
        };
      },
    },
    {
      id: "worker-thread-sync-control",
      group: "controls",
      description: "One DatabaseSync worker thread with per-operation messages",
      settings: { implementation: "worker_threads + DatabaseSync", workers: 1 },
      async run({ dbPath }): Promise<TrialResult> {
        const modulePath = resolve(import.meta.dirname, "../dist/index.cjs");
        const worker = new Worker(WORKER_SOURCE, {
          eval: true,
          workerData: { dbPath, modulePath },
        });
        try {
          await new Promise<void>((resolveReady, rejectReady) => {
            const onMessage = (message: { type?: string }) => {
              if (message.type !== "ready") return;
              worker.off("error", rejectReady);
              worker.off("message", onMessage);
              resolveReady();
            };
            worker.on("message", onMessage);
            worker.once("error", rejectReady);
          });

          return {
            sample: await measure(
              options.iterations,
              options.iterations,
              options.heartbeatIntervalMs,
              async () => {
                let remaining = options.iterations;
                const completed = new Promise<void>((resolveCompleted) => {
                  const onMessage = (message: { type?: string }) => {
                    if (message.type !== "result") return;
                    remaining--;
                    if (remaining === 0) {
                      worker.off("message", onMessage);
                      resolveCompleted();
                    }
                  };
                  worker.on("message", onMessage);
                });
                for (let index = 0; index < options.iterations; index++) {
                  worker.postMessage({
                    type: "get",
                    id: index,
                    key: pointReadKey(index, options.seedRows),
                  });
                }
                await completed;
              },
            ),
          };
        } finally {
          worker.postMessage({ type: "close" });
          await once(worker, "exit");
        }
      },
    },
  ];
  return controls;
}

function createPoolScaleScenarios(options: Options): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const authorizer of ["none", "strict"] as const) {
    for (const connections of options.connections) {
      scenarios.push({
        id: `pool-${authorizer}-${connections}c-point-read`,
        group: "pool-scale",
        description: `${connections}-connection ${authorizer} pool, concurrent point reads`,
        settings: { authorizer, connections, operation: "get" },
        async run({ dbPath }): Promise<TrialResult> {
          const pool = await openPool(dbPath, connections, authorizer);
          try {
            return {
              sample: await measure(
                options.iterations,
                options.iterations,
                options.heartbeatIntervalMs,
                () =>
                  runConcurrentPointReads(
                    pool,
                    options.iterations,
                    options.seedRows,
                  ),
              ),
            };
          } finally {
            await pool.close();
          }
        },
      });
    }
  }
  return scenarios;
}

function createBatchScenarios(options: Options): Scenario[] {
  return options.batchSizes.map((batchSize) => ({
    id: `pool-none-1c-batch-${batchSize}`,
    group: "batch" as const,
    description: `One-connection none pool, explicit get batches of ${batchSize}`,
    settings: { authorizer: "none", connections: 1, batchSize },
    async run({ dbPath }): Promise<TrialResult> {
      const pool = await openPool(dbPath, 1, "none");
      try {
        return {
          sample: await measure(
            options.iterations,
            options.iterations,
            options.heartbeatIntervalMs,
            async () => {
              for (
                let offset = 0;
                offset < options.iterations;
                offset += batchSize
              ) {
                const count = Math.min(batchSize, options.iterations - offset);
                await pool.batch(
                  Array.from({ length: count }, (_, index) => ({
                    kind: "get" as const,
                    sql: "SELECT value FROM item WHERE id = ?",
                    params: [pointReadKey(offset + index, options.seedRows)],
                  })),
                );
              }
            },
          ),
        };
      } finally {
        await pool.close();
      }
    },
  }));
}

function createResultSizeScenarios(options: Options): Scenario[] {
  return options.resultSizes.map((resultSize) => {
    const operations = Math.max(
      1,
      Math.floor(options.iterations / Math.max(1, resultSize / 10)),
    );
    return {
      id: `pool-none-all-${resultSize}-rows`,
      group: "result-size" as const,
      description: `One-connection none pool, all() materializing ${resultSize} rows`,
      settings: {
        authorizer: "none",
        connections: 1,
        resultSize,
        operations,
      },
      async run({ dbPath }): Promise<TrialResult> {
        const pool = await openPool(dbPath, 1, "none");
        try {
          return {
            sample: await measure(
              operations,
              operations * resultSize,
              options.heartbeatIntervalMs,
              async () => {
                for (let index = 0; index < operations; index++) {
                  await pool.all(
                    "SELECT id, value, payload FROM item ORDER BY id LIMIT ?",
                    [resultSize],
                  );
                }
              },
            ),
          };
        } finally {
          await pool.close();
        }
      },
    };
  });
}

function createReadWriteScenarios(options: Options): Scenario[] {
  return [
    { id: "100r-0w", writesEvery: 0, readsPct: 100, writesPct: 0 },
    { id: "90r-10w", writesEvery: 10, readsPct: 90, writesPct: 10 },
    { id: "0r-100w", writesEvery: 1, readsPct: 0, writesPct: 100 },
  ].map(({ id, writesEvery, readsPct, writesPct }) => ({
    id: `pool-strict-2c-mix-${id}`,
    group: "read-write" as const,
    description: `Two-connection strict pool, ${readsPct}% reads and ${writesPct}% writes`,
    settings: {
      authorizer: "strict",
      connections: 2,
      readsPct,
      writesPct,
    },
    async run({ dbPath }): Promise<TrialResult> {
      const pool = await openPool(dbPath, 2, "strict");
      try {
        return {
          sample: await measure(
            options.writeIterations,
            options.writeIterations -
              (writesEvery === 0
                ? 0
                : writesEvery === 1
                  ? options.writeIterations
                  : Math.ceil(options.writeIterations / writesEvery)),
            options.heartbeatIntervalMs,
            async () => {
              const pending = Array.from(
                { length: options.writeIterations },
                (_, index) => {
                  const isWrite =
                    writesEvery > 0 &&
                    (writesEvery === 1 || index % writesEvery === 0);
                  return isWrite
                    ? pool.run(
                        "UPDATE item SET counter = counter + 1 WHERE id = ?",
                        [pointReadKey(index, options.seedRows)],
                      )
                    : pool.get("SELECT value FROM item WHERE id = ?", [
                        pointReadKey(index, options.seedRows),
                      ]);
                },
              );
              await Promise.all(pending);
            },
          ),
        };
      } finally {
        await pool.close();
      }
    },
  }));
}

function createRepeatedSqlScenarios(options: Options): Scenario[] {
  return [
    {
      id: "pool-none-repeated-identical-sql",
      description: "Repeated identical SQL text (prepare cost/cache baseline)",
      sqlForIndex: () => "SELECT value FROM item WHERE id = ?",
      variants: 1,
    },
    {
      id: "pool-none-rotating-sql-32",
      description: "Equivalent SQL rotated across 32 distinct texts",
      sqlForIndex: (index: number) =>
        `SELECT value FROM item WHERE id = ? /* variant ${index % 32} */`,
      variants: 32,
    },
  ].map(({ id, description, sqlForIndex, variants }) => ({
    id,
    group: "repeated-sql" as const,
    description,
    settings: { authorizer: "none", connections: 1, variants },
    async run({ dbPath }): Promise<TrialResult> {
      const pool = await openPool(dbPath, 1, "none");
      try {
        return {
          sample: await measure(
            options.iterations,
            options.iterations,
            options.heartbeatIntervalMs,
            () =>
              runConcurrentPointReads(
                pool,
                options.iterations,
                options.seedRows,
                sqlForIndex,
              ),
          ),
        };
      } finally {
        await pool.close();
      }
    },
  }));
}

function createContentionScenarios(options: Options): Scenario[] {
  return (["crypto", "fs"] as const).map((kind) => ({
    id: `pool-none-4c-point-read-with-${kind}`,
    group: "contention" as const,
    description: `Four-connection pool competing with ${kind} libuv work`,
    settings: {
      authorizer: "none",
      connections: 4,
      contention: kind,
      contentionWorkers: options.contentionWorkers,
      ...(kind === "crypto"
        ? { cryptoIterations: options.cryptoIterations }
        : { competingFileBytes: 1024 * 1024 }),
    },
    async run({ dbPath, competingFile }): Promise<TrialResult> {
      const pool = await openPool(dbPath, 4, "none");
      const competitors = await startCompetitors(
        kind,
        competingFile,
        options.contentionWorkers,
        options.cryptoIterations,
      );
      try {
        const sample = await measure(
          options.iterations,
          options.iterations,
          options.heartbeatIntervalMs,
          () =>
            runConcurrentPointReads(pool, options.iterations, options.seedRows),
        );
        sample.competingWork = await competitors.stop();
        return { sample };
      } finally {
        try {
          await competitors.stop();
        } finally {
          await pool.close();
        }
      }
    },
  }));
}

function createScenarios(options: Options): Scenario[] {
  return [
    ...createSyncControls(options),
    ...createPoolScaleScenarios(options),
    ...createBatchScenarios(options),
    ...createResultSizeScenarios(options),
    ...createReadWriteScenarios(options),
    ...createRepeatedSqlScenarios(options),
    ...createContentionScenarios(options),
  ];
}

function selectScenarios(
  scenarios: Scenario[],
  filters: string[] | null,
): Scenario[] {
  if (filters === null) return scenarios;
  const selected = scenarios.filter(
    (scenario) =>
      filters.includes(scenario.group) || filters.includes(scenario.id),
  );
  const known = new Set(
    scenarios.flatMap((scenario) => [scenario.group, scenario.id]),
  );
  const unknown = filters.filter(
    (filter) => !known.has(filter as ScenarioGroup),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown --scenarios value(s): ${unknown.join(", ")}`);
  }
  if (selected.length === 0)
    throw new Error("--scenarios selected no scenarios");
  return selected;
}

async function runOneTrial(
  scenario: Scenario,
  options: Options,
  sample: number,
): Promise<Sample> {
  const { directory, context } = await seedTrial(options);
  try {
    const result = await scenario.run(context);
    return { sample, ...result.sample };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function packageMetadata(): Promise<{
  name: string;
  version: string;
  sqlite: string;
}> {
  const content = await readFile(
    resolve(import.meta.dirname, "../package.json"),
    "utf8",
  );
  const parsed = JSON.parse(content) as {
    name: string;
    version: string;
    versions: { sqlite: string };
  };
  return {
    name: parsed.name,
    version: parsed.version,
    sqlite: parsed.versions.sqlite,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  const options = parseOptions(args);
  const allScenarios = createScenarios(options);
  if (args.includes("--list")) {
    for (const scenario of allScenarios) {
      console.log(`${scenario.id}\t${scenario.group}\t${scenario.description}`);
    }
    return;
  }
  const scenarios = selectScenarios(allScenarios, options.scenarios);
  const measured = new Map<string, Sample[]>();

  console.log("Experimental DatabasePool benchmark");
  console.log(
    `Scenarios: ${scenarios.length}; samples: ${options.samples}; warmup: ${options.warmup}`,
  );
  console.log(
    `Read iterations: ${options.iterations}; write iterations: ${options.writeIterations}`,
  );

  for (let warmup = 0; warmup < options.warmup; warmup++) {
    console.log(`Warmup ${warmup + 1}/${options.warmup}`);
    for (const scenario of scenarios) {
      await runOneTrial(scenario, options, -(warmup + 1));
    }
  }

  for (let sample = 0; sample < options.samples; sample++) {
    console.log(`Measured round ${sample + 1}/${options.samples}`);
    const order = scenarios.map(
      (_, index) => scenarios[(index + sample) % scenarios.length],
    );
    for (const scenario of order) {
      const result = await runOneTrial(scenario, options, sample + 1);
      const samples = measured.get(scenario.id) ?? [];
      samples.push(result);
      measured.set(scenario.id, samples);
      console.log(
        `  ${scenario.id}: ${result.operationsPerMs.toFixed(3)} ops/ms` +
          ` (${result.elapsedMs.toFixed(1)} ms)`,
      );
    }
  }

  const results: ScenarioResult[] = scenarios.map((scenario) => {
    const samples = measured.get(scenario.id) ?? [];
    return {
      id: scenario.id,
      group: scenario.group,
      description: scenario.description,
      settings: scenario.settings,
      samples,
      summary: summarize(samples),
    };
  });

  console.table(
    results.map((result) => ({
      scenario: result.id,
      "median ops/ms": result.summary.medianOperationsPerMs.toFixed(3),
      "median rows/ms": result.summary.medianRowsPerMs.toFixed(3),
      "RME %": result.summary.relativeMarginOfErrorPct.toFixed(1),
      "heartbeat count": result.summary.medianEventLoopHeartbeats.toFixed(1),
    })),
  );

  const metadata = await packageMetadata();
  const dirty = gitValue(["status", "--short"]);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: metadata,
    git: {
      commit: gitValue(["rev-parse", "HEAD"]),
      dirty: dirty === null ? null : dirty.length > 0,
    },
    environment: {
      node: process.version,
      v8: process.versions.v8,
      napi: process.versions.napi,
      uv: process.versions.uv,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      uvThreadpoolSize: process.env["UV_THREADPOOL_SIZE"] ?? "default (4)",
    },
    config: {
      iterations: options.iterations,
      writeIterations: options.writeIterations,
      samples: options.samples,
      warmup: options.warmup,
      seedRows: options.seedRows,
      connections: options.connections,
      batchSizes: options.batchSizes,
      resultSizes: options.resultSizes,
      scenarioFilters: options.scenarios,
      contentionWorkers: options.contentionWorkers,
      cryptoIterations: options.cryptoIterations,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
    },
    results,
  };

  if (options.output !== undefined) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Raw JSON: ${output}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
