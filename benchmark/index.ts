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

// Each measured data point is one trial of `itersPerTrial` operations. We run
// many trials and report the median so a single slow trial (GC, scheduler)
// doesn't skew the result, plus a 95% relative margin of error so noisy
// scenarios are visibly noisy instead of silently reported as `rme: 0`.
const MEASURED_TRIALS = 15;
const WARMUP_TRIALS = 3;
// Size each trial so it runs long enough that timer granularity and per-call
// overhead are negligible. The old code capped iterations at 1000, which for
// fast ops (~1M ops/sec) meant timing ~1ms of work — mostly noise.
const TRIAL_TARGET_MS = 50;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 95% relative margin of error (percent), matching benchmark.js's `rme`. */
function relativeMarginOfError(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const stdErr = Math.sqrt(variance) / Math.sqrt(n);
  return ((stdErr * 1.96) / mean) * 100;
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

// Main benchmark function wrapped in async IIFE for CJS compatibility
(async () => {
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

  // Run benchmarks twice: pass 0 = warmup (discarded), pass 1 = measured
  for (let pass = 0; pass < 2; pass++) {
    const isWarmup = pass === 0;

    if (isWarmup) {
      console.log(chalk.gray("Warmup pass...\n"));
    } else {
      console.log(chalk.bold.cyan("\nMeasured pass:\n"));
    }

    for (const [scenarioKey, scenario] of scenarios) {
      if (isWarmup) {
        process.stdout.write(chalk.gray(`\n  ${scenario.name}:`));
      } else {
        console.log(chalk.bold.yellow(`\n📊 ${scenario.name}`));
        console.log(chalk.gray(`   ${scenario.description}`));
      }

      if (!isWarmup) {
        results[scenarioKey] = {};
      }

      // First, determine optimal iterations by running the first available driver for 2 seconds
      let optimalIterations = 100; // fallback
      const calibrationDriver = driversToTest.find((d) =>
        getAvailableDrivers().includes(d),
      );

      if (calibrationDriver) {
        try {
          if (!isWarmup) {
            console.log(
              chalk.gray(
                `   Calibrating iterations with ${calibrationDriver}...`,
              ),
            );
          }
          const tempDir = mkdtempSync(
            join(tmpdir(), "sqlite-bench-calibration-"),
          );
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

          // Convert the calibration count (iters that fit in targetDurationMs)
          // into a per-trial count sized to ~TRIAL_TARGET_MS. No upper cap:
          // fast ops need many iters so timing isn't dominated by noise.
          optimalIterations = Math.max(
            10,
            Math.round((iterations * TRIAL_TARGET_MS) / targetDurationMs),
          );
          if (!isWarmup) {
            console.log(
              chalk.gray(
                `   Using ${optimalIterations.toLocaleString()} iterations × ${MEASURED_TRIALS} trials per driver`,
              ),
            );
          }

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
          if (!isWarmup) {
            console.log(
              chalk.yellow(
                `   Calibration failed, using default ${optimalIterations} iterations`,
              ),
            );
          }
        }
      }

      // Benchmark each driver over repeated trials for a median + margin of
      // error. Each trial gets a fresh db + setup so mutating scenarios
      // (INSERT/DELETE) start from an identical state and don't accumulate
      // across trials; setup/teardown is outside the timed region.
      const currentScenario = scenarios.find(
        ([key]) => key === scenarioKey,
      )?.[1];
      if (!currentScenario) continue;

      for (const driverName of driversToTest) {
        if (!getAvailableDrivers().includes(driverName)) continue;

        const trials = isWarmup ? WARMUP_TRIALS : MEASURED_TRIALS;
        const samples: number[] = [];

        try {
          for (let t = 0; t < trials; t++) {
            const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-"));
            const dbPath = join(tempDir, "bench.db");
            const driver = await createDriver(driverName, dbPath);
            const stmt = currentScenario.setup(driver);

            const start = process.hrtime.bigint();
            for (let i = 0; i < optimalIterations; i++) {
              currentScenario.run(stmt, i);
            }
            const durationMs =
              Number(process.hrtime.bigint() - start) / 1_000_000;
            samples.push((optimalIterations / durationMs) * 1000);

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
          }

          const opsPerSec = median(samples);
          const rme = relativeMarginOfError(samples);

          if (isWarmup) {
            process.stdout.write(
              chalk.gray(
                ` ${driverName}:${Math.round(opsPerSec).toLocaleString()}`,
              ),
            );
          } else {
            console.log(
              chalk.green(
                `   ${driverName}: ${Math.round(opsPerSec).toLocaleString()} ops/sec ±${rme.toFixed(1)}% (${trials} trials)`,
              ),
            );

            // Store results only on measured pass
            results[scenarioKey][driverName] = {
              hz: opsPerSec,
              rme,
              runs: optimalIterations * trials,
              mean: 1000 / opsPerSec,
              deviation: 0,
            };
          }
        } catch (err) {
          const msg = `✗ Error in ${driverName}: ${(err as Error).message}`;
          if (isWarmup) {
            process.stdout.write(chalk.yellow(` [${msg}]`));
          } else {
            console.error(chalk.red(`   ${msg}`));
          }
        }
      }
    }

    if (isWarmup) {
      console.log(); // newline after dots
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
        // Format with commas, plus the 95% margin of error so noisy scenarios
        // are visibly noisy rather than looking precise.
        const hz = sigFigs(result.hz);
        const rme = result.rme ? ` ±${result.rme.toFixed(1)}%` : "";
        row.push(`${hz.toLocaleString()} ops/s${rme}`);
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

    const formatMB = (bytes: number) =>
      `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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
})();
