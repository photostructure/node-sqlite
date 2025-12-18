import { execFileSync } from "node:child_process";
import { platform } from "node:os";

const isWin = platform() === "win32";
const isLinux = platform() === "linux";
const isMacOS = platform() === "darwin";

function run({
  cmd,
  desc,
  optional,
}: {
  cmd: string;
  desc: string;
  /** If true, failure is non-fatal and just logs a warning */
  optional?: boolean;
}) {
  console.log(`\n▶ ${desc || cmd}${optional ? " (optional)" : ""}`);
  try {
    // Use npm to run the commands for better cross-platform compatibility
    const [arg0, ...args] = cmd.split(" ");
    execFileSync(arg0, args, { stdio: "inherit", shell: true });
  } catch (error) {
    if (optional) {
      console.log(`⚠ Skipped (command not available)`);
    } else {
      console.error(`✗ Failed`, { description: desc, command: cmd, error });
      process.exit(1);
    }
  }
}

// Always run these
run({ cmd: "npm install", desc: "Installing dependencies" });
run({
  cmd: "npm run update:actions",
  desc: "Updating GitHub Actions",
  optional: isWin || isMacOS,
});
run({
  cmd: "npm-check-updates --upgrade --errorLevel 2 || npx snyk test --dev",
  desc: "Updating dependencies (security check if updates found)",
});
run({
  cmd: "npm install --ignore-scripts=false",
  desc: "Installing dependencies",
});
run({ cmd: "npm run clean", desc: "Start fresh" });
run({
  cmd: "npm run sync:node",
  desc: "Fetching upstream from Node.js",
});
run({
  cmd: "npm run sync:tests",
  desc: "Fetching upstream tests from Node.js",
});
run({
  cmd: "npm run sync:sqlite",
  desc: "Fetching upstream from SQLite.org",
});
run({ cmd: "npm run fmt", desc: "Formatting code" });
run({ cmd: "npm run docs", desc: "Generating documentation" });
run({
  cmd: "npm run lint",
  desc: "Running TypeScript, eslint, and clang-tidy",
});
run({ cmd: "npm run security", desc: "Running security checks" });
run({ cmd: "npm run build:dist", desc: "Building project" });
run({
  cmd: "npm run build:" + (isLinux ? "native:linux" : "native"),
  desc:
    "Building native project for " +
    (isLinux ? "Linux with portable GLIBC" : platform()),
});
run({
  cmd: "npm run test:all",
  desc: "Running tests in CJS and ESM mode",
});

// Check Node.js version for API compatibility tests
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split(".")[0].substring(1), 10);
if (majorVersion >= 22) {
  run({
    cmd: "npm run lint:api",
    desc: "Check API compatibility types (TypeScript compile-time validation)",
  });
  run({
    cmd: "npm run test:api",
    desc: "Run API type compatibility tests (ensures our TypeScript types match node:sqlite)",
  });
  run({
    cmd: "npm run test:node",
    desc: "Run behavioral compatibility tests (validates runtime behavior matches node:sqlite)",
  });
} else {
  console.log("\n⚠ Skipping API compatibility checks (requires Node.js 22+)");
}

// Platform-specific checks
if (isLinux || isMacOS) {
  run({ cmd: "npm run lint:native", desc: "Running clang-tidy" });
}

// Run comprehensive memory tests (cross-platform)
run({
  cmd: "npm run memory:check",
  desc: "Comprehensive memory tests",
});

console.log("\n✅ All precommit checks passed!");
