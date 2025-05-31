#!/usr/bin/env tsx

import { execSync } from "child_process";

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split(".")[0].substring(1), 10);

if (majorVersion !== 24) {
  console.log(
    `Skipping API compatibility check - requires Node.js 24 (current: ${nodeVersion})`,
  );
  process.exit(0);
}

// Run the TypeScript compiler on the API compatibility test
try {
  execSync("tsc -p scripts/tsconfig.api-check.json", { stdio: "inherit" });
  console.log("API compatibility check passed");
} catch (error) {
  console.error("API compatibility check failed");
  process.exit(1);
}
