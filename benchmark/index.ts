#!/usr/bin/env tsx

import chalk from "chalk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDriver, getAvailableDrivers } from "./drivers.js";
import { getScenarios } from "./scenarios.js";
/**
 * Round a number to the specified number of significant figures.
 *
 * @param value   The number to round.
 * @param digits  How many significant figures to keep (must be ≥ 1).
 * @returns       The rounded number, or 0 for non-finite inputs or zero.
 */
function sigFigs(value: number, digits = 2): number {
  if (!isFinite(value) || value === 0 || digits < 1) {
    return 0;
  }
  // toPrecision gives a string with the correct sig-figs,
  // parseFloat turns it back into a number.
  return parseFloat(value.toPrecision(digits));
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  filter: null as string | null,
  drivers: null as string[] | null,
  memory: args.includes("--memory"),
  verbose: args.includes("--verbose"),
  iterations: null as number | null,
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--drivers" && i + 1 < args.length) {
    options.drivers = args[i + 1].split(",");
    i++;
  } else if (args[i] === "--iterations" && i + 1 < args.length) {
    options.iterations = parseInt(args[i + 1]);
    i++;
  } else if (!args[i].startsWith("--")) {
    options.filter = args[i];
  }
}

// Show usage
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: tsx benchmark/index.ts [scenario] [options]

Options:
  --drivers <list>     Comma-separated list of drivers to test
                       Available: ${getAvailableDrivers().join(", ")}
  --iterations <n>     Override default iteration count
  --memory             Track memory usage
  --verbose            Show detailed output
  --help, -h           Show this help

Examples:
  tsx benchmark/index.ts                    # Run all benchmarks
  tsx benchmark/index.ts select              # Run only select benchmarks
  tsx benchmark/index.ts --drivers @photostructure/sqlite,better-sqlite3
  tsx benchmark/index.ts insert --iterations 5000
