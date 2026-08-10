#!/usr/bin/env tsx

import { createDriver, getAvailableDrivers, type Driver } from "./drivers.js";
import { LEAK_MIN_R2, MemoryTracker } from "./memory-tracker.js";
// import Table from 'cli-table3'; // Removed - using markdown tables instead
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colors } from "./colors.js";

interface MemoryScenario {
  name: string;
  description: string;
  setup?: (driver: Driver) => Promise<void>;
  run: (driver: Driver) => Promise<any>;
  cleanup?: (driver: Driver) => Promise<void>;
}

// Memory leak detection scenarios
const memoryScenarios: Record<string, MemoryScenario> = {
  "prepare-finalize": {
    name: "Statement Prepare/Finalize",
    description: "Tests for memory leaks in statement lifecycle",
    run: async (driver) => {
      const stmt = driver.prepare("SELECT ? + ?");
      const result = stmt.get(1, 2);
      stmt.finalize();
      return result;
    },
  },

  "large-select": {
    name: "Large Result Sets",
    description: "Tests memory handling with large query results",
    setup: async (driver) => {
      driver.exec(`
        CREATE TABLE large_data (
          id INTEGER PRIMARY KEY,
          data TEXT
        )
      `);

      const insert = driver.prepare("INSERT INTO large_data (data) VALUES (?)");
      const largeText = "x".repeat(1000);
      const tx = driver.transaction(() => {
        for (let i = 0; i < 10000; i++) {
          insert.run(largeText);
        }
      });
      tx();
      insert.finalize();
    },
    run: async (driver) => {
      const stmt = driver.prepare("SELECT * FROM large_data");
      const rows = stmt.all();
      stmt.finalize();
      return rows.length;
    },
  },

  "blob-handling": {
    name: "BLOB Memory Management",
    description: "Tests memory handling with binary data",
    run: async (driver) => {
      // Drop table if exists from previous iteration
      driver.exec("DROP TABLE IF EXISTS temp.blobs");
      driver.exec(
        "CREATE TEMP TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)",
      );

      const insert = driver.prepare("INSERT INTO blobs (data) VALUES (?)");
      const select = driver.prepare("SELECT data FROM blobs WHERE id = ?");

      // Create 1MB buffer
      const buffer = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = i % 256;
      }

      const result = insert.run(buffer);
      const retrieved = select.get(result.lastInsertRowid);

      insert.finalize();
      select.finalize();

      // Clean up table
      driver.exec("DROP TABLE temp.blobs");

      return retrieved.data.length;
    },
  },

  "transaction-stress": {
    name: "Transaction Memory",
    description: "Tests memory usage in large transactions",
    run: async (driver) => {
      // Drop table if exists from previous iteration
      driver.exec("DROP TABLE IF EXISTS temp.trans_test");
      driver.exec(
        "CREATE TEMP TABLE trans_test (id INTEGER PRIMARY KEY, value REAL)",
      );

      const insert = driver.prepare(
        "INSERT INTO trans_test (value) VALUES (?)",
      );
      const tx = driver.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          insert.run(Math.random());
        }
      });

      tx();
      insert.finalize();

      // Clean up table
      driver.exec("DROP TABLE temp.trans_test");

      return 1000;
    },
  },

  "prepare-cache": {
    name: "Statement Cache Stress",
    description: "Tests memory with many prepared statements",
    run: async (driver) => {
      const statements = [];

      // Create many different statements
      for (let i = 0; i < 100; i++) {
        const stmt = driver.prepare(`SELECT ${i} + ?`);
        statements.push(stmt);
      }

      // Use them
      let sum = 0;
      for (const stmt of statements) {
        const result = stmt.get(1);
        sum += Object.values(result)[0] as number;
      }

      // Finalize all
      for (const stmt of statements) {
        stmt.finalize();
      }

      return sum;
    },
  },
};

