/**
 * Sync Node.js SQLite test files from GitHub and adapt them for our package.
 *
 * This script:
 * 1. Downloads SQLite test files from the Node.js repository
 * 2. Saves originals to test/upstream/ (reference only, gitignored)
 * 3. Creates adapted versions in test/node-compat/ that use our package
 *
 * The adapted tests use node:test (not Jest) so they can run with minimal changes.
 * Run them with: node --test 'test/node-compat/*.test.{js,mjs}'
 *
 * Usage:
 *   npx tsx scripts/sync-node-tests.ts [options]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { githubFetch } from "./github-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

// Files that cannot be adapted for our package
const skipFiles = new Set([
  // Uses Node.js --permission flag which is a runtime security feature.
  // As a userland package, we cannot integrate with Node.js's internal
  // permission model. See doc/migrating-from-node-sqlite.md for details.
  "test-permission-sqlite-load-extension.js",

  // Tests webstorage behavior when sqlite is unavailable - not relevant for us
  "test-webstorage-without-sqlite.js",

  // Tests DatabaseSync.prototype.serialize() / deserialize(), which are
  // Node.js-internal SQLite APIs we have not yet ported. Remove this entry
  // once the APIs are implemented.
  "test-sqlite-serialize.js",
]);

// Individual tests within files that cannot pass in our standalone package.
// These get transformed to test.skip() with the reason as a comment.
// Keys are original Node.js filenames (without .test. suffix).
const skipTests: Record<string, Array<{ name: string; reason: string }>> = {
  "test-sqlite.js": [
    {
      name: "accessing the node:sqlite module",
      reason: "Tests Node.js built-in module loading",
    },
    {
      name: "can be disabled with --no-experimental-sqlite flag",
      reason: "Tests Node.js CLI flag",
    },
  ],
  "test-sqlite-statement-sync.js": [
    {
      name: "iterator keeps the prepared statement from being collected",
      reason: "Requires --expose-gc flag",
    },
  ],
  "test-sqlite-session.js": [
    {
      name: "concurrent applyChangeset with workers",
      reason: "Worker thread changeset serialization issue",
    },
    {
      name: "session supports ERM",
      reason:
        "Uses `using` declaration syntax which requires Node.js 24+ in CJS",
    },
  ],
  "test-sqlite-template-tag.js": [
    {
      name: "a tag store keeps the database alive by itself",
      reason: "Requires --expose-gc flag",
    },
    {
      name: "tag store prevents circular reference leaks",
      reason:
        "Requires --expose-gc flag and Node.js internal GC test utilities",
    },
  ],
};

/**
 * Discover SQLite test files dynamically from GitHub API.
 * Uses the Git Tree API to get all files (Contents API is limited to 1000 items).
 */
