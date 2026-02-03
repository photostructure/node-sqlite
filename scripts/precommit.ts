import { execFileSync, spawnSync } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline";

const isWin = platform() === "win32";
const isLinux = platform() === "linux";
const isMacOS = platform() === "darwin";

/**
 * Check for files owned by root (common issue after running Docker or sudo commands).
 * On non-Windows platforms, prompts user to fix with sudo chown if found.
 */
async function checkRootOwnedFiles(): Promise<void> {
  if (isWin) return; // Windows doesn't have Unix ownership model

  console.log("\n▶ Checking for root-owned files");

  try {
    // Find files/directories owned by root, excluding .git
    // Include node_modules and build/ since Docker commonly creates root-owned artifacts
    const result = spawnSync(
      "find",
      [".", "-user", "root", "-not", "-path", "./.git/*"],
      { encoding: "utf8", timeout: 30000 },
    );

    const rootFiles = result.stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (rootFiles.length === 0) {
      console.log("✓ No root-owned files found");
      return;
    }

    console.log(`\n⚠ Found ${rootFiles.length} item(s) owned by root:`);
    // Show first 10 files, indicate if there are more
    const displayFiles = rootFiles.slice(0, 10);
    for (const file of displayFiles) {
      console.log(`  ${file}`);
    }
    if (rootFiles.length > 10) {
      console.log(`  ... and ${rootFiles.length - 10} more`);
    }

    const currentUser = process.env.USER ?? process.env.USERNAME ?? "$(whoami)";
    const fixCommand = `sudo chown -R ${currentUser}:${currentUser} .`;

    console.log(`\nThis can cause permission errors during build/install.`);
    console.log(`To fix, run: ${fixCommand}\n`);

    const answer = await askUser(
      "Would you like to fix this now? (requires sudo password) [y/N]: ",
    );

    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      console.log(`\nPlease run the following command:`);
      console.log(`  ${fixCommand}`);
      console.log(`\nThen re-run the precommit script.`);
      process.exit(1);
    } else {
      console.log("Continuing with root-owned files (may cause errors)...");
    }
  } catch {
    // If find command fails (e.g., not available), just continue
    console.log("⚠ Could not check for root-owned files, continuing...");
  }
}

/**
 * Prompt the user for input and return their response.
 */
function askUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

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

// Main execution wrapped in async IIFE (top-level await not supported by tsx/esbuild CJS)
(async () => {
  // Check for root-owned files first (common Docker/sudo issue)
  await checkRootOwnedFiles();

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
  run({
    cmd: "npm audit fix || true",
    desc: "Fixing vulnerabilities",
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
})();
