import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { projectRoot, useTempDir } from "./test-utils";

const deltreeScript = join(projectRoot(), "scripts", "deltree.mjs");

// Runs the script the way the clean:* npm scripts do: from the package root,
// with glob patterns passed through unexpanded.
function deltree(cwd: string, ...patterns: string[]) {
  execFileSync(process.execPath, [deltreeScript, ...patterns], { cwd });
}

describe("scripts/deltree.mjs", () => {
  const temp = useTempDir("sqlite-deltree-");

  test("removes matching directories and files, and nothing else", () => {
    const dir = temp.tempDir;
    mkdirSync(join(dir, "dist", "nested"), { recursive: true });
    writeFileSync(join(dir, "dist", "nested", "index.js"), "");
    writeFileSync(join(dir, "a.tsbuildinfo"), "");
    writeFileSync(join(dir, "b.tsbuildinfo"), "");
    writeFileSync(join(dir, "keep.ts"), "");

    deltree(dir, "dist", "*.tsbuildinfo");

    expect(existsSync(join(dir, "dist"))).toBe(false);
    expect(existsSync(join(dir, "a.tsbuildinfo"))).toBe(false);
    expect(existsSync(join(dir, "b.tsbuildinfo"))).toBe(false);
    expect(existsSync(join(dir, "keep.ts"))).toBe(true);
  });

  test("succeeds when nothing matches", () => {
    expect(() => deltree(temp.tempDir, "dist", "*.tsbuildinfo")).not.toThrow();
  });
});
