#!/usr/bin/env tsx

/**
 * Security check script to find potential command injection vulnerabilities
 * Specifically looks for execSync/exec with dynamic paths
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const patterns = [
  // Pattern: execSync with string concatenation or template literals (actual injection risk)
  /\bexecSync\s*\(\s*[`"'].*\$\{/, // Template literal with interpolation
  /\bexecSync\s*\([^'"`]+\+/, // String concatenation
  /\bexecSync\s*\([^)+]*\+[^)]+\)/, // Concatenation inside call
];

const excludeDirs = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  "prebuilds",
  "vendored",
  ".git",
]);

const fileExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name)) {
        yield* walkFiles(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = entry.name.substring(entry.name.lastIndexOf("."));
      if (fileExtensions.has(ext)) {
        yield fullPath;
      }
    }
  }
}

async function findSecurityIssues(): Promise<void> {
  console.log(
    "🔍 Scanning for potential command injection vulnerabilities...\n",
  );

  let issuesFound = false;

  for await (const file of walkFiles(".")) {
    try {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            // Check if it's a false positive (literal string)
            if (!line.includes('execSync("') && !line.includes("execSync('")) {
              const relativePath = relative(".", file);
              console.log(`❌ ${relativePath}:${index + 1}`);
              console.log(`   ${line.trim()}`);
              console.log(
                "   ⚠️  Use execFileSync() instead of exec" +
                  "Sync() with dynamic paths\n",
              );
              issuesFound = true;
            }
          }
        }
      });
    } catch {
      // Ignore files that can't be read
    }
  }

  if (!issuesFound) {
    console.log("✅ No command injection vulnerabilities found!");
  } else {
    console.log("💡 Fix suggestion:");
    console.log("   Replace: exec" + "Sync(scriptPath, { stdio: 'inherit' })");
    console.log(
      "   With:    execFileSync('/bin/bash', [scriptPath], { stdio: 'inherit' })",
    );
    process.exit(1);
  }
}

findSecurityIssues().catch((error) => {
  console.error("Error running security check:", error);
  process.exit(1);
});