interface Options {
  drivers: string[] | null;
  scenarios: string[] | null;
  iterations: number | null;
  warmup: number;
  calibrationDuration: number;
  leakThreshold: number;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const options: Options = {
    drivers: null,
    scenarios: null,
    iterations: null,
    warmup: 10,
    calibrationDuration: 2000, // 2 seconds for calibration
    leakThreshold: 500, // 500 bytes per iteration threshold
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--drivers" && i + 1 < args.length) {
      options.drivers = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--scenarios" && i + 1 < args.length) {
      options.scenarios = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--iterations" && i + 1 < args.length) {
      options.iterations = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--warmup" && i + 1 < args.length) {
      options.warmup = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--threshold" && i + 1 < args.length) {
      options.leakThreshold = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage: tsx benchmark/memory-benchmark.ts [options]

Options:
  --drivers <list>     Comma-separated list of drivers to test
  --scenarios <list>   Comma-separated list of scenarios to run
  --iterations <n>     Number of iterations for leak detection (default: auto-calibrated)
  --warmup <n>         Number of warmup iterations (default: 10)
  --threshold <bytes>  Memory leak threshold in bytes/iteration (default: 500)
  --help, -h           Show this help

Available drivers: ${getAvailableDrivers().join(", ")}
Available scenarios: ${Object.keys(memoryScenarios).join(", ")}
`);
      process.exit(0);
    }
  }

  // Check if GC is exposed
  if (typeof global.gc !== "function") {
    console.log(
      colors.yellow(
        "⚠️  Warning: GC not exposed. Run with --expose-gc for accurate results.",
      ),
    );
    console.log(
      colors.gray("   tsx --expose-gc benchmark/memory-benchmark.ts\n"),
    );
  }

  const driversToTest = options.drivers ?? getAvailableDrivers();
  const scenariosToRun = options.scenarios ?? Object.keys(memoryScenarios);

  console.log(colors.bold.cyan("💾 SQLite Driver Memory Benchmark\n"));
  console.log(colors.gray(`Testing drivers: ${driversToTest.join(", ")}`));
  console.log(colors.gray(`Scenarios: ${scenariosToRun.length}`));
  console.log(
    colors.gray(
      `Iterations: ${options.iterations ?? "auto-calibrated"} (with ${options.warmup} warmup)\n`,
    ),
  );

  const results: Record<string, Record<string, any>> = {};

  // Test each driver
  for (const driverName of driversToTest) {
    if (!getAvailableDrivers().includes(driverName)) {
      console.log(colors.gray(`Skipping ${driverName} (not available)`));
      continue;
    }

    console.log(colors.bold.yellow(`\n📊 Testing ${driverName}`));
    results[driverName] = {};

    // Run each scenario
    for (const scenarioKey of scenariosToRun) {
      const scenario = memoryScenarios[scenarioKey];
      if (!scenario) {
        console.log(colors.gray(`  Skipping unknown scenario: ${scenarioKey}`));
        continue;
      }

      console.log(colors.gray(`\n  ${scenario.name}: ${scenario.description}`));

      // Create temporary database
      const tempDir = mkdtempSync(join(tmpdir(), "sqlite-mem-"));
      const dbPath = join(tempDir, "test.db");

      try {
        const driver = await createDriver(driverName, dbPath);
        const tracker = new MemoryTracker();

        // Setup if needed
        if (scenario.setup) {
          await scenario.setup(driver);
        }

        // Calibrate iterations if not specified
        let iterations = options.iterations;
        if (!iterations) {
          console.log(colors.gray(`    Calibrating iterations...`));
          const calibrationStart = Date.now();
          let calibrationIterations = 0;

          // Run for calibrationDuration to determine optimal iteration count
          while (Date.now() - calibrationStart < options.calibrationDuration) {
            await scenario.run(driver);
            calibrationIterations++;
          }

          // Use calibrated count, but ensure reasonable bounds
          iterations = Math.max(20, Math.min(200, calibrationIterations));
          console.log(colors.gray(`    Using ${iterations} iterations`));
        }

        // Check for memory leaks with configurable threshold
        const leakTest = await tracker.checkForLeaks(
          async () => {
            await scenario.run(driver);
          },
          iterations,
          options.warmup,
        );

        // Override leak detection with custom threshold. Require the trend to
        // be well-correlated (R² ≥ LEAK_MIN_R2) as well as steep, so a noisy run
        // isn't reported as a leak on slope alone.
        leakTest.likelyLeak =
          (leakTest.heapTrend.slope > options.leakThreshold &&
            leakTest.heapTrend.r2 >= LEAK_MIN_R2) ||
          (leakTest.externalTrend.slope > options.leakThreshold &&
            leakTest.externalTrend.r2 >= LEAK_MIN_R2);

        results[driverName][scenarioKey] = leakTest;

        // Display results
        if (leakTest.likelyLeak) {
          console.log(colors.red(`    ⚠️  Potential memory leak detected!`));
        } else {
          console.log(colors.green(`    ✓ No memory leak detected`));
        }

        console.log(
          colors.gray(
            `    Heap growth: ${leakTest.summary.heapGrowth} (R²=${leakTest.summary.heapR2})`,
          ),
        );
        console.log(
          colors.gray(
            `    External growth: ${leakTest.summary.externalGrowth} (R²=${leakTest.summary.externalR2})`,
          ),
        );
        console.log(
          colors.gray(
            `    Confidence: ${leakTest.heapTrend.r2 > 0.9 ? "High" : leakTest.heapTrend.r2 > 0.7 ? "Medium" : "Low"} (based on R² values)`,
          ),
        );

        // Cleanup scenario if needed
        if (scenario.cleanup) {
          await scenario.cleanup(driver);
        }

        await driver.close();
      } catch (error) {
        console.error(colors.red(`    ✗ Error: ${(error as Error).message}`));
        results[driverName][scenarioKey] = { error: (error as Error).message };
      } finally {
        // Clean up
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  // Summary table
  console.log(colors.bold.cyan("\n\n📈 Summary\n"));

  // Generate markdown table
  const availableDrivers = driversToTest.filter((d) =>
    getAvailableDrivers().includes(d),
  );
  console.log("| Scenario | " + availableDrivers.join(" | ") + " |");
  console.log(
    "|" + ["---"].concat(availableDrivers.map(() => "---")).join("|") + "|",
  );

  for (const scenarioKey of scenariosToRun) {
    const scenario = memoryScenarios[scenarioKey];
    if (!scenario) continue;

    const row = [scenario.name];

    for (const driver of availableDrivers) {
      const result = results[driver]?.[scenarioKey];
      if (!result) {
        row.push("N/A");
      } else if (result.error) {
        row.push("Error");
      } else if (result.likelyLeak) {
        row.push(`Leak (${result.summary.heapGrowth})`);
      } else {
        row.push("✓ OK");
      }
    }

    console.log("| " + row.join(" | ") + " |");
  }

  console.log(
    "\n" +
      colors.gray(
        "📋 Memory table generated above - copy/paste ready for documentation!",
      ),
  );

  // Detailed leak report
  const leaks = [];
  for (const [driver, scenarios] of Object.entries(results)) {
    for (const [scenario, result] of Object.entries(scenarios)) {
      if (result.likelyLeak) {
        leaks.push({ driver, scenario, result });
      }
    }
  }

  if (leaks.length > 0) {
    console.log(colors.bold.red("\n\n⚠️  Memory Leak Details\n"));

    for (const { driver, scenario, result } of leaks) {
      console.log(
        colors.yellow(`${driver} - ${memoryScenarios[scenario].name}:`),
      );
      console.log(
        `  Heap growth: ${result.summary.heapGrowth} (R²=${result.summary.heapR2})`,
      );
      console.log(
        `  External growth: ${result.summary.externalGrowth} (R²=${result.summary.externalR2})`,
      );
      console.log("");
    }
  }

  console.log("\n✨ Memory benchmark complete!\n");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
