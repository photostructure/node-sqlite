#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Build the test extension
const buildProcess = spawn("node-gyp", ["rebuild"], {
  cwd: __dirname,
  stdio: "inherit",
});

buildProcess.on("close", (code) => {
  if (code !== 0) {
    console.error("Failed to build test extension");
    process.exit(1);
  }

  // Copy the built extension to a predictable location
  const buildDir = path.join(__dirname, "build/Release");
  const targetDir = __dirname;

  // Find the built extension file
  let sourceFile;
  let targetFile;

  if (process.platform === "win32") {
    sourceFile = path.join(buildDir, "test_extension.dll");
    targetFile = path.join(targetDir, "test_extension.dll");
  } else if (process.platform === "darwin") {
    sourceFile = path.join(buildDir, "test_extension.so");
    targetFile = path.join(targetDir, "test_extension.dylib");
  } else {
    sourceFile = path.join(buildDir, "test_extension.so");
    targetFile = path.join(targetDir, "test_extension.so");
  }

  try {
    fs.copyFileSync(sourceFile, targetFile);
    console.log(`Test extension built successfully: ${targetFile}`);
  } catch (err) {
    console.error("Failed to copy extension file:", err);
    process.exit(1);
  }
});
