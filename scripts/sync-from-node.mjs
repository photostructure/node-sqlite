#!/usr/bin/env node

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

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

// Files to sync from Node.js repo
const filesToSync = [
  // JavaScript interface
  {
    src: "lib/sqlite.js",
    dest: "src/upstream/sqlite.js",
    description: "Node.js JavaScript SQLite interface"
  },
  // C++ implementation
  {
    src: "src/node_sqlite.h",
    dest: "src/upstream/node_sqlite.h",
    description: "Node.js SQLite C++ header"
  },
  {
    src: "src/node_sqlite.cc",
    dest: "src/upstream/node_sqlite.cc",
    description: "Node.js SQLite C++ implementation"
  },
  // SQLite library
  {
    src: "deps/sqlite/sqlite3.c",
    dest: "src/upstream/sqlite3.c",
    description: "SQLite3 amalgamation source"
  },
  {
    src: "deps/sqlite/sqlite3.h",
    dest: "src/upstream/sqlite3.h",
    description: "SQLite3 header file"
  },
  {
    src: "deps/sqlite/sqlite3ext.h",
    dest: "src/upstream/sqlite3ext.h",
    description: "SQLite3 extension header"
  },
  // Build config
  {
    src: "deps/sqlite/sqlite.gyp",
    dest: "src/upstream/sqlite.gyp",
    description: "SQLite gyp build configuration"
  },
];

// Parse command line arguments
function parseArgs() {
  const args = {
    help: false,
    branch: 'v24.x-staging',
    repo: 'nodejs/node',
    dryRun: false
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--branch':
      case '-b':
        if (i + 1 < process.argv.length) {
          args.branch = process.argv[++i];
        } else {
          console.error('Error: --branch requires a value');
          process.exit(1);
        }
        break;
      case '--repo':
      case '-r':
        if (i + 1 < process.argv.length) {
          args.repo = process.argv[++i];
        } else {
          console.error('Error: --repo requires a value');
          process.exit(1);
        }
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) {
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

Examples:
  node scripts/sync-from-node.mjs
  node scripts/sync-from-node.mjs --branch main
  node scripts/sync-from-node.mjs --branch v22.12.0
  node scripts/sync-from-node.mjs --dry-run

Files that will be synced:
${filesToSync.map(f => `  ${f.src} -> ${f.dest}`).join('\n')}
`;
  console.log(help);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function downloadFile(url, destPath, description) {
  try {
    console.log(`Downloading: ${description}`);
    console.log(`  ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const content = await response.text();
    
    ensureDir(destPath);
    fs.writeFileSync(destPath, content, 'utf8');
    
    const sizeKB = (content.length / 1024).toFixed(1);
    console.log(`  ✓ Saved to ${destPath} (${sizeKB} KB)`);
    
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to download ${description}:`);
    console.error(`    ${error.message}`);
    return false;
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
  let totalCount = filesToSync.length;

  for (const file of filesToSync) {
    const url = `https://raw.githubusercontent.com/${args.repo}/${args.branch}/${file.src}`;
    const destPath = path.join(packageRoot, file.dest);
    
    if (args.dryRun) {
      console.log(`Would download: ${file.description}`);
      console.log(`  ${url} -> ${destPath}`);
      successCount++;
    } else {
      const success = await downloadFile(url, destPath, file.description);
      if (success) {
        successCount++;
      }
    }
    console.log();
  }

  console.log(`${args.dryRun ? 'Would sync' : 'Synced'} ${successCount}/${totalCount} files successfully`);
  
  if (!args.dryRun && successCount === totalCount) {
    console.log("\n✅ Sync complete!");
    console.log("\nNext steps:");
    console.log("1. Run `npm run build` to compile the native addon");
    console.log("2. Run `npm test` to verify everything works");
  } else if (!args.dryRun && successCount < totalCount) {
    console.log(`\n⚠️  ${totalCount - successCount} files failed to download`);
    console.log("Some files may be missing from the specified branch/tag.");
    console.log("Try using a different branch with --branch option.");
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});

export { filesToSync, downloadFile, ensureDir };
