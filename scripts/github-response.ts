/**
 * Checks on values from GitHub API responses, run before the sync scripts use
 * them.
 *
 * Kept apart from `github-api.ts` so Jest can import it: that module uses the
 * DOM `HeadersInit` type, which the test tsconfig does not load.
 */

import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

/**
 * Returns `sha` if it is a full 40-character lowercase hex git object SHA,
 * and throws otherwise. The sync scripts put commit and tree SHAs from GitHub
 * API responses into URLs and, in sync-from-node.ts, a shell command.
 *
 * @param source - Where `sha` came from, for the error message
 */
export function assertGitSha(sha: unknown, source: string): string {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `Expected a 40-character hex SHA from ${source}, got ${JSON.stringify(sha)}`,
    );
  }
  return sha;
}

/**
 * Returns the git blob SHA-1 of `bytes`, as `git hash-object` computes it.
 * sync-node-tests.ts compares it with the blob SHA the tree listing gives for
 * each file it downloads.
 */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

/**
 * Returns `name`, a git-trees API path with its directory prefix removed, and
 * throws if it is absolute or has a `..` segment. sync-node-tests.ts joins it
 * onto a local directory and writes there, so either would let the file land
 * outside that directory. Splits on `\` too, which path.join treats as a
 * separator on Windows.
 */
export function assertRelativeTreePath(name: string): string {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) {
    throw new Error(
      `Refusing GitHub tree path that is absolute or contains "..": ${JSON.stringify(name)}`,
    );
  }
  return name;
}
