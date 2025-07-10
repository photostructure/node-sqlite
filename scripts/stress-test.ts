#!/usr/bin/env tsx

/**
 * Comprehensive stress test for @photostructure/sqlite
 * Generates large datasets (100MB+) and tests performance against other SQLite libraries
 */

import chalk from "chalk";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDriver, getAvailableDrivers } from "../benchmark/drivers.js";
import {
  createStressSchema,
  generateLargeDataset,
  getStressScenarios,
} from "../benchmark/stress-scenarios.js";

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  sizeMB: 100,
  drivers: null as string[] | null,
  scenarios: null as string[] | null,
  output: "table" as "table" | "json",
  verbose: false,
  skipGeneration: false,
  dbPath: null as string | null,
  ci: false,
  outputFile: null as string | null,
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--size" && i + 1 < args.length) {
    options.sizeMB = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === "--drivers" && i + 1 < args.length) {
    options.drivers = args[i + 1].split(",");
    i++;
  } else if (args[i] === "--scenarios" && i + 1 < args.length) {
    options.scenarios = args[i + 1].split(",");
    i++;
  } else if (args[i] === "--output" && i + 1 < args.length) {
    options.output = args[i + 1] as "table" | "json";
    i++;
  } else if (args[i] === "--verbose") {
    options.verbose = true;
  } else if (args[i] === "--skip-generation") {
    options.skipGeneration = true;
  } else if (args[i] === "--db-path" && i + 1 < args.length) {
    options.dbPath = args[i + 1];
    i++;
  } else if (args[i] === "--ci") {
    options.ci = true;
    // CI mode defaults: smaller dataset, JSON output, specific drivers
    options.sizeMB = options.sizeMB === 100 ? 10 : options.sizeMB;
    options.output = "json";
    options.drivers = options.drivers ?? [
      "@photostructure/sqlite",
      "better-sqlite3",
    ];
  } else if (args[i] === "--output-file" && i + 1 < args.length) {
    options.outputFile = args[i + 1];
    i++;
  }
}

// Show usage
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
${chalk.bold.cyan("📊 SQLite Stress Test Tool")}

Usage: tsx scripts/stress-test.ts [options]

Options:
  --size <MB>          Target database size in MB (default: 100)
  --drivers <list>     Comma-separated list of drivers to test
                       Available: ${getAvailableDrivers().join(", ")}
  --scenarios <list>   Comma-separated list of scenarios to run
                       Available: ${getStressScenarios()
                         .map(([key]) => key)
                         .join(", ")}
  --output <format>    Output format: table or json (default: table)
  --verbose            Show detailed output during testing
  --skip-generation    Skip data generation (use existing database)
  --db-path <path>     Use specific database file path
  --ci                 CI mode: 10MB dataset, JSON output, limited drivers
  --output-file <path> Write results to file (JSON format)
  --help, -h           Show this help

Examples:
  tsx scripts/stress-test.ts --size 100
  tsx scripts/stress-test.ts --drivers @photostructure/sqlite,better-sqlite3
  tsx scripts/stress-test.ts --scenarios stress-fts-search,stress-complex-joins
  tsx scripts/stress-test.ts --size 50 --output json --verbose
  tsx scripts/stress-test.ts --skip-generation --db-path ./large-test.db
