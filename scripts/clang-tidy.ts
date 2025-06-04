#!/usr/bin/env tsx
import { exec as execCallback, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus, platform } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execCallback);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Skip clang-tidy on Windows
if (platform() === "win32") {
  console.log("Skipping clang-tidy on Windows platform");
  process.exit(0);
}

// Colors for output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
} as const;

// Check for required tools
function checkCommand(command: string, installHint: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    console.error(`Error: '${command}' not found in PATH.`);
    console.error(`To install: ${installHint}`);
    return false;
  }
}

const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";

let hasAllTools = true;

if (
  !checkCommand(
    "bear",
    isLinux
      ? "sudo apt-get install bear"
      : isMacOS
        ? "brew install bear"
        : "see https://github.com/rizsotto/Bear",
  )
) {
  hasAllTools = false;
}

// Don't require clang-tidy here, we'll find it with version detection

if (!hasAllTools) {
  process.exit(1);
}

// Generate compile_commands.json if needed
const compileCommandsPath = "compile_commands.json";
if (existsSync(compileCommandsPath)) {
  console.log("Using existing compile_commands.json");
} else {
  console.log("Generating compile_commands.json...");

  // Use bear to generate compile_commands.json
  // Bear intercepts the build commands and creates the compilation database
  execSync("bear -- npm run node-gyp-rebuild", {
    stdio: "inherit",
  });

  // Check if it was created successfully
  if (!existsSync(compileCommandsPath)) {
    console.error("Failed to generate compile_commands.json");
    console.error("Make sure bear is installed");
    process.exit(1);
  }
}

// Find clang-tidy binary (try different versions)
function findClangTidy(): string {
  const versions = ["", "-18", "-17", "-16", "-15", "-14"];
  for (const version of versions) {
    try {
      const versionInfo = execSync(`clang-tidy${version} --version`, {
        encoding: "utf8",
      });
      if (versionInfo.includes("LLVM") || versionInfo.includes("clang-tidy")) {
        console.log(
          `${colors.dim}Found clang-tidy${version}: ${versionInfo.split("\n")[0]}${colors.reset}`,
        );
        return `clang-tidy${version}`;
      }
    } catch {
      // Continue trying
    }
  }

  console.error(
    `${colors.red}Error: clang-tidy not found in PATH.${colors.reset}`,
  );
  console.error(`To install:`);
  console.error(
    `  ${colors.dim}Ubuntu/Debian: sudo apt-get install clang-tidy${colors.reset}`,
  );
  console.error(`  ${colors.dim}macOS: brew install llvm${colors.reset}`);
  process.exit(1);
}

// Get list of files to check
async function getSourceFiles(): Promise<string[]> {
  // For node-sqlite, we'll check specific files rather than scanning
  const files = [
    "src/binding.cpp",
    "src/sqlite_impl.cpp",
    "src/user_function.cpp",
    "src/aggregate_function.cpp",
  ]
    .map((f) => join(projectRoot, f))
    .filter(existsSync);

  return files;
}

interface TidyResult {
  file: string;
  output: string;
  errors: number;
  warnings: number;
}

// Run clang-tidy on a single file
async function runClangTidyOnFile(
  clangTidy: string,
  file: string,
): Promise<TidyResult> {
  try {
    const { stdout, stderr } = await exec(
      `${clangTidy} -p ${projectRoot} "${file}" 2>&1`,
    );
    const output = stdout + stderr;

    let errors = 0;
    let warnings = 0;
    const lines = output.split("\n");

    for (const line of lines) {
      if (line.includes(" warning:")) warnings++;
      if (line.includes(" error:")) errors++;
    }

    return { file, output, errors, warnings };
  } catch (error: any) {
    // clang-tidy returns non-zero on errors, capture output
    const output = error.stdout || error.stderr || error.message;
    let errors = 0;
    let warnings = 0;

    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes(" warning:")) warnings++;
      if (line.includes(" error:")) errors++;
    }

    return { file, output, errors, warnings };
  }
}

// Main function
async function main(): Promise<void> {
  const clangTidy = findClangTidy();
  console.log(`${colors.blue}=== Running clang-tidy ===${colors.reset}`);

  // Get files
  const files = await getSourceFiles();
  if (files.length === 0) {
    console.log(
      `${colors.yellow}No source files found to check${colors.reset}`,
    );
    return;
  }

  console.log(
    `${colors.dim}Checking ${files.length} files...${colors.reset}\n`,
  );

  // Run clang-tidy on files in parallel
  const parallelism = Math.min(cpus().length, 8);
  const results: TidyResult[] = [];

  // Process files in chunks
  for (let i = 0; i < files.length; i += parallelism) {
    const chunk = files.slice(i, i + parallelism);
    const chunkResults = await Promise.all(
      chunk.map((file) => runClangTidyOnFile(clangTidy, file)),
    );
    results.push(...chunkResults);

    // Show progress
    for (const result of chunkResults) {
      const relPath = relative(projectRoot, result.file);
      if (result.errors > 0) {
        console.log(
          `${colors.red}✗${colors.reset} ${relPath} (${result.errors} errors, ${result.warnings} warnings)`,
        );
        // Show actual errors
        const errorLines = result.output
          .split("\n")
          .filter(
            (line) => line.includes(" error:") || line.includes(" warning:"),
          );
        errorLines.forEach((line) =>
          console.log(`  ${colors.dim}${line}${colors.reset}`),
        );
      } else if (result.warnings > 0) {
        console.log(
          `${colors.yellow}⚠${colors.reset} ${relPath} (${result.warnings} warnings)`,
        );
        // Show warning details
        const warningLines = result.output
          .split("\n")
          .filter((line) => line.includes(" warning:"));
        warningLines
          .slice(0, 5)
          .forEach((line) =>
            console.log(`  ${colors.dim}${line}${colors.reset}`),
          );
        if (warningLines.length > 5) {
          console.log(
            `  ${colors.dim}... and ${warningLines.length - 5} more warnings${colors.reset}`,
          );
        }
      } else {
        console.log(`${colors.green}✓${colors.reset} ${relPath}`);
      }
    }
  }

  // Summary
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings, 0);

  console.log(`\n${colors.blue}=== Summary ===${colors.reset}`);
  if (totalErrors > 0) {
    console.log(`${colors.red}✗ ${totalErrors} errors found${colors.reset}`);
  }
  if (totalWarnings > 0) {
    console.log(
      `${colors.yellow}⚠ ${totalWarnings} warnings found${colors.reset}`,
    );
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`${colors.green}✓ No issues found${colors.reset}`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run
main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
