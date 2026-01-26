#!/usr/bin/env npx --yes tsx

/**
 * Cross-platform memory checking script for @photostructure/sqlite
 * Runs JavaScript memory tests on all platforms
 * Runs valgrind and ASAN tests only on Linux
 */

import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getTimingMultiplier } from "../test/test-timeout-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
} as const;

// Use colors only if not on Windows
const isWindows = os.platform() === "win32";
const color = (colorCode: string, text: string): string =>
  isWindows ? text : `${colorCode}${text}${colors.RESET}`;

console.log(color(colors.BLUE, "=== SQLite Memory Leak Detection Suite ==="));

// Remove Electron environment variables that VSCode sets.
// These cause node-gyp-build to incorrectly detect runtime as "electron"
// instead of "node", which breaks native module loading.
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;
delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;

let exitCode = 0;

// Ensure native module is built (may have been cleaned by previous ASAN run)
console.log(color(colors.YELLOW, "\nEnsuring native module is built..."));
try {
  execFileSync("npm", ["run", "build:native"], {
    stdio: "inherit",
    env: cleanEnv,
    shell: true, // Required on Windows where npm is npm.cmd
  });
  console.log(color(colors.GREEN, "✓ Native module ready"));
} catch (error) {
  console.log(color(colors.RED, "✗ Failed to build native module"));
  console.error("Error:", (error as Error).message);
  process.exit(1);
}

// 1. Run JavaScript memory tests (all platforms)
console.log(color(colors.YELLOW, "\nRunning JavaScript memory tests..."));
try {
  // Use node to execute jest.js for cross-platform compatibility
  const jestPath = path.join("node_modules", "jest", "bin", "jest.js");
  const nodeExe = process.execPath;
  const args = [
    jestPath,
    "--no-coverage",
    "--runInBand",
    // --forceExit is required due to a Jest issue with native modules
    // where the process doesn't exit cleanly even though all tests complete.
    // This is a known limitation of Jest's handling of native addons.
    // The tests themselves complete successfully and properly clean up resources.
    "--forceExit",
    "test/memory.test.ts",
  ];

  // Debug output
  console.log("Debug: Node executable:", nodeExe);
  console.log("Debug: Jest path:", jestPath);
  console.log("Debug: Full command:", nodeExe, args.join(" "));
  console.log("Debug: Current directory:", process.cwd());
  console.log("Debug: Platform:", os.platform());
  console.log("Debug: Node version:", process.version);

  // Calculate platform-aware timeout
  const baseTimeout = 300000; // 5 minutes base
  const multiplier = getTimingMultiplier();
  const timeout = baseTimeout * multiplier;

  console.log(
    `Debug: Using timeout: ${timeout}ms (${baseTimeout}ms base × ${multiplier} multiplier)`,
  );

  execFileSync(nodeExe, args, {
    stdio: "inherit",
    env: {
      ...cleanEnv,
      TEST_MEMORY: "1",
      // Run memory tests in CJS mode to avoid Jest ESM hanging issue
      // TEST_ESM: "1",
      NODE_OPTIONS:
        (process.env.NODE_OPTIONS ?? "") + " --expose-gc --no-warnings",
      // Force Jest to exit after test completion
      FORCE_EXIT: "1",
    },
    // Platform-aware timeout to prevent hanging
    timeout,
  });
  console.log(color(colors.GREEN, "✓ JavaScript memory tests passed"));
} catch (error) {
  console.log(color(colors.RED, "✗ JavaScript memory tests failed"));
  console.error("Debug: Error details:", (error as Error).message);
  if ((error as any).code) {
    console.error("Debug: Error code:", (error as any).code);
  }
  if ((error as any).signal) {
    console.error("Debug: Error signal:", (error as any).signal);
  }
  exitCode = 1;
}

// 2. Run valgrind if available and on Linux
if (os.platform() === "linux") {
  try {
    execFileSync("which", ["valgrind"], { stdio: "ignore" });
    console.log(color(colors.YELLOW, "\nRunning valgrind memory analysis..."));

    // Run debug script first in CI to gather more information
    if (process.env.GITHUB_ACTIONS) {
      console.log("Running debug memory leak script...");
      try {
        const debugScript = path.join(__dirname, "debug-memory-leak.sh");
        execFileSync("/bin/bash", [debugScript], {
          stdio: "inherit",
          env: cleanEnv,
        });
      } catch {
        // Don't fail on debug script errors
        console.log("Debug script failed (continuing anyway)");
      }
    }

    try {
      const valgrindScript = path.join(__dirname, "valgrind-test.sh");
      execFileSync("/bin/bash", [valgrindScript], {
        stdio: "inherit",
        env: cleanEnv,
      });
      console.log(color(colors.GREEN, "✓ Valgrind tests passed"));
    } catch {
      console.log(color(colors.RED, "✗ Valgrind tests failed"));
      exitCode = 1;
    }
  } catch {
    console.log(color(colors.YELLOW, "\nValgrind not available. Skipping."));
  }
}

// 3. Run Address Sanitizer and Leak Sanitizer if requested (Linux only)
if (os.platform() === "linux") {
  console.log(
    color(
      colors.YELLOW,
      "\nRunning AddressSanitizer and LeakSanitizer tests...",
    ),
  );
  try {
    const asanScript = path.join(__dirname, "sanitizers-test.sh");
    execFileSync("/bin/bash", [asanScript], {
      stdio: "inherit",
      env: cleanEnv,
    });
    console.log(
      color(colors.GREEN, "✓ AddressSanitizer and LeakSanitizer tests passed"),
    );
  } catch {
    console.log(
      color(colors.RED, "✗ AddressSanitizer or LeakSanitizer tests failed"),
    );
    exitCode = 1;
  }

  // Rebuild native module after ASAN tests to restore a usable build
  console.log(
    color(colors.YELLOW, "\nRebuilding native module (post-ASAN cleanup)..."),
  );
  try {
    execFileSync("npm", ["run", "build:native"], {
      stdio: "inherit",
      env: cleanEnv,
      shell: true, // Required on Windows where npm is npm.cmd
    });
    console.log(color(colors.GREEN, "✓ Native module restored"));
  } catch (rebuildError) {
    console.log(color(colors.RED, "✗ Failed to restore native module"));
    console.error("Error:", (rebuildError as Error).message);
    // Don't fail the overall check, just warn
  }
}

if (exitCode === 0) {
  console.log(
    color(colors.GREEN, "\n=== All memory tests completed successfully! ==="),
  );
} else {
  console.log(
    color(colors.RED, "\n=== Memory tests failed! See output above. ==="),
  );
}

process.exit(exitCode);
