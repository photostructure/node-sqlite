#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// Determine target extension file based on platform
const targetDir = __dirname;
let targetFile;
if (process.platform === "win32") {
  targetFile = path.join(targetDir, "test_extension.dll");
} else if (process.platform === "darwin") {
  targetFile = path.join(targetDir, "test_extension.dylib");
} else {
  targetFile = path.join(targetDir, "test_extension.so");
}

// Rebuild when the compiled extension is missing, stale (older than the C
// source), or --force is passed. The mtime check matters because a new entry
// point added to test_extension.c would otherwise be ignored in favor of a
// cached .so, so tests that load the new symbol fail with a misleading
// "no entry point" error. The .so is gitignored, so CI always builds fresh;
// this only guards a developer's pre-existing stale build.
const sourcePath = path.join(__dirname, "test_extension.c");
const forceRebuild = process.argv.includes("--force");
let extensionIsCurrent = false;
if (fs.existsSync(targetFile)) {
  try {
    extensionIsCurrent =
      fs.statSync(targetFile).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
  } catch {
    extensionIsCurrent = false;
  }
}
if (!forceRebuild && extensionIsCurrent) {
  console.log(`Test extension is up to date: ${targetFile}`);
  console.log("Use --force to rebuild");
  process.exit(0);
}

// Build the test extension
// Use npx to ensure node-gyp is available on all platforms, especially Windows
const buildProcess = spawn("npx", ["node-gyp", "rebuild"], {
  cwd: __dirname,
  stdio: "inherit",
  shell: true, // Required for npx on Windows
});

buildProcess.on("close", (code) => {
  if (code !== 0) {
    console.error("Failed to build test extension");
    process.exit(1);
  }

  // Copy the built extension to a predictable location
  const buildDir = path.join(__dirname, "build/Release");

  // Find the built extension file
  let sourceFile;
  if (process.platform === "win32") {
    sourceFile = path.join(buildDir, "test_extension.dll");
  } else if (process.platform === "darwin") {
    sourceFile = path.join(buildDir, "test_extension.dylib");
  } else {
    sourceFile = path.join(buildDir, "test_extension.so");
  }

  try {
    fs.copyFileSync(sourceFile, targetFile);
    console.log(`Test extension built successfully: ${targetFile}`);
  } catch (err) {
    console.error("Failed to copy extension file:", err);
    process.exit(1);
  }
});
