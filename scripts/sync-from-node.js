#!/usr/bin/env node

/**
 * Sync Node.js SQLite implementation files into this package.
 * Usage: node scripts/sync-from-node.js [path-to-node-repo]
 */

const fs = require("fs");
const path = require("path");

const nodePath = process.argv[2] || "../node";
const packageRoot = path.join(__dirname, "..");

// Files to copy from Node.js repo
const filesToCopy = [
  // JavaScript interface
  {
    src: "lib/sqlite.js",
    dest: "src/upstream/sqlite.js",
  },
  // C++ implementation
  {
    src: "src/node_sqlite.h",
    dest: "src/upstream/node_sqlite.h",
  },
  {
    src: "src/node_sqlite.cc",
    dest: "src/upstream/node_sqlite.cc",
  },
  // SQLite library
  {
    src: "deps/sqlite/sqlite3.c",
    dest: "src/upstream/sqlite3.c",
  },
  {
    src: "deps/sqlite/sqlite3.h",
    dest: "src/upstream/sqlite3.h",
  },
  {
    src: "deps/sqlite/sqlite3ext.h",
    dest: "src/upstream/sqlite3ext.h",
  },
  // Build config
  {
    src: "deps/sqlite/sqlite.gyp",
    dest: "src/upstream/sqlite.gyp",
  },
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(srcPath, destPath) {
  console.log(`Copying ${srcPath} -> ${destPath}`);
  ensureDir(destPath);
  fs.copyFileSync(srcPath, destPath);
}

function main() {
  if (!fs.existsSync(nodePath)) {
    console.error(`Node.js repo not found at: ${nodePath}`);
    console.error("Usage: node scripts/sync-from-node.js [path-to-node-repo]");
    process.exit(1);
  }

  console.log(`Syncing from Node.js repo: ${nodePath}`);
  console.log(`Package root: ${packageRoot}`);

  for (const file of filesToCopy) {
    const srcPath = path.join(nodePath, file.src);
    const destPath = path.join(packageRoot, file.dest);

    if (!fs.existsSync(srcPath)) {
      console.warn(`Warning: Source file not found: ${srcPath}`);
      continue;
    }

    copyFile(srcPath, destPath);
  }

  console.log("\nSync complete!");
  console.log("\nNext steps:");
  console.log("1. Run `npm run build` to compile the native addon");
  console.log("2. Run `npm test` to verify everything works");
}

if (require.main === module) {
  main();
}

module.exports = { filesToCopy, copyFile, ensureDir };
