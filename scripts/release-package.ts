/**
 * Identity checks for the packed release tarball.
 *
 * These answer "is this the package the release intended to ship?" -- the right
 * name and version at every hop, and every promised prebuild inside the tarball.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PackageIdentity {
  name: string;
  version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function assertIdentity(
  value: unknown,
  expected: PackageIdentity,
  source: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  if (
    value["name"] !== expected.name ||
    value["version"] !== expected.version
  ) {
    throw new Error(
      `${source} identifies ${String(value["name"])}@${String(value["version"])}, expected ${expected.name}@${expected.version}`,
    );
  }
  return value;
}

/**
 * Validates `npm pack --json` output against the expected identity and returns the
 * single tarball filename it reports.
 */
export function packedFilename(
  packJson: unknown,
  expected: PackageIdentity,
): string {
  if (!Array.isArray(packJson) || packJson.length !== 1) {
    throw new Error(
      `Expected one npm pack record, found ${Array.isArray(packJson) ? packJson.length : "a non-array"}`,
    );
  }
  const record = assertIdentity(packJson[0], expected, "The npm pack record");
  const filename = record["filename"];
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("The npm pack record has no filename");
  }
  return filename;
}

/** Validates the `package.json` extracted from inside the packed tarball. */
export function assertPackedManifest(
  manifest: unknown,
  expected: PackageIdentity,
): void {
  assertIdentity(manifest, expected, "The packed manifest");
}

/**
 * Confirms the tarball carries every prebuild the release promises, each exactly
 * once.
 *
 * Distinct from verifying `prebuilds/` on disk: this catches a `files` allowlist
 * that drops them after they were built and checked. Consumers on a missing
 * platform fall back to compiling from source, which is silent until someone
 * without a toolchain tries to install.
 */
export function assertPackedContents(
  contents: readonly string[],
  expectedPrebuilds: readonly string[],
): void {
  for (const file of expectedPrebuilds) {
    const matches = contents.filter((entry) => entry === `package/${file}`);
    if (matches.length !== 1) {
      throw new Error(
        `The tarball contains ${matches.length} copies of ${file}, expected 1`,
      );
    }
  }
}

/** Locates the one tarball in a package artifact directory. */
export async function findTarball(directory: string): Promise<string> {
  const tarballs = (await readdir(directory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  const only = tarballs[0];
  if (tarballs.length !== 1 || only == null) {
    throw new Error(
      `Expected exactly one tarball in ${directory}, found ${tarballs.join(", ") || "none"}`,
    );
  }
  return join(directory, only);
}
