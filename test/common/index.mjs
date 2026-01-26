/**
 * Common test utilities for Node.js compatibility tests (ESM)
 *
 * This is a shim for Node.js's internal common test module.
 * Most tests import directly from test-utils.mjs, but some may reference this.
 */

import { spawn } from "node:child_process";

export { isWindows, nextDb, tmpdir } from "./test-utils.mjs";

// No-op shims for Node.js test harness functions
export function skipIfSQLiteMissing() {
  // SQLite is always available in our package
}

export function mustCall(fn, _count = 1) {
  // Simple passthrough - Node.js uses this for test assertions
  return fn;
}

export function spawnPromisified(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("close", (code, signal) =>
      resolve({ stdout, stderr, code, signal }),
    );
    proc.on("error", reject);
  });
}
