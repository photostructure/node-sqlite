#!/usr/bin/env node
/**
 * Cross-platform native build script that checks for existing builds before rebuilding
 * This replaces the bash-only prebuildify-wrapper.sh for Windows compatibility
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Check if a valid native module exists (>25kB)
 */
function findValidNativeModule(dir: string): boolean {
  if (!existsSync(dir)) return false;

  try {
    const files = readdirSync(dir, {
      recursive: true,
      encoding: "utf8",
      withFileTypes: false,
    });
    for (const file of files) {
      if (file.endsWith(".node")) {
        const fullPath = join(dir, file);
        const stats = statSync(fullPath);
        if (stats.size > 25 * 1024) {
          // > 25kB
          return true;
        }
      }
    }
  } catch {
    // Directory might not exist or be accessible
  }
  return false;
}

// Check for existing builds
if (findValidNativeModule("prebuilds")) {
  console.log(
    "Native module already built (found .node file > 25kB), skipping rebuild",
  );
  process.exit(0);
}

if (findValidNativeModule("build/Release")) {
  console.log("Native module already built in build/Release, skipping rebuild");
  process.exit(0);
}

// No existing build found, run prebuildify
console.log("Building native module...");

try {
  // Pass through any command line arguments
  const args = process.argv.slice(2);
  const prebuildifyArgs = [
    "prebuildify",
    "--napi",
    "--tag-libc",
    "--strip",
    ...args,
  ];

  // Use execFileSync for both platforms to avoid shell injection vulnerabilities.
  // On Windows, we need to use the full path to npx.cmd or use { shell: true }
  // with execFileSync, which safely passes arguments as an array.
  execFileSync("npx", prebuildifyArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  // Verify the build succeeded
  if (!findValidNativeModule("prebuilds")) {
    console.error(
      "Build failed: No valid native module found (expected .node file > 25kB)",
    );
    process.exit(1);
  }

  console.log("Native module built successfully (size > 25kB)");
} catch (error) {
  console.error("Build failed:", (error as Error).message);
  process.exit(1);
}
