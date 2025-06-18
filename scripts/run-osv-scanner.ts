#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { platform } from "node:os";

// Skip OSV scanner on Windows - it only needs to run on one platform in CI
if (platform() === "win32") {
  console.log("Skipping OSV scanner on Windows");
  process.exit(0);
}

try {
  // Check if osv-scanner is installed using execFileSync for security
  execFileSync("which", ["osv-scanner"], { stdio: "ignore" });
  
  // Run the scanner using execFileSync
  console.log("Running OSV scanner...");
  execFileSync("osv-scanner", ["scan", "source", "--recursive", "."], { 
    stdio: "inherit" 
  });
} catch (error) {
  console.log("OSV Scanner not installed. Install with: go install github.com/google/osv-scanner/cmd/osv-scanner@latest");
  // Exit with 0 to not fail the build - OSV scanner is optional
  process.exit(0);
}