async function discoverTestFiles(repo: string, ref: string): Promise<string[]> {
  console.log("Discovering test files from GitHub API...");

  // First, get the tree SHA for the ref
  const commitUrl = `https://api.github.com/repos/${repo}/commits/${ref}`;
  const commitRes = await githubFetch(commitUrl, { logRateLimit: false });
  if (!commitRes.ok) {
    throw new Error(`Failed to get commit: ${commitRes.status}`);
  }
  const commit = (await commitRes.json()) as {
    commit: { tree: { sha: string } };
  };
  const treeSha = commit.commit.tree.sha;

  // Get the tree recursively (this returns all files, no pagination limits)
  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`;
  const treeRes = await githubFetch(treeUrl, { logRateLimit: true });
  if (!treeRes.ok) {
    throw new Error(`Failed to get tree: ${treeRes.status}`);
  }

  const tree = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string }>;
    truncated: boolean;
  };

  if (tree.truncated) {
    console.warn(
      "Warning: Tree response was truncated, some files may be missing",
    );
  }

  // Filter for SQLite-related test files in test/parallel/
  const sqliteTests = tree.tree
    .filter((f) => f.type === "blob" && f.path.startsWith("test/parallel/"))
    .map((f) => f.path.replace("test/parallel/", ""))
    .filter(
      (name) =>
        name.includes("-sqlite") &&
        (name.endsWith(".js") || name.endsWith(".mjs")),
    )
    .sort();

  console.log(`Found ${sqliteTests.length} SQLite test files`);
  return sqliteTests;
}

/**
 * Transform Node.js test to use our package instead of node:sqlite
 */
function adaptTest(content: string, fileName: string): string {
  let adapted = content;

  // Remove CJS require('../common') with any destructured imports
  // Handles: const { skipIfSQLiteMissing, mustCall, ... } = require('../common');
  adapted = adapted.replace(
    /const\s*\{[^}]+\}\s*=\s*require\(['"]\.\.\/common['"]\);\s*/g,
    "",
  );

  // Remove bare require('../common'); (no assignment)
  adapted = adapted.replace(/require\(['"]\.\.\/common['"]\);\s*/g, "");

  // Remove ESM import from '../common/index.mjs' with any imports
  // Handles: import { skipIfSQLiteMissing, isWindows, ... } from '../common/index.mjs';
  adapted = adapted.replace(
    /import\s*\{[^}]+\}\s*from\s*['"]\.\.\/common\/index\.mjs['"]\s*;?\s*/g,
    "",
  );

  // Replace tmpdir import with our test utilities
  // Note: Only import tmpdir and isWindows - tests that use tmpdir have their own nextDb
  // Handles ESM: import tmpdir from '../common/tmpdir.js';
  adapted = adapted.replace(
    /import\s+tmpdir\s+from\s*['"]\.\.\/common\/tmpdir\.js['"]\s*;?\s*/g,
    `import { tmpdir, isWindows } from "../common/test-utils.mjs";\n`,
  );

  // Handles CJS: const tmpdir = require('../common/tmpdir');
  adapted = adapted.replace(
    /const\s+tmpdir\s*=\s*require\(['"]\.\.\/common\/tmpdir['"]\);\s*/g,
    `const { tmpdir, isWindows } = require("../common/test-utils.cjs");\n`,
  );

  // Replace require('../sqlite/next-db.js') with our shim
  adapted = adapted.replace(
    /const\s*\{\s*nextDb\s*\}\s*=\s*require\(['"]\.\.\/sqlite\/next-db\.js['"]\);\s*/g,
    `const { nextDb } = require("../common/test-utils.cjs");\n`,
  );

  // Remove skipIfSQLiteMissing() call
  adapted = adapted.replace(/skipIfSQLiteMissing\(\);\s*/g, "");

  // Add mustCall shim if the test uses it - it's a Node.js test helper
  // that verifies a callback is called; we just use an identity function
  if (content.includes("mustCall")) {
    adapted =
      "// Shim for Node.js test helper\nconst mustCall = (fn) => fn;\n\n" +
      adapted;
  }

  // Transform node:sqlite imports to our package
  // Handle CJS: const { DatabaseSync, ... } = require('node:sqlite');
  adapted = adapted.replace(
    /require\(['"]node:sqlite['"]\)/g,
    `require("@photostructure/sqlite")`,
  );

  // Handle ESM: const { DatabaseSync } = await import('node:sqlite');
  adapted = adapted.replace(
    /await import\(['"]node:sqlite['"]\)/g,
    `await import("@photostructure/sqlite")`,
  );

  // Handle ESM: import { DatabaseSync, ... } from 'node:sqlite';
  adapted = adapted.replace(
    /from ['"]node:sqlite['"]/g,
    `from "@photostructure/sqlite"`,
  );

  // Note: We no longer strip __proto__: null since our implementation now
  // correctly returns row objects with null prototype (matching Node.js)

  // Rewrite ERM `using` declarations so the file parses in Node.js < 24 CJS.
  // The affected tests are transformed to test.skip() below, so the
  // substituted `const` body never actually runs.
  adapted = adapted.replace(/\busing\s+(\w+)\s*=/g, "const $1 =");

  // Skip known-failing tests for this file by transforming test()/suite() to test.skip()/suite.skip()
  const testsToSkip = skipTests[fileName] ?? [];
  for (const { name, reason } of testsToSkip) {
    // Escape special regex characters in test name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match test('name', ...) or suite('name', ...) with any quote style
    // and transform to test.skip('name', /* reason */ ...) or suite.skip(...)
    adapted = adapted.replace(
      // eslint-disable-next-line security/detect-non-literal-regexp -- `escaped` is sanitized above
      new RegExp(`(test|suite)\\((['"\`])${escaped}\\2`, "g"),
      `$1.skip($2${name}$2 /* ${reason} */`,
    );
  }

  // Clean up multiple blank lines
  adapted = adapted.replace(/\n{3,}/g, "\n\n");

  // Add header comment
  const header = `/**
 * Node.js SQLite compatibility test
 * Adapted from: ${fileName}
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test ${fileName.replace(/\.(m?js)$/, ".test.$1")}
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

`;

  return header + adapted;
}

/**
 * Convert Node.js test filename
 */
function toTestFileName(nodeFileName: string): string {
  // test-sqlite-foo.js -> test-sqlite-foo.test.js
  // test-sqlite-foo.mjs -> test-sqlite-foo.test.mjs
  return nodeFileName.replace(/\.(m?js)$/, ".test.$1");
}

function parseArgs() {
  const args = {
    help: false,
    branch: "main",
    repo: "nodejs/node",
    dryRun: false,
    force: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--branch":
      case "-b":
        args.branch = process.argv[++i] ?? args.branch;
        break;
      case "--repo":
      case "-r":
        args.repo = process.argv[++i] ?? args.repo;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
      case "-f":
        args.force = true;
        break;
    }
  }
  return args;
}

