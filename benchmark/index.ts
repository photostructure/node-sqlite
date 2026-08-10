#!/usr/bin/env tsx

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CACHE_PROFILE,
  parseCacheProfile,
  type CacheProfile,
} from "./cache-profile.js";
import { colors } from "./colors.js";
import {
  createDriver,
  getAvailableDrivers,
  type BenchmarkSettings,
} from "./drivers.js";
import { sigFigs } from "./format.js";
import { getScenarios, type Scenario } from "./scenarios.js";
import { buildBenchmarkCharts, writeCharts } from "./svg-chart.js";

// Read a positive-integer override from the environment, else use the default.
// (`||` would misfire on NaN and `??` can't catch NaN either, so validate.)
// Floor BEFORE the range check so a fractional value like 0.5 falls back to the
// default instead of flooring to 0 trials (which would leave no samples).
function envPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw == null ? NaN : Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

// Each measured data point is one trial of `itersPerTrial` operations. We run
// many trials and report the median so a single slow trial (GC, scheduler)
// doesn't skew the result. The accompanying relative half-width comes from an
// exact, distribution-free confidence interval for the median, so the center
// and uncertainty describe the same statistic.
// Trial/warmup counts are overridable for higher-rigor A/B runs, e.g.
//   BENCH_TRIALS=30 BENCH_WARMUP=5 npx tsx index.ts select-range --drivers ...
// Six samples are the minimum for a distribution-free two-sided 95% median
// interval (the full observed range has 96.875% coverage at n=6).
const MEASURED_TRIALS = Math.max(
  6,
  envPositiveInt(process.env.BENCH_TRIALS, 15),
);
const WARMUP_TRIALS = envPositiveInt(process.env.BENCH_WARMUP, 3);
// Size each trial so it runs long enough that timer granularity and per-call
// overhead are negligible. The old code capped iterations at 1000, which for
// fast ops (~1M ops/sec) meant timing ~1ms of work — mostly noise.
const TRIAL_TARGET_MS = 50;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Conservative relative half-width of an exact confidence interval for the
 * population median. The interval uses binomial order statistics and chooses
 * the narrowest interval whose coverage is at least 95%. Because the interval
 * may be asymmetric, report the wider side as a symmetric ± percentage.
 */
