#!/usr/bin/env node
/**
 * Cross-platform native build script.
 *
 * Once node-gyp has configured build/, this runs `node-gyp build`: the Makefile
 * it generated (an MSBuild project on Windows) recompiles only what changed,
 * tracking each source's headers, the compile commands, and binding.gyp.
 * Otherwise, as in CI's fresh checkouts, it runs prebuildify, which writes the
 * binary to prebuilds/.
 *
 * This replaces the bash-only prebuildify-wrapper.sh for Windows compatibility
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * True once node-gyp has configured build/ against Node headers that still
 * exist. prebuildify configures it against headers under os.tmpdir(), which
 * the OS may clear.
 */
function isConfigured(): boolean {
  const configPath = join("build", "config.gypi");
  if (!existsSync(configPath)) return false;
  const nodedir = /"nodedir":\s*("(?:[^"\\]|\\.)*")/.exec(
    readFileSync(configPath, "utf8"),
  );
  return nodedir != null && existsSync(JSON.parse(nodedir[1]) as string);
}

// Command line arguments are prebuildify's, so they always select prebuildify.
const args = process.argv.slice(2);

if (args.length === 0 && isConfigured()) {
  console.log("Building native module incrementally (node-gyp build)...");
  try {
    execFileSync("npx", ["node-gyp", "build"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } catch (error) {
    console.error("Build failed:", (error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

console.log("Building native module...");

try {
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
