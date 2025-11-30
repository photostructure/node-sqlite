/**
 * SQLTagStore Benchmark
 *
 * Compares performance of:
 * - node:sqlite native C++ SQLTagStore implementation
 * - @photostructure/sqlite TypeScript SQLTagStore implementation
 *
 * This validates the design decision to use a TypeScript implementation
 * rather than native code. The hypothesis is that performance is equivalent
 * because SQLite execution dominates, not cache lookups.
 */

import chalk from "chalk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync as PhotostructureDB } from "../src";

interface BenchmarkResult {
  scenario: string;
  driver: string;
  opsPerSec: number;
  meanMs: number;
  iterations: number;
}

interface SQLTagStore {
  get<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): T | undefined;
  all<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): T[];
  run(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): { changes: number; lastInsertRowid: number | bigint };
}

// Try to load node:sqlite
async function getNodeSqlite(): Promise<{
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
    };
    createTagStore(): SQLTagStore;
    close(): void;
  };
} | null> {
  try {
    const mod = await import("node:sqlite");
    // Verify createTagStore exists (added in Node 23.5.0)
    const testDb = new mod.DatabaseSync(":memory:");
    if (typeof testDb.createTagStore !== "function") {
      testDb.close();
      return null;
    }
    testDb.close();
    return mod as any;
  } catch {
    return null;
  }
}

function runBenchmark(
  name: string,
  fn: () => void,
  targetDurationMs = 2000,
): { opsPerSec: number; meanMs: number; iterations: number } {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  // Run for target duration
  let iterations = 0;
  const start = process.hrtime.bigint();
  let elapsed = 0n;

  while (Number(elapsed) / 1_000_000 < targetDurationMs) {
    fn();
    iterations++;
    elapsed = process.hrtime.bigint() - start;
  }

  const durationMs = Number(elapsed) / 1_000_000;
  const opsPerSec = (iterations / durationMs) * 1000;
  const meanMs = durationMs / iterations;

  return { opsPerSec, meanMs, iterations };
}

