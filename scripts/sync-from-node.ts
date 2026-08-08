/**
 * Sync Node.js SQLite implementation files from GitHub into this package.
 *
 * Usage:
 *   npx tsx scripts/sync-from-node.ts [options]
 *
 * Options:
 *   --help, -h        Show this help message
 *   --branch, -b      Specify branch/tag to sync from. When omitted, resolves
 *                     the highest vNN.x-staging branch on nodejs/node via the
 *                     GitHub API (falls back to FALLBACK_STAGING_BRANCH below
 *                     on API failure).
 *   --repo, -r        Specify GitHub repository (default: nodejs/node)
 *   --dry-run         Show what files would be downloaded without actually downloading
 *
 * Examples:
 *   npx tsx scripts/sync-from-node.ts
 *   npx tsx scripts/sync-from-node.ts --branch main
 *   npx tsx scripts/sync-from-node.ts --branch v22.12.0
 *   npx tsx scripts/sync-from-node.ts --dry-run
 */

import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { githubFetch } from "./github-api";

const execAsync = promisify(exec);

// Last-resort default when the GitHub API is unreachable (rate limit, offline,
// etc.). Bump this when a new Node.js major's staging branch becomes the
// supported compatibility target. We sync from `vNN.x-staging` rather than
// `main` so we stay aligned with the stabilized view of the current release
// line; `main` includes the next major's in-flight work.
const FALLBACK_STAGING_BRANCH = "v25.x-staging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

type SyncedFile = {
  src: string; // Source path in Node.js repo
  dest: string; // Destination path in this package
  description: string; // Description of the file
};

// Files to sync from Node.js repo
// Note: SQLite amalgamation files (sqlite3.c, sqlite3.h, sqlite3ext.h) are NOT included
// because we always use the latest SQLite from SQLite.org instead of Node.js's version
const filesToSync: SyncedFile[] = [
  // JavaScript interface
  {
    src: "lib/sqlite.js",
    dest: "src/upstream/sqlite.js",
    description: "Node.js JavaScript SQLite interface",
  },
  // C++ implementation
  {
    src: "src/node_sqlite.h",
    dest: "src/upstream/node_sqlite.h",
    description: "Node.js SQLite C++ header",
  },
  {
    src: "src/node_sqlite.cc",
    dest: "src/upstream/node_sqlite.cc",
    description: "Node.js SQLite C++ implementation",
  },
  // Build config only (SQLite amalgamation files are synced from SQLite.org)
  {
    src: "deps/sqlite/sqlite.gyp",
    dest: "src/upstream/sqlite.gyp",
    description: "SQLite gyp build configuration",
  },
];

// Parse command line arguments
function parseArgs() {
  const args: {
    help: boolean;
    branch: string | null;
    repo: string;
    dryRun: boolean;
    force: boolean;
  } = {
    help: false,
    branch: null,
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
        if (i + 1 < process.argv.length) {
          args.branch = process.argv[++i];
        } else {
          console.error("Error: --branch requires a value");
          process.exit(1);
        }
        break;
      case "--repo":
      case "-r":
        if (i + 1 < process.argv.length) {
          args.repo = process.argv[++i];
        } else {
          console.error("Error: --repo requires a value");
          process.exit(1);
        }
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
      case "-f":
        args.force = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Error: Unknown option ${arg}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }

  return args;
}

/**
 * Resolve the `vNN.x-staging` branch corresponding to the latest RELEASED
 * Node.js major. We deliberately don't pick the highest existing staging
 * branch: Node.js creates `vNN.x-staging` well before `vNN.0.0` actually
 * ships, so a naive "highest branch" pick would drag us into in-flight
 * next-major work. Our compat promise is against released Node.js, so we
 * follow the staging branch for the current stable line.
 *
 * Returns FALLBACK_STAGING_BRANCH if the API call fails (rate limit,
 * network, unexpected response shape).
 */
