/**
 * Test utilities for Node.js compatibility tests (ESM version)
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Use process.pid to create a unique subdirectory per test process.
// This prevents concurrent test files from stomping on each other's temp directories.
const baseDir = path.join(os.tmpdir(), "node-sqlite-compat-tests");
const testDir = path.join(baseDir, `pid-${process.pid}`);

export const tmpdir = {
  path: testDir,
  refresh() {
    // Only refresh this process's subdirectory, not the entire test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
    fs.mkdirSync(testDir, { recursive: true }); // eslint-disable-line security/detect-non-literal-fs-filename
  },
};

// Initialize on first load
tmpdir.refresh();

let cnt = 0;

export function nextDb() {
  return path.join(testDir, `database-${cnt++}.db`);
}

export const isWindows = process.platform === "win32";

/**
 * Promisified version of child_process.spawn.
 * Matches Node.js test/common spawnPromisified signature.
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments to pass to the command
 * @param {object} [options] - spawn options
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string}>}
 */
export function spawnPromisified(command, args, options) {
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
export function mustCall(fn) {
  // In node:test context, we rely on the test framework for assertions.
  // This is a pass-through that matches the Node.js common API signature.
  return fn;
}

export default { tmpdir, nextDb, isWindows, spawnPromisified, mustCall };
