/**
 * Run pinact with an authenticated GitHub token.
 *
 * pinact verifies every pinned Action SHA against the GitHub API. Unauthenticated
 * that budget is 60 requests/hour, which this repo's workflows exhaust in a single
 * run, so a bare `pinact run -u` fails partway through with 403s. Borrowing the
 * `gh` CLI token raises the ceiling to 5000/hour.
 *
 * Exit codes are pinact's own: 0 clean, non-zero for min-age violations (see
 * .pinact.yaml) or API failures.
 */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { ensureGitHubToken } from "./github-api";

const PINACT = "github.com/suzuki-shunsuke/pinact/v4/cmd/pinact@latest";

ensureGitHubToken();

const result = spawnSync(
  "go",
  ["run", PINACT, "run", "-u", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: platform() === "win32",
  },
);

if (result.error) {
  console.error(`Failed to run pinact: ${result.error.message}`);
  console.error("pinact needs the Go toolchain: https://go.dev/dl/");
  process.exit(1);
}

process.exit(result.status ?? 1);