async function resolveLatestStagingBranch(repo: string): Promise<string> {
  try {
    // /releases/latest returns the newest non-prerelease, non-draft release
    // across all release lines. For nodejs/node that's effectively the
    // latest "current" release (not LTS), which is what our compat target
    // tracks.
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await githubFetch(url, { logRateLimit: false });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const release = (await res.json()) as { tag_name?: string };
    const match = release.tag_name?.match(/^v(\d+)\./);
    if (!match) {
      throw new Error(
        `Unexpected latest-release tag shape: ${release.tag_name}`,
      );
    }
    return `v${match[1]}.x-staging`;
  } catch (err: any) {
    console.log(
      `Warning: Could not resolve latest staging branch (${err.message}); ` +
        `falling back to ${FALLBACK_STAGING_BRANCH}`,
    );
    return FALLBACK_STAGING_BRANCH;
  }
}

function showHelp() {
  const help = `
Sync Node.js SQLite implementation files from GitHub into this package.

Usage:
  node scripts/sync-from-node.mjs [options]

Options:
  --help, -h        Show this help message
  --branch, -b      Specify branch/tag to sync from. When omitted, resolves
                    the highest vNN.x-staging branch on nodejs/node via the
                    GitHub API (fallback: ${FALLBACK_STAGING_BRANCH}).
  --repo, -r        Specify GitHub repository (default: nodejs/node)
  --dry-run         Show what files would be downloaded without actually downloading
  --force, -f       Force sync even if current version is newer

Examples:
  node scripts/sync-from-node.mjs
  node scripts/sync-from-node.mjs --branch main
  node scripts/sync-from-node.mjs --branch v22.12.0
  node scripts/sync-from-node.mjs --dry-run

Files that will be synced:
${filesToSync.map((f) => `  ${f.src} -> ${f.dest}`).join("\n")}
`;
  console.log(help);
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

function shouldSkipSync(
  repo: string,
  branch: string,
  currentSha: string,
  force: boolean,
): boolean {
  if (force) {
    return false; // Never skip if force is enabled
  }

  if (!currentSha) {
    return false; // Can't skip without SHA
  }

  try {
    const cacheFile = path.join(packageRoot, ".sync-cache.json");
    if (!fs.existsSync(cacheFile)) {
      return false; // No cache file, need to sync
    }

    const cache: SyncCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));

    // Check if we have the same repo, branch, and SHA
    if (
      cache.repo === repo &&
      cache.branch === branch &&
      cache.sha === currentSha
    ) {
      const hoursSinceSync = (Date.now() - cache.timestamp) / (1000 * 60 * 60);
      console.log(
        `Last sync was ${hoursSinceSync.toFixed(1)} hours ago with same SHA (${currentSha.substring(0, 7)})`,
      );
      return true; // Skip sync
    }

    return false; // Different SHA or repo/branch, need to sync
  } catch {
    return false; // Error reading cache, need to sync
  }
}

function updateSyncCache(repo: string, branch: string, sha: string) {
  try {
    const cacheFile = path.join(packageRoot, ".sync-cache.json");
    const cache: SyncCache = {
      sha,
      timestamp: Date.now(),
      branch,
      repo,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn("Failed to update sync cache:", error);
  }
}

async function checkRemoteFileChanged(
  url: string,
  localPath: string,
): Promise<boolean> {
  try {
    // Check if local file exists
    if (!fs.existsSync(localPath)) {
      return true; // File doesn't exist locally, need to download
    }

    // Get local file stats
    const localStats = fs.statSync(localPath);

    // Make HEAD request to check remote file info
    const headResponse = await fetch(url, { method: "HEAD" });
    if (!headResponse.ok) {
      return true; // Can't check, assume changed
    }

    // Check ETag if available
    const etag = headResponse.headers.get("etag");
    if (etag) {
      // Store ETags in a simple cache file
      const cacheFile = path.join(packageRoot, ".sync-cache.json");
      let cache: Record<string, string> = {};

      try {
        if (fs.existsSync(cacheFile)) {
          cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        }
      } catch {
        // Ignore cache errors
      }

      const cachedEtag = cache[url];
      if (cachedEtag === etag) {
        return false; // ETags match, no change
      }

      // Update cache with new ETag
      cache[url] = etag;
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
      } catch {
        // Ignore cache write errors
      }
    }

    // Check Last-Modified if available
    const lastModified = headResponse.headers.get("last-modified");
    if (lastModified) {
      const remoteDate = new Date(lastModified);
      if (remoteDate <= localStats.mtime) {
        return false; // Local file is newer or same
      }
    }

    return true; // Assume changed if we can't determine
  } catch {
    return true; // On error, assume file changed
  }
}