`);
  process.exit(0);
}

// Get drivers to test
const driversToTest = options.drivers ?? getAvailableDrivers();
const scenarios = getScenarios(options.filter);

if (scenarios.length === 0) {
  console.error(chalk.red(`No scenarios found matching: ${options.filter}`));
  process.exit(1);
}

// Main benchmark function with top-level await
console.log(chalk.bold.cyan("🚀 SQLite Driver Performance Benchmark\n"));
console.log(chalk.gray(`Testing drivers: ${driversToTest.join(", ")}`));
console.log(chalk.gray(`Scenarios: ${scenarios.length}\n`));

// Results storage
const results: Record<string, Record<string, any>> = {};

// Memory tracking
let memoryBaseline: NodeJS.MemoryUsage | null = null;
if (options.memory && global.gc) {
  global.gc();
  memoryBaseline = process.memoryUsage();
}

// Run benchmarks for each scenario
for (const [scenarioKey, scenario] of scenarios) {
  console.log(chalk.bold.yellow(`\n📊 ${scenario.name}`));
  console.log(chalk.gray(`   ${scenario.description}`));

  results[scenarioKey] = {};

  // Skip Benchmark.js and run manual benchmark directly
  console.log(chalk.yellow("   Running manual benchmark..."));

  // First, determine optimal iterations by running the first available driver for 2 seconds
  let optimalIterations = 100; // fallback
  const calibrationDriver = driversToTest.find((d) =>
    getAvailableDrivers().includes(d),
  );

  if (calibrationDriver) {
    try {
      console.log(
        chalk.gray(`   Calibrating iterations with ${calibrationDriver}...`),
      );
      const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-calibration-"));
      const dbPath = join(tempDir, "bench.db");
      const driver = await createDriver(calibrationDriver, dbPath);
      const currentScenario = scenarios.find(
        ([key]) => key === scenarioKey,
      )?.[1];
      if (!currentScenario)
        throw new Error(`Scenario ${scenarioKey} not found`);
      const stmt = currentScenario.setup(driver);

      // Run for 2 seconds to determine optimal iteration count
      const targetDurationMs = 2000;
      let iterations = 0;
      const start = process.hrtime.bigint();
      let end = start;

      while (Number(end - start) / 1_000_000 < targetDurationMs) {
        currentScenario.run(stmt, iterations);
        iterations++;
        end = process.hrtime.bigint();
      }

      optimalIterations = Math.max(10, Math.min(1000, iterations)); // Clamp between 10-1000
      console.log(
        chalk.gray(`   Using ${optimalIterations} iterations per driver`),
      );

      // Cleanup calibration
      if (currentScenario.cleanup) {
        currentScenario.cleanup(stmt);
      } else if (
        stmt &&
        typeof stmt === "object" &&
        "finalize" in stmt &&
        typeof stmt.finalize === "function"
      ) {
        stmt.finalize();
      }
      await driver.close();
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.log(
        chalk.yellow(
          `   Calibration failed, using default ${optimalIterations} iterations`,
        ),
      );
    }
  }

  // Manual benchmarking with optimal iterations
  for (const driverName of driversToTest) {
    if (!getAvailableDrivers().includes(driverName)) continue;

    try {
      const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-"));
      const dbPath = join(tempDir, "bench.db");
      const driver = await createDriver(driverName, dbPath);
      const currentScenario = scenarios.find(
        ([key]) => key === scenarioKey,
      )?.[1];
      if (!currentScenario)
        throw new Error(`Scenario ${scenarioKey} not found`);
      const stmt = currentScenario.setup(driver);

      // Manual timing with calibrated iterations
      const start = process.hrtime.bigint();

      for (let i = 0; i < optimalIterations; i++) {
        currentScenario.run(stmt, i);
      }

      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      const opsPerSec = (optimalIterations / durationMs) * 1000;

      console.log(
        chalk.green(
          `   ${driverName}: ${Math.round(opsPerSec).toLocaleString()} ops/sec`,
        ),
      );

      // Store results
      results[scenarioKey][driverName] = {
        hz: opsPerSec,
        rme: 0,
        runs: optimalIterations,
        mean: durationMs / optimalIterations,
        deviation: 0,
      };

      // Cleanup
      if (currentScenario.cleanup) {
        currentScenario.cleanup(stmt);
      } else if (
        stmt &&
        typeof stmt === "object" &&
        "finalize" in stmt &&
        typeof stmt.finalize === "function"
      ) {
        stmt.finalize();
      }
      await driver.close();
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(
        chalk.red(`   ✗ Error in ${driverName}: ${(err as Error).message}`),
      );
    }
  }
}

// Summary
console.log(chalk.bold.cyan("\n\n### 📈 Summary\n"));

// Generate markdown table
const availableDrivers = driversToTest.filter((d) =>
  getAvailableDrivers().includes(d),
);
console.log("| Scenario | " + availableDrivers.join(" | ") + " |");
console.log(
  "|" + ["---"].concat(availableDrivers.map(() => "---:")).join("|") + "|",
);

for (const [scenarioKey, scenario] of scenarios) {
  const row = [scenario.name];

  for (const driver of availableDrivers) {
    const result = results[scenarioKey]?.[driver];
    if (result) {
      // Format with commas
      const hz = sigFigs(result.hz);
      const formatted = `${hz.toLocaleString()} ops/s`;
      row.push(formatted);
    } else {
      row.push("N/A");
    }
  }

  console.log("| " + row.join(" | ") + " |");
}

// Memory usage report
if (options.memory && global.gc) {
  global.gc();
  const memoryFinal = process.memoryUsage();

  console.log(chalk.bold.cyan("\n\n### 💾 Memory Usage\n"));

  const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  console.log("| Metric | Baseline | Final | Delta |");
  console.log("|---:|---:|---:|---:|");

  for (const key of ["rss", "heapTotal", "heapUsed", "external"] as const) {
    const delta = memoryFinal[key] - memoryBaseline![key];
    const deltaStr = delta > 0 ? `+${formatMB(delta)}` : formatMB(delta);

    console.log(
      `| ${key} | ${formatMB(memoryBaseline![key])} | ${formatMB(memoryFinal[key])} | ${deltaStr} |`,
    );
  }

  console.log(
    "\n" +
      chalk.gray(
        "📋 Memory table generated above - copy/paste ready for documentation!",
      ),
  );
}

// Performance ranking
console.log(chalk.bold.cyan("\n\n### 🏆 Overall Performance Ranking\n"));

const overallScores: Record<string, number> = {};
for (const driver of driversToTest) {
  if (!getAvailableDrivers().includes(driver)) continue;

  let totalScore = 0;
  let scenarioCount = 0;

  for (const [scenarioKey] of scenarios) {
    const result = results[scenarioKey]?.[driver];
    if (result) {
      // Find the fastest for this scenario
      let maxHz = 0;
      for (const d of driversToTest) {
        const r = results[scenarioKey]?.[d];
        if (r && r.hz > maxHz) {
          maxHz = r.hz;
        }
      }

      // Calculate relative performance (0-100)
      if (maxHz > 0) {
        totalScore += (result.hz / maxHz) * 100;
        scenarioCount++;
      }
    }
  }

  if (scenarioCount > 0) {
    overallScores[driver] = sigFigs(totalScore / scenarioCount);
  }
}

// Sort by score
const rankedDrivers = Object.entries(overallScores).sort(
  ([, a], [, b]) => b - a,
);

// Output as markdown table
console.log("| Rank | Driver | Score |");
console.log("|---:|---|---:|");

const medals = ["🥇", "🥈", "🥉", "🐌", "🥔", "😅", "💩"];
rankedDrivers.forEach(([driver, score], index) => {
  const medal = medals[index] ?? "🤷";
  const rank = `${index + 1} ${medal}`;
  console.log(`| ${rank} | ${driver} | ${score}% |`);
});

console.log("\n✨ Benchmark complete!\n");
