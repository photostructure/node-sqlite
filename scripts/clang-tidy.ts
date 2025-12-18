#!/usr/bin/env tsx
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
    execFileSync("which", [command], { stdio: "ignore" });
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
  execSync("bear -- npm run build:native:rebuild", {
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
  // First check if LLVM is installed via Homebrew on macOS
  if (platform() === "darwin") {
    try {
      const llvmPrefix = execFileSync("brew", ["--prefix", "llvm"], {
        encoding: "utf8",
      }).trim();
      if (!isAbsolute(llvmPrefix)) {
        // This should not happen with homebrew, but as a security precaution,
        // we ensure the path is absolute before using it.
        throw new Error(
          `brew --prefix llvm returned a non-absolute path: ${llvmPrefix}`,
        );
      }
      const llvmClangTidy = join(llvmPrefix, "bin", "clang-tidy");
      if (existsSync(llvmClangTidy)) {
        const versionInfo = execFileSync(llvmClangTidy, ["--version"], {
          encoding: "utf8",
        });
        console.log(
          `${colors.dim}Found clang-tidy: ${versionInfo.split("\n")[0]}${
            colors.reset
          }`,
        );
        return llvmClangTidy;
      }
    } catch {
      // Fall through to other methods
    }
  }

  const versions = ["", "-18", "-17", "-16", "-15", "-14"];
  for (const version of versions) {
    try {
      const versionInfo = execFileSync(`clang-tidy${version}`, ["--version"], {
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

// Run clang-tidy on a single file with streaming output
async function runClangTidyOnFile(
  clangTidy: string,
  file: string,
  showDetails: boolean = true,
): Promise<TidyResult> {
  return new Promise((resolve) => {
    // Build arguments
    const args = ["-p", projectRoot];

    // On macOS, we need to explicitly add system include paths
    if (platform() === "darwin") {
      // Try to find the correct clang version directory
      const clangVersionDirs = [
        "/Library/Developer/CommandLineTools/usr/lib/clang/17/include",
        "/Library/Developer/CommandLineTools/usr/lib/clang/16/include",
        "/Library/Developer/CommandLineTools/usr/lib/clang/15/include",
      ];

      let clangInclude = clangVersionDirs.find((dir) => existsSync(dir));
      if (!clangInclude) {
        // Find it dynamically
        try {
          const clangVersion = execSync(
            "clang --version | head -1 | awk '{print $NF}' | cut -d. -f1",
            {
              encoding: "utf8",
              shell: "/bin/sh",
            },
          ).trim();
          clangInclude = `/Library/Developer/CommandLineTools/usr/lib/clang/${clangVersion}/include`;
        } catch {
          clangInclude = clangVersionDirs[0]; // fallback
        }
      }

      args.push(
        "--extra-arg=-isystem/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1",
        `--extra-arg=-isystem${clangInclude}`,
        "--extra-arg=-isystem/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include",
      );
    }

    args.push(file);

    const proc = spawn(clangTidy, args);
    let output = "";
    let errors = 0;
    let warnings = 0;
    const warningLines: string[] = [];
    const errorLines: string[] = [];

    // Process output line by line
    const processLine = (line: string) => {
      output += line + "\n";

      if (line.includes(" warning:")) {
        warnings++;
        warningLines.push(line);
        // When running in parallel, show warnings with file context
        if (showDetails && warningLines.length <= 3) {
          console.log(
            `${colors.yellow}⚠${colors.reset} ${colors.dim}${line}${colors.reset}`,
          );
        }
      } else if (line.includes(" error:")) {
        errors++;
        errorLines.push(line);
        // Always show errors immediately
        console.log(
          `${colors.red}✗${colors.reset} ${colors.dim}${line}${colors.reset}`,
        );
      }
    };

    let buffer = "";

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(processLine);
    });

    proc.stderr.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(processLine);
    });

    proc.on("close", () => {
      // Process any remaining buffer
      if (buffer) {
        processLine(buffer);
      }

      resolve({ file, output, errors, warnings });
    });
  });
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
    `${colors.dim}Checking ${files.length} files in parallel...${colors.reset}\n`,
  );

  // Run clang-tidy on all files in parallel
  const results = await Promise.all(
    files.map((file) => runClangTidyOnFile(clangTidy, file)),
  );

  // Print file summaries
  console.log(`\n${colors.blue}=== File Summary ===${colors.reset}`);
  for (const result of results) {
    const relPath = relative(projectRoot, result.file);
    if (result.errors > 0) {
      console.log(
        `${colors.red}✗${colors.reset} ${relPath}: ${result.errors} errors, ${result.warnings} warnings`,
      );
    } else if (result.warnings > 0) {
      console.log(
        `${colors.yellow}⚠${colors.reset} ${relPath}: ${result.warnings} warnings`,
      );
    } else {
      console.log(`${colors.green}✓${colors.reset} ${relPath}: clean`);
    }
  }

  // Overall summary
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings, 0);

  console.log(`\n${colors.blue}=== Overall Summary ===${colors.reset}`);
  if (totalErrors > 0) {
    console.log(`${colors.red}✗ ${totalErrors} errors found${colors.reset}`);
  }
  if (totalWarnings > 0) {
    console.log(
      `${colors.yellow}⚠ ${totalWarnings} warnings found${colors.reset}`,
    );
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`${colors.green}✓ All files are clean${colors.reset}`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run
main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
