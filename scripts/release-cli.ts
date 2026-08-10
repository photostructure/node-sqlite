#!/usr/bin/env node
/**
 * Verifies, packs, installs, and loads the release tarball.
 *
 * Both `build.yml` and `publish.yaml` drive these subcommands, so the procedure
 * that gates a release is the one every push to `main` exercises. Keeping it here
 * rather than in workflow shell also keeps it off the platform's coreutils: the
 * matrix spans GNU, BusyBox, macOS, and Git for Windows.
 *
 *   npm run release:verify-prebuilds -- --project-root .
 *   npm run release:pack-package -- --project-root . --artifact-dir package-artifact
 *   npm run release:install-package -- --project-root . \
 *     --artifact-dir package-artifact --install-root package-install
 *   npm run release:load-package -- --project-root . --install-root package-install
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { argv, env, execPath, platform } from "node:process";

import {
  assertPackedContents,
  assertPackedManifest,
  findTarball,
  packedFilename,
  type PackageIdentity,
} from "./release-package";
import { expectedPrebuildPaths, verifyPrebuilds } from "./release-prebuilds";

function option(name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = argv[index + 1];
  if (index < 0 || value == null || value.startsWith("--")) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function optionalOption(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : option(name);
}

/**
 * The identity every artifact must agree on. The release path passes
 * `--expected-*` so the tarball stays bound to the validated tag rather than to
 * whatever the checkout happens to say.
 */
async function identity(projectRoot: string): Promise<PackageIdentity> {
  const pkg = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error("package.json must contain a name and version");
  }

  for (const [flag, actual] of [
    ["expected-name", pkg.name],
    ["expected-version", pkg.version],
  ] as const) {
    const expected = optionalOption(flag);
    if (expected != null && expected !== actual) {
      throw new Error(
        `--${flag} is ${expected}, but package.json says ${actual}`,
      );
    }
  }

  return { name: pkg.name, version: pkg.version };
}

/**
 * How to launch npm: `[command, ...prefixArgs]`.
 *
 * On Windows npm is `npm.cmd`, which Node refuses to spawn without a shell
 * (EINVAL, since the CVE-2024-27980 fix) -- and `shell: true` would hand cmd.exe
 * the tarball path unquoted. `npm_execpath` is npm's JavaScript entry point, which
 * node runs directly. Both workflows invoke this script through `npm run`, so it
 * is always set there.
 */
function npmArgv(): string[] {
  const execpath = env["npm_execpath"];
  if (execpath?.endsWith(".js") === true) return [execPath, execpath];
  if (platform === "win32") {
    throw new Error(
      "npm_execpath is unset, and node cannot spawn npm.cmd directly. Run this script through `npm run`.",
    );
  }
  return ["npm"]; // a shebang script execFile can launch
}

function npm(args: readonly string[], cwd: string): string {
  const [command, ...prefixArgs] = npmArgv() as [string, ...string[]];
  return execFileSync(command, [...prefixArgs, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function tar(args: readonly string[]): string {
  return execFileSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function verify(projectRoot: string): Promise<void> {
  const { name } = await identity(projectRoot);
  const verified = await verifyPrebuilds({ projectRoot, packageName: name });
  console.log(`Verified ${verified.length} prebuilds:\n${verified.join("\n")}`);
}

async function pack(projectRoot: string): Promise<void> {
  const artifactDir = resolve(option("artifact-dir"));
  const expected = await identity(projectRoot);
  await mkdir(artifactDir, { recursive: true });

  const packJson = npm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDir],
    projectRoot,
  );
  await writeFile(join(artifactDir, "PACK.json"), packJson);

  const filename = packedFilename(JSON.parse(packJson) as unknown, expected);
  const tarball = await findTarball(artifactDir);
  if (basename(tarball) !== filename) {
    throw new Error(
      `npm pack reported ${filename}, but ${basename(tarball)} is the only tarball`,
    );
  }

  assertPackedManifest(
    JSON.parse(tar(["-xOf", tarball, "package/package.json"])) as unknown,
    expected,
  );

  const contents = tar(["-tzf", tarball])
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
  assertPackedContents(contents, expectedPrebuildPaths(expected.name));

  // The inventory a maintainer reviews before approving the staged package.
  await writeFile(
    join(artifactDir, "CONTENTS.txt"),
    contents.map((line) => `${line}\n`).join(""),
  );

  console.log(
    `Packed ${expected.name}@${expected.version} as ${filename} (${contents.length} entries)`,
  );
}

async function install(): Promise<void> {
  const artifactDir = resolve(option("artifact-dir"));
  const installRoot = resolve(option("install-root"));

  const tarball = await findTarball(artifactDir);
  await mkdir(installRoot, { recursive: true });
  npm(["init", "--yes"], installRoot);
  npm(
    [
      "install",
      tarball,
      // The install lifecycle (node-gyp-build) stays off, so loading the package
      // proves the *packed prebuild* resolves rather than a local source build.
      "--ignore-scripts",
      // Reject a tarball whose dependencies are too fresh to have been vetted.
      "--min-release-age=14",
      "--no-audit",
      "--no-fund",
    ],
    installRoot,
  );
  console.log(`Installed ${basename(tarball)} into ${installRoot}`);
}

/**
 * Round-tripping a row through the native binding proves the packed prebuild
 * loaded, which module resolution alone does not.
 */
const roundTrip = `
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const { lastInsertRowid } = db
      .prepare("INSERT INTO t (name) VALUES (?)")
      .run("alpha");
    const row = db.prepare("SELECT name FROM t WHERE id = ?").get(lastInsertRowid);
    if (row?.name !== "alpha") {
      throw new Error("The packed package returned " + JSON.stringify(row));
    }
  } finally {
    db.close();
  }
`;

/**
 * Runs one entry-point check in a plain `node`, resolving from the install root.
 *
 * Never in this process: this script runs under tsx, whose tsconfig `paths`
 * mapping redirects the package name to `src/index.ts`. A `require()` here would
 * verify the working tree and report success no matter what the tarball holds.
 * A subprocess also resolves the package the way a consumer's does -- no loader
 * hooks, and the two entry points resolve independently.
 */
function loadEntryPoint(
  installRoot: string,
  inputType: "commonjs" | "module",
  source: string,
): void {
  execFileSync(
    execPath,
    [`--input-type=${inputType}`, "--eval", `${source}\n${roundTrip}`],
    { cwd: installRoot, stdio: "inherit" },
  );
}

async function load(projectRoot: string): Promise<void> {
  const installRoot = resolve(option("install-root"));
  const { name } = await identity(projectRoot);
  const specifier = JSON.stringify(name);

  loadEntryPoint(
    installRoot,
    "commonjs",
    `const { DatabaseSync } = require(${specifier});`,
  );
  loadEntryPoint(
    installRoot,
    "module",
    `import { DatabaseSync } from ${specifier};`,
  );

  console.log("Packed CommonJS and ESM entry points loaded successfully");
}

async function main(): Promise<void> {
  const command = argv[2];
  const projectRoot = resolve(option("project-root"));

  if (command === "verify-prebuilds") return verify(projectRoot);
  if (command === "pack") return pack(projectRoot);
  if (command === "install") return install();
  if (command === "load") return load(projectRoot);

  throw new Error(`Unsupported command: ${String(command)}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
