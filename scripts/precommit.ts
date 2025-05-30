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
run("npm run sync:node", "Fetching upstream from Node.js");
run("npm run sync:sqlite", "Fetching upstream from SQLite.org");
run("npm run fmt", "Formatting code");
run("npm run lint", "Running ESLint");
run("npm run security", "Running security checks");
run("npm run build", "Building project");
run("npm test", "Running tests");

// Platform-specific checks
if (isLinux || isMacOS) {
  run("npm run clang-tidy", "Running clang-tidy");
}

if (isLinux) {
  console.log("\n▶ Running memory tests (Linux only)");

  // Run quick memory tests for precommit
  run("npm run test:memory", "JavaScript memory tests");

  // Optional: Run valgrind if you want (might be slow)
  // run("bash scripts/valgrind.sh", "Valgrind memory tests");

  console.log("✓ Memory tests passed");
} else {
  console.log("\n⚠ Skipping memory tests (Linux only)");
}

console.log("\n✅ All precommit checks passed!");
