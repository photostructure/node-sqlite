import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Terminal color codes (disable on Windows)
const isWindows = platform() === "win32";
const colors = {
  reset: isWindows ? "" : "\x1b[0m",
  green: isWindows ? "" : "\x1b[32m",
  red: isWindows ? "" : "\x1b[31m",
  yellow: isWindows ? "" : "\x1b[33m",
  blue: isWindows ? "" : "\x1b[34m",
  dim: isWindows ? "" : "\x1b[2m",
};

function log(message: string, color: string = "") {
  console.log(`${color}${message}${colors.reset}`);
}

function execCommand(command: string, options: any = {}) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: "pipe",
      cwd: projectRoot,
      ...options,
    });
  } catch (error: any) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

function findClangTidy() {
  // Try to find clang-tidy
  const possibleNames = [
    "clang-tidy",
    "clang-tidy-18",
    "clang-tidy-17",
    "clang-tidy-16",
    "clang-tidy-15",
  ];

  for (const name of possibleNames) {
    try {
      const version = execCommand(`${name} --version`);
      if (version.includes("LLVM") || version.includes("clang-tidy")) {
        log(`Found ${name}: ${version.split("\n")[0]}`, colors.dim);
        return name;
      }
    } catch (e) {
      // Continue to next
    }
  }

  return null;
}

function getCompileCommands() {
  // Generate compile_commands.json if it doesn't exist
  const compileCommandsPath = join(
    projectRoot,
    "build",
    "compile_commands.json",
  );

  if (!existsSync(compileCommandsPath)) {
    log("Generating compile_commands.json...", colors.dim);

    // Use node-gyp to generate with compile_commands.json
    execCommand(
      "node-gyp configure -- -f gyp.generator.compile_commands_json.py",
    );
  }

  return compileCommandsPath;
}

function getCppFiles() {
  // Get list of C++ files to check
  const files: string[] = [];

  // Add main source files
  files.push(
    join(projectRoot, "src", "binding.cpp"),
    join(projectRoot, "src", "sqlite_impl.cpp"),
    join(projectRoot, "src", "user_function.cpp"),
    join(projectRoot, "src", "aggregate_function.cpp"),
  );

  // Filter out non-existent files
  return files.filter(existsSync);
}

async function runClangTidy(clangTidy: string, files: string[]) {
  const compileCommandsPath = getCompileCommands();

  log("\n=== Running clang-tidy ===", colors.blue);
  log(`Checking ${files.length} files...`, colors.dim);

  let hasErrors = false;
  let errorCount = 0;
  let warningCount = 0;

  for (const file of files) {
    const relPath = relative(projectRoot, file);
    log(`\nChecking: ${relPath}`, colors.dim);

    try {
      // Run clang-tidy on the file
      const output = execCommand(
        `${clangTidy} -p="${compileCommandsPath}" "${file}" 2>&1`,
        { stdio: "pipe" },
      );

      // Parse output for errors and warnings
      const lines = output.split("\n");
      let fileHasIssues = false;

      for (const line of lines) {
        if (line.includes(" warning:")) {
          warningCount++;
          fileHasIssues = true;
          console.log(`  ${colors.yellow}⚠${colors.reset} ${line.trim()}`);
        } else if (line.includes(" error:")) {
          errorCount++;
          hasErrors = true;
          fileHasIssues = true;
          console.log(`  ${colors.red}✗${colors.reset} ${line.trim()}`);
        }
      }

      if (!fileHasIssues) {
        log(`  ${colors.green}✓${colors.reset} No issues found`, colors.green);
      }
    } catch (error: any) {
      // clang-tidy returns non-zero exit code if there are errors
      const output = error.stdout || error.stderr || error.message;
      const lines = output.split("\n");

      for (const line of lines) {
        if (line.includes(" warning:")) {
          warningCount++;
          console.log(`  ${colors.yellow}⚠${colors.reset} ${line.trim()}`);
        } else if (line.includes(" error:")) {
          errorCount++;
          hasErrors = true;
          console.log(`  ${colors.red}✗${colors.reset} ${line.trim()}`);
        }
      }
    }
  }

  // Summary
  log("\n=== Summary ===", colors.blue);
  if (errorCount > 0) {
    log(`✗ ${errorCount} errors found`, colors.red);
  }
  if (warningCount > 0) {
    log(`⚠ ${warningCount} warnings found`, colors.yellow);
  }
  if (errorCount === 0 && warningCount === 0) {
    log("✓ No issues found", colors.green);
  }

  return hasErrors;
}

async function main() {
  if (platform() !== "linux" && platform() !== "darwin") {
    log("clang-tidy is only supported on Linux and macOS", colors.yellow);
    process.exit(0);
  }

  // Find clang-tidy
  const clangTidy = findClangTidy();
  if (!clangTidy) {
    log("Error: clang-tidy not found. Please install it first.", colors.red);
    log("  Ubuntu/Debian: sudo apt-get install clang-tidy", colors.dim);
    log("  macOS: brew install llvm", colors.dim);
    process.exit(1);
  }

  // Get files to check
  const files = getCppFiles();
  if (files.length === 0) {
    log("No C++ files found to check", colors.yellow);
    process.exit(0);
  }

  // Run clang-tidy
  const hasErrors = await runClangTidy(clangTidy, files);

  // Exit with appropriate code
  process.exit(hasErrors ? 1 : 0);
}

// Add option to fix issues automatically
if (process.argv.includes("--fix")) {
  log("Fix mode is not yet implemented", colors.yellow);
  process.exit(1);
}

main().catch((error) => {
  log(`Error: ${error.message}`, colors.red);
  process.exit(1);
});
