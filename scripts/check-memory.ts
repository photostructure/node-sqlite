import { execSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
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
    return error.stdout || error.stderr || "";
  }
}

function runCommand(
  command: string,
  args: string[] = [],
  options: any = {},
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("close", (code) => resolve(code || 0));
  });
}

async function runJavaScriptMemoryTests(): Promise<number> {
  log("\n=== Running JavaScript Memory Tests ===", colors.blue);

  const exitCode = await runCommand("npm", ["run", "test:memory"]);

  if (exitCode === 0) {
    log("✓ JavaScript memory tests passed", colors.green);
  } else {
    log("✗ JavaScript memory tests failed", colors.red);
  }

  return exitCode;
}

async function runValgrindTests(): Promise<number> {
  if (platform() !== "linux") {
    log("\n=== Valgrind Tests (skipped - Linux only) ===", colors.yellow);
    return 0;
  }

  log("\n=== Running Valgrind Memory Tests ===", colors.blue);

  // Check if valgrind is available
  const valgrindCheck = execCommand("which valgrind");
  if (!valgrindCheck.trim()) {
    log("⚠ Valgrind not found - skipping valgrind tests", colors.yellow);
    return 0;
  }

  const exitCode = await runCommand("bash", [join(__dirname, "valgrind.sh")]);

  if (exitCode === 0) {
    log("✓ Valgrind tests passed", colors.green);
  } else {
    log("✗ Valgrind tests failed", colors.red);
  }

  return exitCode;
}

async function buildWithASAN() {
  log("Building with AddressSanitizer...", colors.dim);

  // Clean previous build
  execCommand("npm run clean");

  // Set compiler flags for ASAN
  const env = {
    ...process.env,
    CC: "gcc",
    CXX: "g++",
    CFLAGS: "-fsanitize=address -fno-omit-frame-pointer -g -O1",
    CXXFLAGS: "-fsanitize=address -fno-omit-frame-pointer -g -O1",
    LDFLAGS: "-fsanitize=address",
  };

  // Rebuild with ASAN
  execCommand("npm run node-gyp-rebuild", { env });

  log("✓ Built with AddressSanitizer", colors.green);
}

async function findASANLibrary() {
  // Try to find the ASAN library
  const gccVersion = execCommand("gcc --version").split("\n")[0];
  const gccMatch = gccVersion.match(/gcc.*?(\d+)/);
  const majorVersion = gccMatch ? gccMatch[1] : "11";

  const possiblePaths = [
    `/usr/lib/x86_64-linux-gnu/libasan.so.${majorVersion}`,
    `/usr/lib/x86_64-linux-gnu/libasan.so.6`,
    `/usr/lib/x86_64-linux-gnu/libasan.so.5`,
    `/usr/lib64/libasan.so.${majorVersion}`,
    `/usr/lib64/libasan.so.6`,
    `/usr/lib64/libasan.so.5`,
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Try to find it using ldconfig
  const ldconfigOutput = execCommand("ldconfig -p | grep libasan");
  const match = ldconfigOutput.match(/=> (.+libasan\.so\.\d+)/);
  if (match) {
    return match[1];
  }

  return null;
}

async function runASANTests(): Promise<number> {
  if (platform() !== "linux") {
    log(
      "\n=== AddressSanitizer Tests (skipped - Linux only) ===",
      colors.yellow,
    );
    return 0;
  }

  log("\n=== Running AddressSanitizer Tests ===", colors.blue);

  // Check if gcc is available
  const gccCheck = execCommand("which gcc");
  if (!gccCheck.trim()) {
    log("⚠ GCC not found - skipping ASAN tests", colors.yellow);
    return 0;
  }

  // Build with ASAN
  await buildWithASAN();

  // Find ASAN library
  const asanLib = await findASANLibrary();
  if (!asanLib) {
    log("⚠ Could not find ASAN library - skipping ASAN tests", colors.yellow);
    return 0;
  }

  log(`Using ASAN library: ${asanLib}`, colors.dim);

  // Set up ASAN environment
  const env = {
    ...process.env,
    LD_PRELOAD: asanLib,
    ASAN_OPTIONS:
      "detect_leaks=1:halt_on_error=0:print_stats=1:suppressions=" +
      join(projectRoot, ".asan-suppressions.txt"),
    LSAN_OPTIONS: "suppressions=" + join(projectRoot, ".lsan-suppressions.txt"),
  };

  // Run tests with ASAN
  const asanOutput: string[] = [];
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn("npm", ["test"], {
      cwd: projectRoot,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      asanOutput.push(data.toString());
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data);
      asanOutput.push(data.toString());
    });

    child.on("close", (code) => resolve(code || 0));
  });

  // Save ASAN output for analysis
  const asanLogPath = join(projectRoot, "asan-output.log");
  writeFileSync(asanLogPath, asanOutput.join(""));
  log(`\nASAN output saved to: ${asanLogPath}`, colors.dim);

  // Check for ASAN errors in our code
  const asanText = asanOutput.join("");
  const hasOurErrors =
    asanText.includes("node_sqlite.node") ||
    asanText.includes("/src/") ||
    asanText.includes("sqlite_impl.cpp");

  if (hasOurErrors && asanText.includes("ERROR: AddressSanitizer")) {
    log("✗ AddressSanitizer detected errors in our code", colors.red);
    return 1;
  } else if (exitCode === 0) {
    log("✓ AddressSanitizer tests passed", colors.green);
  } else {
    log("✗ Tests failed under AddressSanitizer", colors.red);
  }

  return exitCode;
}

async function main() {
  log("=== SQLite Memory Testing Suite ===", colors.blue);
  log(`Platform: ${platform()}`, colors.dim);

  // Build the project first
  log("\nBuilding project...", colors.dim);
  try {
    execCommand("npm run build");
    log("✓ Build completed", colors.green);
  } catch (error) {
    log("✗ Build failed", colors.red);
    process.exit(1);
  }

  let totalExitCode = 0;

  // Run JavaScript memory tests (cross-platform)
  const jsExitCode = await runJavaScriptMemoryTests();
  totalExitCode += jsExitCode;

  // Run valgrind tests (Linux only)
  const valgrindExitCode = await runValgrindTests();
  totalExitCode += valgrindExitCode;

  // Run ASAN tests if requested
  if (process.env.ENABLE_ASAN === "1") {
    const asanExitCode = await runASANTests();
    totalExitCode += asanExitCode;
  } else {
    log(
      "\n=== AddressSanitizer Tests (skipped - set ENABLE_ASAN=1 to run) ===",
      colors.yellow,
    );
  }

  // Summary
  log("\n=== Summary ===", colors.blue);
  if (totalExitCode === 0) {
    log("✓ All memory tests passed", colors.green);
  } else {
    log("✗ Some memory tests failed", colors.red);
  }

  process.exit(totalExitCode > 0 ? 1 : 0);
}

main().catch((error) => {
  log(`Error: ${error.message}`, colors.red);
  process.exit(1);
});
