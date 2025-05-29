#!/usr/bin/env node

import { platform } from "os";
import { execSync } from "child_process";

// Only run on Linux
if (platform() !== "linux") {
  console.log("⚠ Skipping memory tests (Linux only)");
  process.exit(0);
}

console.log("Running quick memory tests...");

try {
  // Run only the JavaScript memory tests (faster than valgrind)
  execSync("npm run test:memory", { stdio: "inherit" });
  console.log("✓ Memory tests passed");
} catch (error) {
  console.error("✗ Memory tests failed");
  process.exit(1);
}