/**
 * Common test utilities for Node.js compatibility tests (CJS)
 *
 * This is a shim for Node.js's internal common test module.
 */
"use strict";

const { spawn } = require("node:child_process");
const { tmpdir, nextDb, isWindows } = require("./test-utils.cjs");

// No-op shims for Node.js test harness functions
function skipIfSQLiteMissing() {
  // SQLite is always available in our package
}

function mustCall(fn, _count = 1) {
  // Simple passthrough - Node.js uses this for test assertions
  return fn;
}

function spawnPromisified(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("close", (code, signal) => resolve({ stdout, stderr, code, signal }));
    proc.on("error", reject);
  });
}

module.exports = {
  tmpdir,
  nextDb,
  isWindows,
  skipIfSQLiteMissing,
  mustCall,
  spawnPromisified,
};
