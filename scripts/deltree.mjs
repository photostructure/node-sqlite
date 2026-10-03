#!/usr/bin/env node

// Delete every file or directory matching the glob patterns given as
// arguments, relative to the current directory. Replaces del-cli, whose
// globby -> micromatch -> braces chain has no fix for GHSA-vfj7-8cjw-p6xm.

import { globSync, rmSync } from "node:fs";

for (const path of globSync(process.argv.slice(2))) {
  rmSync(path, { recursive: true, force: true });
}