function setupDatabase(db: {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
}): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      status TEXT DEFAULT 'active'
    )
  `);

  const insert = db.prepare(
    "INSERT INTO users (name, email, age, status) VALUES (?, ?, ?, ?)",
  );
  for (let i = 1; i <= 1000; i++) {
    insert.run(`User ${i}`, `user${i}@example.com`, 20 + (i % 50), "active");
  }
}

async function main() {
  console.log(chalk.bold.cyan("\n🏷️  SQLTagStore Performance Benchmark\n"));

  const nodeSqlite = await getNodeSqlite();

  if (nodeSqlite) {
    console.log(
      chalk.green("✓ node:sqlite available - comparing native vs TypeScript\n"),
    );
  } else {
    console.log(
      chalk.yellow(
        "⚠ node:sqlite not available (requires Node 23.5.0+) - benchmarking @photostructure/sqlite only\n",
      ),
    );
  }

  const results: BenchmarkResult[] = [];
  const tempDir = mkdtempSync(join(tmpdir(), "tagstore-bench-"));

  try {
    // =========================================================================
    // Scenario 1: Single Query Cache Hit
    // Same SQL pattern repeated - measures cache lookup + template parsing
    // =========================================================================
    console.log(chalk.bold.yellow("📊 Scenario 1: Single Query Cache Hit"));
    console.log(
      chalk.gray("   Same SQL pattern repeated, varying only parameters\n"),
    );

    // @photostructure/sqlite
    {
      const dbPath = join(tempDir, "ps-scenario1.db");
      const db = new PhotostructureDB(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      const result = runBenchmark("cache-hit", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        sql.get`SELECT * FROM users WHERE id = ${id}`;
      });

      results.push({
        scenario: "Single Query Cache Hit",
        driver: "@photostructure/sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   @photostructure/sqlite: ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // node:sqlite
    if (nodeSqlite) {
      const dbPath = join(tempDir, "node-scenario1.db");
      const db = new nodeSqlite.DatabaseSync(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      const result = runBenchmark("cache-hit", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        sql.get`SELECT * FROM users WHERE id = ${id}`;
      });

      results.push({
        scenario: "Single Query Cache Hit",
        driver: "node:sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   node:sqlite:            ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // =========================================================================
    // Scenario 2: Manual Prepare Baseline
    // Shows the "optimal" performance - prepare once, reuse statement
    // =========================================================================
    console.log(chalk.bold.yellow("\n📊 Scenario 2: Manual Prepare Baseline"));
    console.log(
      chalk.gray("   Prepare once, reuse - shows SQLTagStore overhead\n"),
    );

    // @photostructure/sqlite
    {
      const dbPath = join(tempDir, "ps-scenario2.db");
      const db = new PhotostructureDB(dbPath);
      setupDatabase(db);
      const stmt = db.prepare("SELECT * FROM users WHERE id = ?");

      const result = runBenchmark("manual-prepare", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        stmt.get(id);
      });

      results.push({
        scenario: "Manual Prepare Baseline",
        driver: "@photostructure/sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   @photostructure/sqlite: ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      stmt.finalize();
      db.close();
    }

    // node:sqlite
    if (nodeSqlite) {
      const dbPath = join(tempDir, "node-scenario2.db");
      const db = new nodeSqlite.DatabaseSync(dbPath);
      setupDatabase(db);
      const stmt = db.prepare("SELECT * FROM users WHERE id = ?");

      const result = runBenchmark("manual-prepare", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        stmt.get(id);
      });

      results.push({
        scenario: "Manual Prepare Baseline",
        driver: "node:sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   node:sqlite:            ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // =========================================================================
    // Scenario 3: Multi-Pattern Workload
    // Rotates through 5 different query patterns - realistic usage
    // =========================================================================
    console.log(chalk.bold.yellow("\n📊 Scenario 3: Multi-Pattern Workload"));
    console.log(
      chalk.gray("   Rotates through 5 query patterns - realistic usage\n"),
    );

    // @photostructure/sqlite
    {
      const dbPath = join(tempDir, "ps-scenario3.db");
      const db = new PhotostructureDB(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      let counter = 0;
      const result = runBenchmark("multi-pattern", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        const pattern = counter++ % 5;

        switch (pattern) {
          case 0:
            sql.get`SELECT * FROM users WHERE id = ${id}`;
            break;
          case 1:
            sql.get`SELECT name, email FROM users WHERE id = ${id}`;
            break;
          case 2:
            sql.all`SELECT * FROM users WHERE age = ${20 + (id % 50)} LIMIT ${10}`;
            break;
          case 3:
            sql.get`SELECT COUNT(*) as count FROM users WHERE status = ${"active"}`;
            break;
          case 4:
            sql.all`SELECT * FROM users ORDER BY id DESC LIMIT ${5}`;
            break;
        }
      });

      results.push({
        scenario: "Multi-Pattern Workload",
        driver: "@photostructure/sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   @photostructure/sqlite: ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // node:sqlite
    if (nodeSqlite) {
      const dbPath = join(tempDir, "node-scenario3.db");
      const db = new nodeSqlite.DatabaseSync(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      let counter = 0;
      const result = runBenchmark("multi-pattern", () => {
        const id = Math.floor(Math.random() * 1000) + 1;
        const pattern = counter++ % 5;

        switch (pattern) {
          case 0:
            sql.get`SELECT * FROM users WHERE id = ${id}`;
            break;
          case 1:
            sql.get`SELECT name, email FROM users WHERE id = ${id}`;
            break;
          case 2:
            sql.all`SELECT * FROM users WHERE age = ${20 + (id % 50)} LIMIT ${10}`;
            break;
          case 3:
            sql.get`SELECT COUNT(*) as count FROM users WHERE status = ${"active"}`;
            break;
          case 4:
            sql.all`SELECT * FROM users ORDER BY id DESC LIMIT ${5}`;
            break;
        }
      });

      results.push({
        scenario: "Multi-Pattern Workload",
        driver: "node:sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   node:sqlite:            ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // =========================================================================
    // Scenario 4: Write Operations
    // INSERT/UPDATE via SQLTagStore
    // =========================================================================
    console.log(chalk.bold.yellow("\n📊 Scenario 4: Write Operations"));
    console.log(chalk.gray("   INSERT operations via SQLTagStore\n"));

    // @photostructure/sqlite
    {
      const dbPath = join(tempDir, "ps-scenario4.db");
      const db = new PhotostructureDB(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      let id = 2000;
      const result = runBenchmark("write-ops", () => {
        id++;
        sql.run`INSERT INTO users (id, name, email, age) VALUES (${id}, ${"Test User"}, ${"test@example.com"}, ${25})`;
      });

      results.push({
        scenario: "Write Operations",
        driver: "@photostructure/sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   @photostructure/sqlite: ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // node:sqlite
    if (nodeSqlite) {
      const dbPath = join(tempDir, "node-scenario4.db");
      const db = new nodeSqlite.DatabaseSync(dbPath);
      setupDatabase(db);
      const sql = db.createTagStore();

      let id = 2000;
      const result = runBenchmark("write-ops", () => {
        id++;
        sql.run`INSERT INTO users (id, name, email, age) VALUES (${id}, ${"Test User"}, ${"test@example.com"}, ${25})`;
      });

      results.push({
        scenario: "Write Operations",
        driver: "node:sqlite",
        ...result,
      });
      console.log(
        chalk.green(
          `   node:sqlite:            ${Math.round(result.opsPerSec).toLocaleString()} ops/sec`,
        ),
      );
      db.close();
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log(chalk.bold.cyan("\n\n### 📈 Summary\n"));

    // Group results by scenario
    const scenarios = [...new Set(results.map((r) => r.scenario))];
    const drivers = [...new Set(results.map((r) => r.driver))];

    console.log("| Scenario | " + drivers.join(" | ") + " | Difference |");
    console.log("|---|" + drivers.map(() => "---:").join("|") + "|---:|");

    for (const scenario of scenarios) {
      const row = [scenario];
      const scenarioResults = results.filter((r) => r.scenario === scenario);

      let psOps = 0;
      let nodeOps = 0;

      for (const driver of drivers) {
        const result = scenarioResults.find((r) => r.driver === driver);
        if (result) {
          row.push(`${Math.round(result.opsPerSec).toLocaleString()}`);
          if (driver === "@photostructure/sqlite") psOps = result.opsPerSec;
          if (driver === "node:sqlite") nodeOps = result.opsPerSec;
        } else {
          row.push("N/A");
        }
      }

      // Calculate difference
      if (psOps && nodeOps) {
        const diff = ((psOps - nodeOps) / nodeOps) * 100;
        const diffStr =
          diff >= 0
            ? chalk.green(`+${diff.toFixed(1)}%`)
            : chalk.red(`${diff.toFixed(1)}%`);
        row.push(diffStr);
      } else {
        row.push("-");
      }

      console.log("| " + row.join(" | ") + " |");
    }

    // Analysis
    if (nodeSqlite) {
      console.log(chalk.bold.cyan("\n### 🔍 Analysis\n"));

      const psResults = results.filter(
        (r) => r.driver === "@photostructure/sqlite",
      );
      const nodeResults = results.filter((r) => r.driver === "node:sqlite");

      if (psResults.length === nodeResults.length) {
        let totalPsOps = 0;
        let totalNodeOps = 0;

        for (let i = 0; i < psResults.length; i++) {
          totalPsOps += psResults[i].opsPerSec;
          totalNodeOps += nodeResults[i].opsPerSec;
        }

        const avgDiff = ((totalPsOps - totalNodeOps) / totalNodeOps) * 100;

        if (Math.abs(avgDiff) < 10) {
          console.log(
            chalk.green(
              `✓ Performance is equivalent (${avgDiff > 0 ? "+" : ""}${avgDiff.toFixed(1)}% average difference)`,
            ),
          );
          console.log(
            chalk.gray(
              "  This validates the TypeScript implementation decision.",
            ),
          );
        } else if (avgDiff > 0) {
          console.log(
            chalk.green(
              `✓ TypeScript implementation is ${avgDiff.toFixed(1)}% faster on average`,
            ),
          );
        } else {
          console.log(
            chalk.yellow(
              `⚠ Native implementation is ${Math.abs(avgDiff).toFixed(1)}% faster on average`,
            ),
          );
        }
      }
    }

    console.log("\n✨ Benchmark complete!\n");
  } finally {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(chalk.red("Benchmark failed:"), err);
  process.exit(1);
});