async function downloadFile(
  url: string,
  destPath: string,
  description: string,
) {
  try {
    console.log(`Downloading: ${description}`);
    console.log(`  ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    ensureDir(destPath);
    fs.writeFileSync(destPath, content, "utf8");

    const sizeKB = (content.length / 1024).toFixed(1);
    console.log(`  ✓ Saved to ${destPath} (${sizeKB} KB)`);

    return { success: true, content };
  } catch (error: any) {
    console.error(`  ✗ Failed to download ${description}:`);
    console.error(`    ${error.message}`);
    return { success: false };
  }
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  const branch = args.branch ?? (await resolveLatestStagingBranch(args.repo));
  if (!args.branch) {
    console.log(`Resolved default branch: ${branch}`);
  }

  console.log(`Syncing Node.js SQLite files from GitHub`);
  console.log(`Repository: ${args.repo}`);
  console.log(`Branch/Tag: ${branch}`);
  console.log(`Package root: ${packageRoot}`);

  if (args.dryRun) {
    console.log(`\n🔍 DRY RUN - No files will be downloaded\n`);
  } else {
    console.log();
  }

  let successCount = 0;
  const totalCount = filesToSync.length;
  let nodeVersion: string | null = null;
  let nodeCommitSha: string | null = null;

  // Fetch Node.js version and commit info
  try {
    // Get commit SHA using authenticated fetch
    const commitUrl = `https://api.github.com/repos/${args.repo}/commits/${branch}`;
    const commitResponse = await githubFetch(commitUrl);

    if (commitResponse.ok) {
      const commitData = (await commitResponse.json()) as any;
      nodeCommitSha = commitData.sha; // Full SHA for file fetching
    }

    // Only parse node_version.h for release tags (e.g., v25.8.1), not staging
    // branches — staging branches have version numbers bumped ahead of the
    // actual release, so the parsed version would be misleading.
    const isReleaseTag = /^v\d+\.\d+\.\d+$/.test(branch);

    if (isReleaseTag) {
      nodeVersion = branch;
    } else {
      const versionRef = nodeCommitSha || branch;
      const versionUrl = `https://raw.githubusercontent.com/${args.repo}/${versionRef}/src/node_version.h`;
      const versionResponse = await fetch(versionUrl);
      if (versionResponse.ok) {
        const versionContent = await versionResponse.text();
        const majorMatch = versionContent.match(
          /#define NODE_MAJOR_VERSION (\d+)/,
        );
        const minorMatch = versionContent.match(
          /#define NODE_MINOR_VERSION (\d+)/,
        );
        const patchMatch = versionContent.match(
          /#define NODE_PATCH_VERSION (\d+)/,
        );

        if (majorMatch && minorMatch && patchMatch) {
          // Use the branch name, not the (potentially unreleased) version
          // from the header. The commit SHA suffix provides traceability.
          nodeVersion = branch;
        }
      }
    }
  } catch (err: any) {
    console.log(
      `Warning: Could not fetch Node.js version info: ${err.message}`,
    );
  }

  console.log(
    `Node.js version: ${nodeVersion || "unknown"} (${nodeCommitSha?.substring(0, 7) || branch})`,
  );

  // Check if we should skip the entire sync based on SHA
  if (
    nodeCommitSha &&
    shouldSkipSync(args.repo, branch, nodeCommitSha, args.force)
  ) {
    console.log("✅ No sync needed - files are already up to date");
    return;
  }

  // Note: SQLite version checking removed since we sync SQLite files from SQLite.org, not Node.js

  for (const file of filesToSync) {
    // Use commit SHA for consistency, fallback to branch if SHA not available
    const ref = nodeCommitSha || branch;
    const url = `https://raw.githubusercontent.com/${args.repo}/${ref}/${file.src}`;
    const destPath = path.join(packageRoot, file.dest);

    if (args.dryRun) {
      console.log(`Would download: ${file.description}`);
      console.log(`  ${url} -> ${destPath}`);
      successCount++;
    } else {
      // Check if file has changed before downloading
      const hasChanged = await checkRemoteFileChanged(url, destPath);
      if (!hasChanged && !args.force) {
        console.log(`Skipping: ${file.description} (no changes detected)`);
        console.log();
        continue;
      }

      const result = await downloadFile(url, destPath, file.description);
      if (result.success) {
        successCount++;
      }
    }
    console.log();
  }

  console.log(
    `${args.dryRun ? "Would sync" : "Synced"} ${successCount}/${totalCount} files successfully`,
  );

  if (!args.dryRun && successCount === totalCount) {
    // Update versions in package.json
    if (nodeVersion || nodeCommitSha) {
      // Always update Node.js version if we have it
      try {
        const nodeVersionString =
          (nodeVersion || branch) +
          (nodeCommitSha ? `@${nodeCommitSha.substring(0, 7)}` : "");
        await execAsync(`npm pkg set versions.nodejs="${nodeVersionString}"`, {
          cwd: packageRoot,
        });
        console.log(
          `\nUpdated package.json with Node.js version ${nodeVersionString}`,
        );
      } catch (err: any) {
        console.error("Failed to update Node.js version:", err.message);
      }
    }

    // Note: SQLite version update removed since we sync SQLite files from SQLite.org, not Node.js

    // Update README.md with the Node.js version (only for release tags,
    // not staging branches where the version would be misleading)
    const isReleaseTag = /^v\d+\.\d+\.\d+$/.test(nodeVersion || "");
    if (nodeVersion && isReleaseTag) {
      try {
        const readmePath = path.join(packageRoot, "README.md");
        let readme = fs.readFileSync(readmePath, "utf8");
        // Update "Synced with Node.js vXX.X.X" pattern
        readme = readme.replace(
          /Synced with Node\.js v[\d.]+/g,
          `Synced with Node.js ${nodeVersion}`,
        );
        // Update "compatible with Node.js vXX.X.X" pattern
        readme = readme.replace(
          /compatible with Node\.js v[\d.]+ built-in/g,
          `compatible with Node.js ${nodeVersion} built-in`,
        );
        fs.writeFileSync(readmePath, readme);
        console.log(`Updated README.md with Node.js version ${nodeVersion}`);
      } catch (err: any) {
        console.error("Failed to update README.md:", err.message);
      }
    } else if (nodeVersion) {
      console.log(
        `Skipping README.md version update (synced from ${nodeVersion}, not a release tag)`,
      );
    }

    // Update sync cache with the current SHA
    if (nodeCommitSha) {
      updateSyncCache(args.repo, branch, nodeCommitSha);
    }

    console.log("\n✅ Sync complete!");
    console.log("\nNext steps:");
    console.log(
      "1. Run `npm run build:native` to ensure the native addon compiles",
    );
    console.log("2. Run `npm test` to verify everything works");
    console.log(
      "3. Update CHANGELOG.md with the new Node.js version before release",
    );
  } else if (!args.dryRun && successCount < totalCount) {
    console.log(`\n⚠️  ${totalCount - successCount} files failed to download`);
    console.log("Some files may be missing from the specified branch/tag.");
    console.log("Try using a different branch with --branch option.");
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
  process.exit(1);
});

// Only sync when invoked as a script. sync-node-tests.ts imports
// resolveLatestStagingBranch() from here so both syncs target the same branch;
// without this guard that import would kick off a full source sync.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}

export { downloadFile, ensureDir, filesToSync, resolveLatestStagingBranch };
