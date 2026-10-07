#!/usr/bin/env node

// Builds dist/ in a private directory, then renames each file into dist/. A
// rename replaces its target atomically, so a test run that loads dist/ never
// sees a file that a concurrent `npm test` has removed or half written.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
mkdirSync(dist, { recursive: true });
const tmp = mkdtempSync(join(dist, ".tmp-"));
try {
  execFileSync("npx", ["tsup", "--out-dir", tmp], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  // Copy .d.ts to .d.cts for CommonJS type safety
  for (const entry of ["index", "experimental"]) {
    copyFileSync(join(tmp, `${entry}.d.ts`), join(tmp, `${entry}.d.cts`));
  }
  // Chunks first, so no entry point appears before a chunk it imports.
  const files = readdirSync(tmp).sort(
    (a, b) => Number(!a.startsWith("chunk-")) - Number(!b.startsWith("chunk-")),
  );
  for (const file of files) {
    renameSync(join(tmp, file), join(dist, file));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