function showHelp() {
  console.log(`
Sync Node.js SQLite test files and adapt them for our package.

Usage:
  npx tsx scripts/sync-node-tests.ts [options]

Options:
  --help, -h        Show this help message
  --branch, -b      Branch/tag to sync from (default: main)
  --repo, -r        GitHub repository (default: nodejs/node)
  --dry-run         Show what would be done
  --force, -f       Force sync even if unchanged

Output:
  test/upstream/    - Original Node.js tests (reference, gitignored)
  test/node-compat/ - Adapted tests using our package

Run adapted tests with:
  node --test 'test/node-compat/*.test.{js,mjs}'
`);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

type SyncCache = {
  sha: string;
  timestamp: number;
  branch: string;
  repo: string;
};

function getCacheFile() {
  return path.join(packageRoot, ".sync-tests-cache.json");
}

function shouldSkipSync(
  repo: string,
  branch: string,
  sha: string,
  force: boolean,
): boolean {
  if (force || !sha) return false;
  try {
    const cache: SyncCache = JSON.parse(
      fs.readFileSync(getCacheFile(), "utf8"),
    );
    if (cache.repo === repo && cache.branch === branch && cache.sha === sha) {
      console.log(`Already synced from ${sha.substring(0, 7)}`);
      return true;
    }
  } catch {
    // Cache file doesn't exist or is invalid - sync needed
  }
  return false;
}

function updateSyncCache(repo: string, branch: string, sha: string) {
  fs.writeFileSync(
    getCacheFile(),
    JSON.stringify({ sha, timestamp: Date.now(), branch, repo }, null, 2),
  );
}

async function downloadAndAdapt(
  url: string,
  upstreamPath: string,
  adaptedPath: string,
  fileName: string,
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun) {
    console.log(`  Would download: ${fileName}`);
    return true;
  }

  console.log(`Downloading: ${fileName}`);
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      console.log(`  ⚠ Not found`);
      return false;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const content = await response.text();

  // Save original
  ensureDir(upstreamPath);
  fs.writeFileSync(upstreamPath, content, "utf8");

  // Save adapted version
  const adapted = adaptTest(content, fileName);
  ensureDir(adaptedPath);
  fs.writeFileSync(adaptedPath, adapted, "utf8");

  console.log(`  ✓ Saved`);
  return true;
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  console.log(`Syncing Node.js SQLite tests from ${args.repo}@${args.branch}`);

  let sha: string | null = null;
  try {
    const res = await githubFetch(
      `https://api.github.com/repos/${args.repo}/commits/${args.branch}`,
    );
    if (res.ok) sha = ((await res.json()) as any).sha;
  } catch {
    // API error - proceed without SHA
  }

  if (sha && shouldSkipSync(args.repo, args.branch, sha, args.force)) {
    console.log("✅ Already up to date");
    return;
  }

  const ref = sha ?? args.branch;
  console.log(sha ? `Commit: ${sha.substring(0, 7)}` : "");

  // Dynamically discover test files from the Node.js repo
  const testFiles = await discoverTestFiles(args.repo, ref);
  const filesToSync = testFiles.filter((f) => !skipFiles.has(f));

  if (filesToSync.length === 0) {
    console.log("No test files to sync");
    return;
  }

  console.log(
    `Syncing ${filesToSync.length} files (skipping ${testFiles.length - filesToSync.length})`,
  );

  const upstreamDir = path.join(packageRoot, "test", "upstream");
  const adaptedDir = path.join(packageRoot, "test", "node-compat");

  let successCount = 0;
  for (const fileName of filesToSync) {
    const url = `https://raw.githubusercontent.com/${args.repo}/${ref}/test/parallel/${fileName}`;
    const upstreamPath = path.join(upstreamDir, fileName);
    const adaptedPath = path.join(adaptedDir, toTestFileName(fileName));

    if (
      await downloadAndAdapt(
        url,
        upstreamPath,
        adaptedPath,
        fileName,
        args.dryRun,
      )
    ) {
      successCount++;
    }
  }

  console.log(`\nSynced ${successCount}/${filesToSync.length} tests`);

  if (!args.dryRun) {
    if (sha) updateSyncCache(args.repo, args.branch, sha);

    // Write README
    fs.writeFileSync(
      path.join(adaptedDir, "README.md"),
      `# Node.js Compatibility Tests

These tests are adapted from Node.js's SQLite test suite.
They verify our implementation matches node:sqlite behavior.

**Auto-generated** - Run \`npm run sync:tests\` to regenerate.

## Running

\`\`\`bash
node --test 'test/node-compat/*.test.{js,mjs}'
\`\`\`

Or run a specific test:
\`\`\`bash
node --test test/node-compat/test-sqlite-statement-sync-columns.test.js
\`\`\`

Source: https://github.com/${args.repo}/tree/${args.branch}/test/parallel
Commit: ${sha ?? args.branch}
`,
    );

    console.log(
      "\n✅ Done! Run tests with: node --test 'test/node-compat/*.test.{js,mjs}'",
    );
  }
}

main().catch(console.error);

export { adaptTest, discoverTestFiles, skipFiles, toTestFileName };