function medianRelativeMarginOfError(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const center = median(sorted);
  if (center === 0) return 0;

  // P(Binomial(n, 0.5) <= k - 1) is the probability that fewer than k
  // samples fall on one side of the true median. Pick the largest k whose
  // two-sided order-statistic interval still has at least 95% coverage.
  let cumulative = 0;
  let combination = 1;
  let lowerIndex = 0;
  for (let j = 0; j <= Math.floor((n - 1) / 2); j++) {
    if (j > 0) combination = (combination * (n - j + 1)) / j;
    cumulative += combination / 2 ** n;
    if (1 - 2 * cumulative >= 0.95) lowerIndex = j + 1;
  }

  // For very small sample sets no distribution-free 95% interval exists;
  // using the full observed range is the most conservative available result.
  const low = sorted[Math.max(0, lowerIndex - 1)];
  const high = sorted[Math.min(n - 1, n - lowerIndex)];
  return (
    (Math.max(Math.abs(center - low), Math.abs(high - center)) /
      Math.abs(center)) *
    100
  );
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  filter: null as string | null,
  drivers: null as string[] | null,
  memory: args.includes("--memory"),
  verbose: args.includes("--verbose"),
  iterations: null as number | null,
  cacheProfile: DEFAULT_CACHE_PROFILE as CacheProfile,
  // Write SVG charts to benchmark/charts/ after the run.
  charts: args.includes("--charts") ? "charts" : (null as string | null),
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--drivers" && i + 1 < args.length) {
    options.drivers = args[i + 1].split(",");
    i++;
  } else if (args[i] === "--iterations" && i + 1 < args.length) {
    const iterations = Number(args[i + 1]);
    if (!Number.isInteger(iterations) || iterations < 1) {
      console.error(colors.red("--iterations must be a positive integer"));
      process.exit(1);
    }
    options.iterations = iterations;
    i++;
  } else if (args[i] === "--cache-profile") {
    try {
      const profile = args[i + 1];
      if (profile == null || profile.startsWith("--")) {
        throw new Error("--cache-profile requires controlled|packaged");
      }
      options.cacheProfile = parseCacheProfile(profile);
    } catch (error) {
      console.error(colors.red((error as Error).message));
      process.exit(1);
    }
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
  --iterations <n>     Fixed per-trial iteration count (skips calibration)
  --cache-profile <p>  SQLite cache policy: controlled|packaged
                       Default: controlled
  --charts             Write SVG charts to benchmark/charts/
  --memory             Track memory usage
  --verbose            Show detailed output
  --help, -h           Show this help

Examples:
  tsx benchmark/index.ts                    # Run all benchmarks
  tsx benchmark/index.ts select              # Run only select benchmarks
  tsx benchmark/index.ts --drivers @photostructure/sqlite,better-sqlite3
  tsx benchmark/index.ts insert --iterations 5000
  tsx benchmark/index.ts select-range --cache-profile packaged
  tsx benchmark/index.ts --charts            # Run all benchmarks + emit SVG charts
`);
  process.exit(0);
}

// Get drivers to test
const driversToTest = options.drivers ?? getAvailableDrivers();
const scenarios = getScenarios(options.filter);

if (scenarios.length === 0) {
  console.error(colors.red(`No scenarios found matching: ${options.filter}`));
  process.exit(1);
}

// Finalize a scenario's statement/context. Shared by calibration and measured
// trials so the cleanup logic (custom cleanup() or a bare finalize()) lives once.
function cleanupContext(scenario: Scenario, ctx: any): void {
  if (scenario.cleanup) {
    scenario.cleanup(ctx);
  } else if (
    ctx &&
    typeof ctx === "object" &&
    "finalize" in ctx &&
    typeof ctx.finalize === "function"
  ) {
    ctx.finalize();
  }
}

// Time how many run() calls fit in a 2s window on THIS driver, then scale to a
// ~TRIAL_TARGET_MS per-trial count (floored at 10 so timing isn't dominated by
// timer granularity). Calibrating per driver — rather than sizing every driver
// to one "first" driver's speed — keeps fast drivers from timing too little
// work (noise) and slow drivers from timing too much. The 2s spin also serves
// as that driver's warmup for the scenario.
async function calibrateIterations(
  driverName: string,
  scenario: Scenario,
): Promise<number> {
  const targetDurationMs = 2000;
  const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-cal-"));
  const dbPath = join(tempDir, "bench.db");
  const driver = await createDriver(driverName, dbPath, {
    cacheProfile: options.cacheProfile,
  });
  try {
    const ctx = scenario.setup(driver);
    let iterations = 0;
    const start = process.hrtime.bigint();
    let end = start;
    while (Number(end - start) / 1_000_000 < targetDurationMs) {
      scenario.run(ctx, iterations);
      iterations++;
      end = process.hrtime.bigint();
    }
    cleanupContext(scenario, ctx);
    return Math.max(
      10,
      Math.round((iterations * TRIAL_TARGET_MS) / targetDurationMs),
    );
  } finally {
    await driver.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// One measured trial: fresh db + setup (untimed), time `iters` run() calls, then
// tear down. Fresh state per trial keeps mutating scenarios (INSERT/DELETE) from
// accumulating across trials. Returns ops/sec.
async function runTrial(
  driverName: string,
  scenario: Scenario,
  iters: number,
): Promise<number> {
  const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-"));
  const dbPath = join(tempDir, "bench.db");
  const driver = await createDriver(driverName, dbPath, {
    cacheProfile: options.cacheProfile,
  });
  try {
    const ctx = scenario.setup(driver);
    const start = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) {
      scenario.run(ctx, i);
    }
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    cleanupContext(scenario, ctx);
    return (iters / durationMs) * 1000;
  } finally {
    await driver.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Open one fresh database per driver before calibration/timing so the active
// policy is visible and a controlled-profile mismatch fails before any result
// can be recorded.
async function inspectBenchmarkSettings(
  driverName: string,
): Promise<BenchmarkSettings> {
  const tempDir = mkdtempSync(join(tmpdir(), "sqlite-bench-config-"));
  const dbPath = join(tempDir, "bench.db");
  const driver = await createDriver(driverName, dbPath, {
    cacheProfile: options.cacheProfile,
  });
  try {
    return { ...driver.benchmarkSettings };
  } finally {
    await driver.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Main benchmark function wrapped in async IIFE for CJS compatibility
(async () => {
  console.log(colors.bold.cyan("🚀 SQLite Driver Performance Benchmark\n"));
  console.log(colors.gray(`Testing drivers: ${driversToTest.join(", ")}`));
  console.log(colors.gray(`Scenarios: ${scenarios.length}\n`));

  // Drivers actually available this run, in the order requested.
  const driverList = driversToTest.filter((d) =>
    getAvailableDrivers().includes(d),
  );
  if (driverList.length === 0) {
    throw new Error("No requested benchmark drivers are available");
  }

  console.log(colors.gray(`Cache profile: ${options.cacheProfile}`));
  const benchmarkSettings: Record<string, BenchmarkSettings> = {};
  for (const driverName of driverList) {
    const settings = await inspectBenchmarkSettings(driverName);
    benchmarkSettings[driverName] = settings;
    console.log(
      colors.gray(
        `  ${driverName}: cache_size=${settings.effectiveCacheSize} ` +
          `(packaged=${settings.initialCacheSize}), ` +
          `journal_mode=${settings.journalMode}, ` +
          `synchronous=${settings.synchronous}`,
      ),
    );
  }
  console.log();

  // Results storage
  const results: Record<string, Record<string, any>> = {};

  // Per-scenario shared iteration counts, computed once (in the warmup pass)
  // and reused for the measured pass.
  const iterCache: Record<string, Record<string, number>> = {};

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
      console.log(colors.gray("Warmup pass...\n"));
    } else {
      console.log(colors.bold.cyan("\nMeasured pass:\n"));
    }

    for (const [scenarioKey, scenario] of scenarios) {
      if (isWarmup) {
        process.stdout.write(colors.gray(`\n  ${scenario.name}:`));
      } else {
        console.log(colors.bold.yellow(`\n📊 ${scenario.name}`));
        console.log(colors.gray(`   ${scenario.description}`));
      }

      if (!isWarmup) {
        results[scenarioKey] = {};
      }

      // Calibrate every driver, then use the largest result as one shared
      // per-trial count. This gives every driver enough timed work while making
      // randomized scenarios consume the identical deterministic PRNG prefix.
      // --iterations overrides calibration entirely for both passes.
      if (!iterCache[scenarioKey]) {
        iterCache[scenarioKey] = {};
        let sharedIterations = options.iterations;
        if (sharedIterations == null) {
          const calibrated: number[] = [];
          for (const driverName of driverList) {
            try {
              calibrated.push(await calibrateIterations(driverName, scenario));
            } catch {
              calibrated.push(100); // fallback
            }
          }
          sharedIterations = Math.max(...calibrated);
        }
        for (const driverName of driverList) {
          iterCache[scenarioKey][driverName] = sharedIterations;
        }
      }
      const iters = iterCache[scenarioKey];

      // Interleave trials round-robin across drivers so slow drift in CPU clock,
      // thermals, or page-cache warmth spreads across every driver as noise the
      // median absorbs, instead of biasing whichever driver happened to run
      // last. Each trial gets a fresh db + setup outside the timed region.
      const trials = isWarmup ? WARMUP_TRIALS : MEASURED_TRIALS;
      const samples: Record<string, number[]> = {};
      for (const d of driverList) samples[d] = [];
      const failed = new Set<string>();

      for (let t = 0; t < trials; t++) {
        // Rotate the per-round slot order so no driver is permanently first-of-N
        // (always running right after the prior round's teardown/GC). That
        // residual position bias survives the round-robin interleave above; a
        // deterministic rotation shares every slot equally and stays reproducible.
        const order = driverList.map(
          (_, i) => driverList[(i + t) % driverList.length],
        );
        for (const driverName of order) {
          if (failed.has(driverName)) continue;
          try {
            samples[driverName].push(
              await runTrial(driverName, scenario, iters[driverName]),
            );
          } catch (err) {
            failed.add(driverName);
            const msg = `✗ Error in ${driverName}: ${(err as Error).message}`;
            if (isWarmup) process.stdout.write(colors.yellow(` [${msg}]`));
            else console.error(colors.red(`   ${msg}`));
          }
        }
      }

      for (const driverName of driverList) {
        const s = samples[driverName];
        if (s.length === 0) continue;
        const opsPerSec = median(s);
        const rme = medianRelativeMarginOfError(s);

        if (isWarmup) {
          process.stdout.write(
            colors.gray(
              ` ${driverName}:${Math.round(opsPerSec).toLocaleString()}`,
            ),
          );
        } else {
          console.log(
            colors.green(
              `   ${driverName}: ${Math.round(opsPerSec).toLocaleString()} ops/sec ±${rme.toFixed(1)}% (${s.length} trials × ${iters[driverName].toLocaleString()} iters)`,
            ),
          );

          // Store results only on measured pass
          results[scenarioKey][driverName] = {
            hz: opsPerSec,
            rme,
            runs: iters[driverName] * s.length,
            mean: 1000 / opsPerSec,
            deviation: 0,
          };
        }
      }
    }

    if (isWarmup) {
      console.log(); // newline after dots
    }
  }

  // Summary
  console.log(colors.bold.cyan("\n\n### 📈 Summary\n"));

  // Keep the configuration directly beside the copyable Markdown table. The
  // startup preamble is useful interactively, but is easy to omit when results
  // are pasted into documentation or an issue.
  const markdownSettings = driverList
    .map((driverName) => {
      const settings = benchmarkSettings[driverName];
      return (
        `\`${driverName}\`: cache_size=${settings.effectiveCacheSize} ` +
        `(packaged=${settings.initialCacheSize}), ` +
        `journal_mode=${settings.journalMode}, ` +
        `synchronous=${settings.synchronous}`
      );
    })
    .join("; ");
  console.log(`Cache profile: \`${options.cacheProfile}\``);
  console.log(`Effective settings: ${markdownSettings}\n`);

  // Generate markdown table
  const availableDrivers = driverList;

  // node:sqlite is this package's drop-in baseline, so each row reports the
  // subject driver's throughput as a ratio of node:sqlite's (below 1.00x =
  // slower). This is per-scenario on purpose — a reader maps it to their own
  // workload rather than trusting a blended cross-scenario score. Only shown
  // when both the subject driver and node:sqlite are in the run.
  const BASELINE = "node:sqlite";
  const PACKAGE_DRIVER = "@photostructure/sqlite";
  const subject = availableDrivers.includes(PACKAGE_DRIVER)
    ? PACKAGE_DRIVER
    : availableDrivers.find((d) => d !== BASELINE);
  const showRatio = subject != null && availableDrivers.includes(BASELINE);
  const ratioHeader = showRatio ? ` | ${subject} vs node:sqlite` : "";

  console.log(
    "| Scenario | " + availableDrivers.join(" | ") + ratioHeader + " |",
  );
  console.log(
    "|" +
      ["---"]
        .concat(availableDrivers.map(() => "---:"))
        .concat(showRatio ? ["---:"] : [])
        .join("|") +
      "|",
  );

  for (const [scenarioKey, scenario] of scenarios) {
    // Tag writes by durability cost: † single-op writes pay a durable commit
    // each time and tie across drivers; ‡ batched writes amortize that commit
    // cost over ~1000 rows, so driver differences remain visible.
    const marker =
      scenario.category === "fsync"
        ? " †"
        : scenario.category === "batch"
          ? " ‡"
          : "";
    const label = `${scenario.name}${marker}`;
    const row = [label];

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

    if (showRatio) {
      const s = results[scenarioKey]?.[subject];
      const b = results[scenarioKey]?.[BASELINE];
      row.push(s && b && b.hz > 0 ? `${(s.hz / b.hz).toFixed(2)}×` : "N/A");
    }

    console.log("| " + row.join(" | ") + " |");
  }

  const hasFsync = scenarios.some(([, s]) => s.category === "fsync");
  const hasBatch = scenarios.some(([, s]) => s.category === "batch");
  if (hasFsync || hasBatch) {
    const notes: string[] = [];
    if (hasFsync)
      notes.push(
        "† single-op write — one durable commit per operation, so cost is " +
          "dominated by storage sync latency (I/O-bound); drivers tie here.",
      );
    if (hasBatch)
      notes.push(
        "‡ batched write — one durable commit amortized over ~1000 rows, so " +
          "driver differences remain visible (don't read these as ties).",
      );
    console.log("\n" + colors.gray(notes.join("\n")));
  }

  // Memory usage report
  if (options.memory && global.gc) {
    global.gc();
    const memoryFinal = process.memoryUsage();

    console.log(colors.bold.cyan("\n\n### 💾 Memory Usage\n"));

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
        colors.gray(
          "📋 Memory table generated above - copy/paste ready for documentation!",
        ),
    );
  }

  // No blended cross-scenario score: per-scenario ops/sec plus the per-row
  // "vs node:sqlite" ratio (above) is what better-sqlite3's and other SQLite
  // driver benchmarks report, and it can't be distorted by which scenarios you
  // choose to average or how the fsync-bound writes tie.

  // Optional SVG charts (headline ratio-vs-node:sqlite + per-scenario ops/sec).
  if (options.charts) {
    const outDir = join(import.meta.dirname, options.charts);
    const scenarioMeta = scenarios.map(
      ([key, s]) =>
        [
          key,
          { name: s.name, description: s.description, category: s.category },
        ] as [string, { name: string; description: string; category: string }],
    );
    const charts = buildBenchmarkCharts(results, scenarioMeta, driverList, {
      cacheProfile: options.cacheProfile,
      driverSettings: benchmarkSettings,
    });
    writeCharts(charts, outDir);
    console.log(
      colors.bold.cyan(`\n\n### 📊 Charts\n`) +
        colors.gray(`Wrote ${charts.size} SVG chart(s) to ${outDir}`),
    );
  }

  console.log("\n✨ Benchmark complete!\n");
})();