`);
  process.exit(0);
}

// Utility functions
function formatBytes(bytes: number): string {
  const sizes = ["B", "KB", "MB", "GB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + sizes[i];
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function getDatabaseSize(dbPath: string): number {
  try {
    return statSync(dbPath).size;
  } catch {
    return 0;
  }
}

function log(message: string, verbose: boolean = false): void {
  if (!verbose || options.verbose) {
    console.log(message);
  }
}

// Results storage
interface TestResult {
  driver: string;
  scenario: string;
  avgOpsPerSec: number;
  totalTime: number;
  iterations: number;
  error?: string;
}

async function runStressTest(): Promise<void> {
  console.log(chalk.bold.cyan("🚀 SQLite Stress Test Suite"));
  console.log(chalk.gray(`Target size: ${options.sizeMB}MB`));

  // Get drivers and scenarios to test
  const driversToTest = options.drivers ?? getAvailableDrivers();
  const availableScenarios = getStressScenarios();
  const scenariosToTest = options.scenarios
    ? availableScenarios.filter(([key]) => options.scenarios!.includes(key))
    : availableScenarios;

  log(`Drivers: ${driversToTest.join(", ")}`);
  log(`Scenarios: ${scenariosToTest.length}`);
  log("");

  // Database setup
  const tempDir = mkdtempSync(join(tmpdir(), "sqlite-stress-"));
  const dbPath = options.dbPath ?? join(tempDir, "stress-test.db");

  try {
    // Generate test data if needed
    if (!options.skipGeneration || !existsSync(dbPath)) {
      console.log(chalk.yellow("📝 Generating test dataset..."));

      // Use the first available driver to generate data
      const setupDriver = driversToTest.find((d) =>
        getAvailableDrivers().includes(d),
      );
      if (!setupDriver) {
        throw new Error("No available drivers found for data generation");
      }

      const setupDb = await createDriver(setupDriver, dbPath);

      // Create schema
      log("Creating database schema...", true);
      createStressSchema(setupDb);

      // Generate data
      log(`Generating ${options.sizeMB}MB of test data...`, true);
      const startTime = Date.now();
      generateLargeDataset(setupDb, options.sizeMB);
      const generationTime = Date.now() - startTime;

      // Analyze final database
      const finalSize = getDatabaseSize(dbPath);
      log(`Database generated in ${(generationTime / 1000).toFixed(1)}s`);
      log(`Final size: ${formatBytes(finalSize)}`);

      // Get record counts
      const stats = setupDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts'",
        )
        .all();
      log("\nTable statistics:");
      for (const table of stats) {
        const count = setupDb
          .prepare(`SELECT COUNT(*) as count FROM ${table.name}`)
          .get() as { count: number };
        log(`  ${table.name}: ${formatNumber(count.count)} records`);
      }

      await setupDb.close();
      // Add a small delay to ensure the database file is fully released
      await new Promise((resolve) => setTimeout(resolve, 100));
      log("");
    } else {
      const size = getDatabaseSize(dbPath);
      log(`Using existing database: ${formatBytes(size)}`);
      log("");
    }

    // Run performance tests
    const results: TestResult[] = [];

    for (const driverName of driversToTest) {
      if (!getAvailableDrivers().includes(driverName)) {
        log(chalk.yellow(`⚠️  Driver ${driverName} not available, skipping`));
        continue;
      }

      console.log(chalk.bold.blue(`\n📊 Testing ${driverName}`));

      for (const [scenarioKey, scenario] of scenariosToTest) {
        log(chalk.yellow(`  Running ${scenario.name}...`));

        try {
          // Create fresh connection for each test
          const driver = await createDriver(driverName, dbPath);
          const context = scenario.setup(driver);

          // Warm up with a few iterations
          for (let i = 0; i < Math.min(5, scenario.iterations); i++) {
            scenario.run(context, i);
          }

          // Measure performance
          const iterations = scenario.iterations;
          const startTime = process.hrtime.bigint();

          for (let i = 0; i < iterations; i++) {
            scenario.run(context, i);
          }

          const endTime = process.hrtime.bigint();
          const totalTimeMs = Number(endTime - startTime) / 1_000_000;
          const avgOpsPerSec = (iterations / totalTimeMs) * 1000;

          // Cleanup
          if (scenario.cleanup) {
            scenario.cleanup(context);
          } else {
            context.cleanup();
          }
          await driver.close();

          results.push({
            driver: driverName,
            scenario: scenarioKey,
            avgOpsPerSec,
            totalTime: totalTimeMs,
            iterations,
          });

          log(
            chalk.green(
              `    ✓ ${Math.round(avgOpsPerSec).toLocaleString()} ops/sec`,
            ),
          );
        } catch (error) {
          log(chalk.red(`    ✗ Error: ${(error as Error).message}`));
          results.push({
            driver: driverName,
            scenario: scenarioKey,
            avgOpsPerSec: 0,
            totalTime: 0,
            iterations: 0,
            error: (error as Error).message,
          });
        }
      }
    }

    // Output results
    console.log(chalk.bold.cyan("\n\n📈 Stress Test Results"));
    console.log(
      chalk.gray(`Database size: ${formatBytes(getDatabaseSize(dbPath))}`),
    );
    console.log("");

    if (options.output === "json") {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Create performance comparison table
      const scenarios = [...new Set(results.map((r) => r.scenario))];
      const drivers = [...new Set(results.map((r) => r.driver))];

      console.log("| Scenario | " + drivers.join(" | ") + " |");
      console.log(
        "|" + ["---"].concat(drivers.map(() => "---:")).join("|") + "|",
      );

      for (const scenarioKey of scenarios) {
        const scenarioName =
          scenariosToTest.find(([key]) => key === scenarioKey)?.[1]?.name ??
          scenarioKey;
        const row = [scenarioName];

        for (const driver of drivers) {
          const result = results.find(
            (r) => r.driver === driver && r.scenario === scenarioKey,
          );
          if (result) {
            if (result.error) {
              row.push("❌ Error");
            } else {
              row.push(
                `${Math.round(result.avgOpsPerSec).toLocaleString()} ops/s`,
              );
            }
          } else {
            row.push("N/A");
          }
        }

        console.log("| " + row.join(" | ") + " |");
      }

      // Performance ranking
      console.log(chalk.bold.cyan("\n🏆 Overall Performance Ranking"));
      console.log("");

      const overallScores: Record<string, number> = {};
      for (const driver of drivers) {
        const driverResults = results.filter(
          (r) => r.driver === driver && !r.error,
        );
        if (driverResults.length === 0) continue;

        let totalScore = 0;
        let scenarioCount = 0;

        for (const scenarioKey of scenarios) {
          const result = driverResults.find((r) => r.scenario === scenarioKey);
          if (!result) continue;

          // Find the fastest for this scenario
          const scenarioResults = results.filter(
            (r) => r.scenario === scenarioKey && !r.error,
          );
          const maxOps = Math.max(
            ...scenarioResults.map((r) => r.avgOpsPerSec),
          );

          if (maxOps > 0) {
            totalScore += (result.avgOpsPerSec / maxOps) * 100;
            scenarioCount++;
          }
        }

        if (scenarioCount > 0) {
          overallScores[driver] = Math.round(totalScore / scenarioCount);
        }
      }

      const rankedDrivers = Object.entries(overallScores).sort(
        ([, a], [, b]) => b - a,
      );

      console.log("| Rank | Driver | Score |");
      console.log("|---:|---|---:|");

      const medals = ["🥇", "🥈", "🥉", "🏅"];
      rankedDrivers.forEach(([driver, score], index) => {
        const medal = medals[index] ?? "📊";
        const rank = `${index + 1} ${medal}`;
        console.log(`| ${rank} | ${driver} | ${score}% |`);
      });

      // Memory usage summary
      console.log(chalk.bold.cyan("\n💾 Resource Usage"));
      console.log("");

      const dbSize = getDatabaseSize(dbPath);
      console.log(`Database Size: ${formatBytes(dbSize)}`);
      console.log(
        `Total Records: ${formatNumber(results.reduce((sum, r) => sum + r.iterations, 0))}`,
      );

      // Show some interesting stats
      const fastestResult = results
        .filter((r) => !r.error)
        .sort((a, b) => b.avgOpsPerSec - a.avgOpsPerSec)[0];
      if (fastestResult) {
        console.log(
          `Fastest Operation: ${Math.round(fastestResult.avgOpsPerSec).toLocaleString()} ops/sec (${fastestResult.driver})`,
        );
      }
    }

    // Write results to file if requested
    if (options.outputFile) {
      const outputData = {
        metadata: {
          timestamp: new Date().toISOString(),
          databaseSize: getDatabaseSize(dbPath),
          targetSizeMB: options.sizeMB,
          drivers: driversToTest,
          scenarios: scenariosToTest.map(([key, s]) => ({ key, name: s.name })),
          platform: process.platform,
          nodeVersion: process.version,
          ci: options.ci,
        },
        results,
        summary: {
          totalTests: results.length,
          successfulTests: results.filter((r) => !r.error).length,
          failedTests: results.filter((r) => r.error).length,
          overallScores: Object.fromEntries(
            Object.entries(overallScores ?? {}).map(([driver, score]) => [
              driver,
              score,
            ]),
          ),
        },
      };

      writeFileSync(options.outputFile, JSON.stringify(outputData, null, 2));
      log(`Results written to ${options.outputFile}`);
    }

    // Also write markdown summary if in CI mode
    if (options.ci) {
      const markdownPath =
        options.outputFile?.replace(".json", ".md") ?? "stress-test-results.md";
      let markdown = `# Stress Test Results\n\n`;
      markdown += `**Date:** ${new Date().toISOString()}\n`;
      markdown += `**Database Size:** ${formatBytes(getDatabaseSize(dbPath))}\n`;
      markdown += `**Platform:** ${process.platform}\n`;
      markdown += `**Node Version:** ${process.version}\n\n`;

      markdown += `## Performance Results\n\n`;
      markdown += `| Scenario | ${drivers.join(" | ")} |\n`;
      markdown += `|${["---"].concat(drivers.map(() => "---:")).join("|")}|\n`;

      for (const scenarioKey of scenarios) {
        const scenarioName =
          scenariosToTest.find(([key]) => key === scenarioKey)?.[1]?.name ??
          scenarioKey;
        const row = [scenarioName];

        for (const driver of drivers) {
          const result = results.find(
            (r) => r.driver === driver && r.scenario === scenarioKey,
          );
          if (result) {
            if (result.error) {
              row.push("❌ Error");
            } else {
              row.push(
                `${Math.round(result.avgOpsPerSec).toLocaleString()} ops/s`,
              );
            }
          } else {
            row.push("N/A");
          }
        }

        markdown += `| ${row.join(" | ")} |\n`;
      }

      if (overallScores && Object.keys(overallScores).length > 0) {
        markdown += `\n## Overall Performance Ranking\n\n`;
        markdown += `| Rank | Driver | Score |\n`;
        markdown += `|---:|---|---:|\n`;

        const medals = ["🥇", "🥈", "🥉", "🏅"];
        rankedDrivers.forEach(([driver, score], index) => {
          const medal = medals[index] ?? "📊";
          markdown += `| ${index + 1} ${medal} | ${driver} | ${score}% |\n`;
        });
      }

      writeFileSync(markdownPath, markdown);
      log(`Markdown summary written to ${markdownPath}`);
    }
  } finally {
    // Cleanup temp directory if we created it
    if (!options.dbPath) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Main execution
const __filename = fileURLToPath(import.meta.url);
if (import.meta.url === `file://${process.argv[1]}`) {
  runStressTest().catch((error) => {
    console.error(chalk.red("\n❌ Stress test failed:"), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

export { runStressTest };
