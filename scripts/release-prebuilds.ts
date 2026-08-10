/**
 * The set of native binaries a release must ship.
 *
 * Eight jobs each build one, upload it, and the pack job downloads them into a
 * single `prebuilds/` tree. This module is the assertion that the tree is exactly
 * right before anything gets packaged: a platform whose build silently produced
 * nothing, a matrix entry pointed at the wrong target, or a renamed output all
 * surface here rather than as a consumer compiling from source.
 *
 * Both `build.yml` and `publish.yaml` run it, so every push to `main` exercises
 * the check a release depends on. A workflow file is frozen at the tag it runs
 * from: a defect that only surfaces at tag time costs a whole version.
 *
 * Artifact transport is not this module's problem -- `actions/download-artifact`
 * hashes every artifact and fails on `digest-mismatch` by default.
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface PrebuildTarget {
  /** Matches the workflow job's artifact name suffix. */
  id: string;
  platform: "darwin" | "linux" | "win32";
  architecture: "x64" | "arm64";
  /** The libc a binary is bound to. `null` where the platform has only one. */
  libc: "glibc" | "musl" | null;
}

export const prebuildTargets: readonly PrebuildTarget[] = [
  { id: "darwin-arm64", platform: "darwin", architecture: "arm64", libc: null },
  { id: "darwin-x64", platform: "darwin", architecture: "x64", libc: null },
  {
    id: "linux-arm64-glibc",
    platform: "linux",
    architecture: "arm64",
    libc: "glibc",
  },
  {
    id: "linux-arm64-musl",
    platform: "linux",
    architecture: "arm64",
    libc: "musl",
  },
  {
    id: "linux-x64-glibc",
    platform: "linux",
    architecture: "x64",
    libc: "glibc",
  },
  {
    id: "linux-x64-musl",
    platform: "linux",
    architecture: "x64",
    libc: "musl",
  },
  { id: "win32-arm64", platform: "win32", architecture: "arm64", libc: null },
  { id: "win32-x64", platform: "win32", architecture: "x64", libc: null },
];

/**
 * Where prebuildify writes this target's binary, relative to the package root.
 *
 * `scripts/build-native.ts` passes `--tag-libc` on every platform, so macOS and
 * Windows binaries carry a `.glibc` tag too. That resolves correctly:
 * node-gyp-build defaults `libc` to `glibc` off Alpine and only rejects a tag that
 * *disagrees* (see node_modules/node-gyp-build/node-gyp-build.js). The tag stays
 * as-is -- renaming these files would change how installed packages resolve a
 * prebuild.
 *
 * prebuildify derives the directory from the building host, and the build passes
 * no `--platform`/`--arch`, so the path itself attests where a binary came from.
 */
export function expectedPrebuildPath(
  packageName: string,
  target: PrebuildTarget,
): string {
  const binaryName = packageName.replaceAll("/", "+");
  const libcTag = target.libc ?? "glibc";
  return `prebuilds/${target.platform}-${target.architecture}/${binaryName}.${libcTag}.node`;
}

export function expectedPrebuildPaths(packageName: string): string[] {
  return prebuildTargets
    .map((target) => expectedPrebuildPath(packageName, target))
    .sort();
}

function slashPath(path: string): string {
  return path.split(sep).join("/");
}

async function findNodeFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".node")) {
        found.push(slashPath(relative(root, path)));
      }
    }
  }

  await visit(root);
  return found.sort();
}

/**
 * Throws unless `prebuilds/` holds exactly the eight expected binaries. Extra
 * files matter as much as missing ones: one means a build wrote somewhere nobody
 * expected, and `npm pack` would ship it.
 */
export async function verifyPrebuilds(options: {
  projectRoot: string;
  packageName: string;
}): Promise<string[]> {
  const { projectRoot, packageName } = options;
  const expected = expectedPrebuildPaths(packageName);
  const prebuildRoot = join(resolve(projectRoot), "prebuilds");
  const actual = (await findNodeFiles(prebuildRoot).catch(() => [])).map(
    (file) => `prebuilds/${file}`,
  );

  const missing = expected.filter((file) => !actual.includes(file));
  const unexpected = actual.filter((file) => !expected.includes(file));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        `Expected ${expected.length} prebuilds, found ${actual.length}.`,
        missing.length > 0 ? `Missing: ${missing.join(", ")}` : "",
        unexpected.length > 0 ? `Unexpected: ${unexpected.join(", ")}` : "",
      ]
        .filter((line) => line.length > 0)
        .join(" "),
    );
  }

  return expected;
}
