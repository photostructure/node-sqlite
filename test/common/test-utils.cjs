/**
 * Test utilities for Node.js compatibility tests (CJS version)
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Use process.pid to create a unique subdirectory per test process.
// This prevents concurrent test files from stomping on each other's temp directories.
// Use fs.realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
// to ensure path comparisons work correctly with sqlite3_db_filename().
const baseDir = path.join(os.tmpdir(), "node-sqlite-compat-tests");
// Create the base directory first so realpathSync can resolve it
fs.mkdirSync(baseDir, { recursive: true });
const realBaseDir = fs.realpathSync(baseDir);
const testDir = path.join(realBaseDir, `pid-${process.pid}`);

const tmpdir = {
  path: testDir,
  refresh() {
    // Only refresh this process's subdirectory, not the entire test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
    fs.mkdirSync(testDir, { recursive: true });
  },
};

// Initialize on first load
tmpdir.refresh();

let cnt = 0;

function nextDb() {
  return path.join(testDir, `database-${cnt++}.db`);
}

const isWindows = process.platform === "win32";

/**
 * Promisified version of child_process.spawn.
 * Matches Node.js test/common spawnPromisified signature.
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments to pass to the command
 * @param {object} [options] - spawn options
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string}>}
 */
function spawnPromisified(command, args, options) {
  let stderr = "";
  let stdout = "";

  const child = spawn(command, args, options);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    stdout += data;
  });

  return new Promise((resolve, reject) => {
    child.on("close", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Wraps a callback to assert it was called.
 * Simplified version of Node.js test/common mustCall.
 * For node:test, we just return the function as-is since
 * node:test handles assertion tracking differently.
 * @param {Function} fn - The function to wrap
 * @returns {Function} The wrapped function
 */
function mustCall(fn) {
  // In node:test context, we rely on the test framework for assertions.
  // This is a pass-through that matches the Node.js common API signature.
  return fn;
}

/**
 * Runs the garbage collector until `condition` holds, or fails the calling test.
 * Stands in for Node.js's internal test/common/gc.js helper.
 *
 * Requires --expose-gc, which the node-compat runner passes. A FinalizationRegistry
 * callback runs in a later microtask than the collection itself, so each attempt
 * yields to the event loop before re-checking.
 *
 * @param {string} name - What is being waited for, used in the failure message
 * @param {() => boolean} condition - Polled after each collection
 * @param {number} [maxAttempts] - Collections to attempt before giving up
 * @returns {Promise<void>}
 */
async function gcUntil(name, condition, maxAttempts = 100) {
  if (typeof global.gc !== "function") {
    throw new Error(`gcUntil("${name}") requires --expose-gc`);
  }
  for (let i = 0; i < maxAttempts; i++) {
    if (condition()) {
      return;
    }
    global.gc();
    // Let FinalizationRegistry callbacks, which are scheduled as a separate
    // task, actually run before the next check.
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Test timed out waiting for ${name}`);
}

module.exports = {
  tmpdir,
  nextDb,
  isWindows,
  spawnPromisified,
  mustCall,
  gcUntil,
};
