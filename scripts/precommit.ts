import { execSync } from "node:child_process";
import { platform } from "node:os";

const isLinux = platform() === "linux";
const isMacOS = platform() === "darwin";

function run(command: string, description: string) {
  console.log(`\n▶ ${description || command}`);
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    console.error(`✗ Failed: ${description || command}`);
    process.exit(1);
  }
}

// Always run these
run("npm run install", "Installing dependencies");
run("npm run clean", "Start fresh");
run("npm run sync:node", "Fetching upstream from Node.js");
run("npm run sync:sqlite", "Fetching upstream from SQLite.org");
run("npm run fmt", "Formatting code");
run("npm run lint", "Running TypeScript, eslint, and clang-tidy");
run("npm run security", "Running security checks");
run("npm run build:dist", "Building project");
run(
  "npm run build:" + (isLinux ? "linux-glibc" : "native"),
  "Building native project for " +
    (isLinux ? "Linux with portable GLIBC" : platform()),
);
run("npm run tests", "Running tests in CJS and ESM mode");

// Check Node.js version for API compatibility tests
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split(".")[0].substring(1), 10);
if (majorVersion >= 22) {
  run(
    "npm run lint:api-compat",
    "Check API compatibility types (TypeScript compile-time validation)",
  );
  run(
    "npm run test:api-compat",
    "Run API type compatibility tests (ensures our TypeScript types match node:sqlite)",
  );
  run(
    "npm run test:node-compat",
    "Run behavioral compatibility tests (validates runtime behavior matches node:sqlite)",
  );
} else {
  console.log("\n⚠ Skipping API compatibility checks (requires Node.js 22+)");
}

// Platform-specific checks
if (isLinux || isMacOS) {
  run("npm run lint:native", "Running clang-tidy");
}

// Run comprehensive memory tests (cross-platform)
run("npm run check:memory", "Comprehensive memory tests");

console.log("\n✅ All precommit checks passed!");
