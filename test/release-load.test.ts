/**
 * The load check must exercise the *installed* package.
 *
 * `release-cli.ts` runs under tsx, and this repository's tsconfig maps
 * `@photostructure/sqlite` to `src/index.ts` so the test suite can import itself
 * by name. That mapping applies to the CLI too, so a `require()` evaluated inside
 * the tsx process silently verifies the working tree instead of the tarball.
 * These tests install a stand-in package that records each entry point it loads,
 * so a check that resolves anywhere else records nothing and fails.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { useTempDir } from "./test-utils";

const projectRoot = resolve(__dirname, "..");
const packageName = "@photostructure/sqlite";

/**
 * A package that satisfies the round trip without SQLite, and appends its module
 * format to the marker file so the test can tell which entry points ran.
 */
const stubBody = (format: string) => `
class DatabaseSync {
  exec() {}
  prepare() {
    return {
      run: () => ({ lastInsertRowid: 1 }),
      get: () => ({ name: "alpha" }),
    };
  }
  close() {}
}
appendFileSync(process.env.PACKED_LOAD_MARKER, ${JSON.stringify(`${format}\n`)});
`;

async function writeInstallRoot(installRoot: string): Promise<void> {
  const packageRoot = join(installRoot, "node_modules", packageName);
  await mkdir(packageRoot, { recursive: true });

  await writeFile(
    join(installRoot, "package.json"),
    JSON.stringify({ name: "install-root", version: "1.0.0", private: true }),
  );
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "0.0.0-stub",
      exports: { ".": { require: "./index.cjs", import: "./index.mjs" } },
    }),
  );
  await writeFile(
    join(packageRoot, "index.cjs"),
    `const { appendFileSync } = require("node:fs");
${stubBody("cjs")}
module.exports = { DatabaseSync };
`,
  );
  await writeFile(
    join(packageRoot, "index.mjs"),
    `import { appendFileSync } from "node:fs";
${stubBody("esm")}
export { DatabaseSync };
`,
  );
}

function runLoad(installRoot: string, markerPath: string): string {
  // `node --import tsx` is how npm run reaches this script, tsconfig paths and
  // all. Running the CLI any other way would not reproduce the resolution the
  // check has to survive.
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(projectRoot, "scripts", "release-cli.ts"),
      "load",
      "--project-root",
      projectRoot,
      "--install-root",
      installRoot,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, PACKED_LOAD_MARKER: markerPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

describe("release load check", () => {
  const temp = useTempDir("sqlite-release-load-");

  test("loads both entry points from the install root", async () => {
    const installRoot = join(temp.tempDir, "install");
    const markerPath = join(temp.tempDir, "loaded.txt");
    await writeInstallRoot(installRoot);
    await writeFile(markerPath, "");

    expect(runLoad(installRoot, markerPath)).toContain(
      "Packed CommonJS and ESM entry points loaded successfully",
    );

    // Without both, something other than the installed package answered.
    expect(
      (await readFile(markerPath, "utf8")).split("\n").filter(Boolean),
    ).toEqual(["cjs", "esm"]);
  }, 60_000);

  test("fails when the install root holds no package", async () => {
    const installRoot = join(temp.tempDir, "empty");
    const markerPath = join(temp.tempDir, "unused.txt");
    await mkdir(installRoot, { recursive: true });
    await writeFile(
      join(installRoot, "package.json"),
      JSON.stringify({ name: "install-root", version: "1.0.0", private: true }),
    );

    expect(() => runLoad(installRoot, markerPath)).toThrow();
  }, 60_000);
});
