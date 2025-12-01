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

// Check if extension already exists (skip rebuild unless --force is passed)
const forceRebuild = process.argv.includes("--force");
if (!forceRebuild && fs.existsSync(targetFile)) {
  console.log(`Test extension already exists: ${targetFile}`);
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
