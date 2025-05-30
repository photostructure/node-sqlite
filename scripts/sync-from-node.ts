/**
 * Sync Node.js SQLite implementation files from GitHub into this package.
 *
 * Usage:
 *   node scripts/sync-from-node.mjs [options]
 *
 * Options:
 *   --help, -h        Show this help message
 *   --branch, -b      Specify branch/tag to sync from (default: v24.x-staging)
 *   --repo, -r        Specify GitHub repository (default: nodejs/node)
 *   --dry-run         Show what files would be downloaded without actually downloading
 *
 * Examples:
 *   node scripts/sync-from-node.mjs
 *   node scripts/sync-from-node.mjs --branch main
 *   node scripts/sync-from-node.mjs --branch v22.12.0
 *   node scripts/sync-from-node.mjs --dry-run
 */

import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  compareSqliteVersions,
  getCurrentSqliteVersion,
  getSqliteVersionFromContent,
  updateSqliteVersion,
} from "./version-utils";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

// Files to sync from Node.js repo
const filesToSync = [
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
  // SQLite library
  {
    src: "deps/sqlite/sqlite3.c",
    dest: "src/upstream/sqlite3.c",
    description: "SQLite3 amalgamation source",
  },
  {
    src: "deps/sqlite/sqlite3.h",
    dest: "src/upstream/sqlite3.h",
    description: "SQLite3 header file",
  },
  {
    src: "deps/sqlite/sqlite3ext.h",
    dest: "src/upstream/sqlite3ext.h",
    description: "SQLite3 extension header",
  },
  // Build config
  {
    src: "deps/sqlite/sqlite.gyp",
    dest: "src/upstream/sqlite.gyp",
    description: "SQLite gyp build configuration",
  },
];

// Parse command line arguments
function parseArgs() {
  const args = {
    help: false,
    branch: "v24.x-staging",
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

function showHelp() {
  const help = `
Sync Node.js SQLite implementation files from GitHub into this package.

Usage:
  node scripts/sync-from-node.mjs [options]

Options:
  --help, -h        Show this help message
  --branch, -b      Specify branch/tag to sync from (default: v24.x-staging)
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

  console.log(`Syncing Node.js SQLite files from GitHub`);
  console.log(`Repository: ${args.repo}`);
  console.log(`Branch/Tag: ${args.branch}`);
  console.log(`Package root: ${packageRoot}`);

  if (args.dryRun) {
    console.log(`\n🔍 DRY RUN - No files will be downloaded\n`);
  } else {
    console.log();
  }

  let successCount = 0;
  let skippedCount = 0;
  let totalCount = filesToSync.length;
  let nodeSqliteVersion: string | null = null;
  let nodeVersion: string | null = null;
  let nodeCommitSha: string | null = null;
  let currentSqliteVersion = await getCurrentSqliteVersion();
  let sqliteFiles = [
    "deps/sqlite/sqlite3.c",
    "deps/sqlite/sqlite3.h",
    "deps/sqlite/sqlite3ext.h",
  ];
  let skipSqliteFiles = false;

  // Fetch Node.js version and commit info
  try {
    // Get commit SHA
    const commitUrl = `https://api.github.com/repos/${args.repo}/commits/${args.branch}`;
    const commitResponse = await fetch(commitUrl);
    if (commitResponse.ok) {
      const commitData = (await commitResponse.json()) as any;
      nodeCommitSha = commitData.sha?.substring(0, 7); // Short SHA
    }

    // Get Node.js version from src/node_version.h
    const versionUrl = `https://raw.githubusercontent.com/${args.repo}/${args.branch}/src/node_version.h`;
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
        nodeVersion = `v${majorMatch[1]}.${minorMatch[1]}.${patchMatch[1]}`;
      }
    }
  } catch (err: any) {
    console.log(
      `Warning: Could not fetch Node.js version info: ${err.message}`,
    );
  }

  console.log(
    `Node.js version: ${nodeVersion || "unknown"} (${nodeCommitSha || args.branch})`,
  );

  // First, check if we should skip SQLite files by checking the version
  if (currentSqliteVersion && !args.force) {
    // Download sqlite3.c temporarily to check version
    const sqliteUrl = `https://raw.githubusercontent.com/${args.repo}/${args.branch}/deps/sqlite/sqlite3.c`;
    try {
      const response = await fetch(sqliteUrl);
      if (response.ok) {
        const content = await response.text();
        nodeSqliteVersion = getSqliteVersionFromContent(content);

        if (nodeSqliteVersion) {
          const comparison = compareSqliteVersions(
            currentSqliteVersion,
            nodeSqliteVersion,
          );
          if (comparison > 0) {
            console.log(
              `\n⚠️  WARNING: Current SQLite version (${currentSqliteVersion}) is newer than Node.js version (${nodeSqliteVersion})!`,
            );
            if (!args.force) {
              console.log(
                "  Skipping SQLite amalgamation files (sqlite3.c, sqlite3.h, sqlite3ext.h)",
              );
              console.log("  To sync these files anyway, use --force");
              console.log();
              skipSqliteFiles = true;
            } else {
              console.log("  Forcing sync of SQLite files as requested");
              console.log();
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors during version check
    }
  }

  for (const file of filesToSync) {
    // Skip SQLite files if version is newer
    if (skipSqliteFiles && sqliteFiles.includes(file.src)) {
      console.log(`Skipping: ${file.description} (current version is newer)`);
      skippedCount++;
      console.log();
      continue;
    }

    const url = `https://raw.githubusercontent.com/${args.repo}/${args.branch}/${file.src}`;
    const destPath = path.join(packageRoot, file.dest);

    if (args.dryRun) {
      console.log(`Would download: ${file.description}`);
      console.log(`  ${url} -> ${destPath}`);
      successCount++;
    } else {
      const result = await downloadFile(url, destPath, file.description);
      if (result.success) {
        successCount++;
      }
    }
    console.log();
  }

  const actualTotal = totalCount - skippedCount;
  console.log(
    `${args.dryRun ? "Would sync" : "Synced"} ${successCount}/${actualTotal} files successfully`,
  );
  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} files (current version is newer)`);
  }

  if (!args.dryRun && successCount === actualTotal) {
    // Update versions in package.json
    if (nodeVersion || nodeCommitSha) {
      // Always update Node.js version if we have it
      try {
        const nodeVersionString =
          (nodeVersion || args.branch) +
          (nodeCommitSha ? `@${nodeCommitSha}` : "");
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

    if (nodeSqliteVersion && !skipSqliteFiles) {
      // Update SQLite version only if we synced SQLite files
      await updateSqliteVersion(nodeSqliteVersion, "node", {
        branch: args.branch,
        nodeVersion: nodeVersion || undefined,
        commitSha: nodeCommitSha || undefined,
      });
    }

    console.log("\n✅ Sync complete!");
    if (skippedCount > 0) {
      console.log(
        `\nNote: ${skippedCount} SQLite amalgamation files were skipped because the current version is newer.`,
      );
      console.log("Use --force to sync these files anyway.");
    }
    console.log("\nNext steps:");
    console.log("1. Run `npm run build` to compile the native addon");
    console.log("2. Run `npm test` to verify everything works");
  } else if (!args.dryRun && successCount < actualTotal) {
    console.log(`\n⚠️  ${actualTotal - successCount} files failed to download`);
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

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});

export { downloadFile, ensureDir, filesToSync };
