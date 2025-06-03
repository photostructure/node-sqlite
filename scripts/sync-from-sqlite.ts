import { exec } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  compareSqliteVersions,
  getCurrentSqliteVersion,
  updateSqliteVersion,
} from "./version-utils";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const SQLITE_TAGS_URL = "https://api.github.com/repos/sqlite/sqlite/tags";
const UPSTREAM_DIR = path.join(__dirname, "../src/upstream");
const TEMP_DIR = path.join(__dirname, "../.temp-sqlite-download");

/**
 * Fetch a URL and return its content
 */
async function fetchUrl(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "node-sqlite-sync-script",
        ...headers,
      },
    };

    https
      .get(url, options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * Get the latest release version from GitHub tags
 */
async function getLatestReleaseVersion(): Promise<{
  version: string;
  semver: string;
} | null> {
  try {
    console.log("Fetching SQLite tags from GitHub...");
    const tagsJson = await fetchUrl(SQLITE_TAGS_URL);
    const tags = JSON.parse(tagsJson);

    // Filter for version tags (e.g., "version-3.50.0")
    const versionTags = tags
      .filter((tag: any) => tag.name.startsWith("version-"))
      .map((tag: any) => {
        const match = tag.name.match(/version-(\d+)\.(\d+)\.(\d+)/);
        if (match) {
          return {
            name: tag.name,
            major: parseInt(match[1]),
            minor: parseInt(match[2]),
            patch: parseInt(match[3]),
            semver: `${match[1]}.${match[2]}.${match[3]}`,
          };
        }
        return null;
      })
      .filter(Boolean);

    if (versionTags.length === 0) {
      return null;
    }

    // Sort by version (major, minor, patch) in descending order
    versionTags.sort((a: any, b: any) => {
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== b.minor) return b.minor - a.minor;
      return b.patch - a.patch;
    });

    const latest = versionTags[0];
    return {
      version: getSqliteVersionNumber(latest.semver),
      semver: latest.semver,
    };
  } catch (err) {
    console.error("Failed to fetch tags:", err);
    return null;
  }
}

/**
 * Download a file from URL to destination
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          // Consume the response to free up the socket
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const file = createWriteStream(dest);
        pipeline(res, file)
          .then(() => resolve())
          .catch(reject);
      })
      .on("error", reject);
  });
}

/**
 * Convert semver format (3.47.0) to SQLite download format (3470000)
 */
function semverToSqliteFormat(semver: string) {
  const parts = semver.trim().split(".");
  if (parts.length < 2) {
    throw new Error(`Invalid version format: ${semver}`);
  }

  const major = parseInt(parts[0]);
  const minor = parseInt(parts[1]).toString().padStart(2, "0");
  const patch = (parts[2] ? parseInt(parts[2]) : 0).toString().padStart(2, "0");
  const subpatch = "00"; // Usually 00 for releases

  return `${major}${minor}${patch}${subpatch}`;
}

/**
 * Get SQLite version number for amalgamation
 */
function getSqliteVersionNumber(semver: string) {
  return semverToSqliteFormat(semver);
}

/**
 * Extract version info from version number
 */
function parseVersion(versionStr: string) {
  // SQLite version format: XYYZZAA
  // X = major (3)
  // YY = minor (two digits)
  // ZZ = patch (two digits)
  // AA = sub-patch (two digits)
  const major = parseInt(versionStr[0]);
  const minor = parseInt(versionStr.substring(1, 3));
  const patch = parseInt(versionStr.substring(3, 5));
  const subpatch = parseInt(versionStr.substring(5, 7));

  return {
    full: versionStr,
    major,
    minor,
    patch,
    subpatch,
    formatted: `${major}.${minor}.${patch}`,
  };
}

/**
 * Try to download from a URL, return false if 404
 */
async function tryDownloadFile(url: string, dest: string) {
  try {
    await downloadFile(url, dest);
    return true;
  } catch (err: any) {
    if (err.message.includes("404") || err.message.includes("HTTP 404")) {
      return false;
    }
    throw err;
  }
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Fetch the latest SQLite amalgamation from sqlite.org

Usage:
  node scripts/fetch-sqlite-amalgamation.mjs [options]

Options:
  --help        Show this help message
  --force       Force download even if current version is newer

This script:
1. Fetches the latest SQLite version from GitHub
2. Downloads the amalgamation ZIP from sqlite.org
3. Extracts sqlite3.c, sqlite3.h, and sqlite3ext.h
4. Warns if the current version is newer than the download
`);
}

/**
 * Main function
 */
async function main() {
  // Check for help flag
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // Get the latest release version from GitHub tags
  const latestRelease = await getLatestReleaseVersion();
  if (!latestRelease) {
    throw new Error(
      "Could not determine latest SQLite release version from GitHub tags",
    );
  }

  console.log(`Latest SQLite release: ${latestRelease.semver}`);

  const version = latestRelease.version;
  const versionInfo = parseVersion(version);

  console.log(`Amalgamation version: ${versionInfo.formatted}`);

  // Check if we already have this version
  const currentVersion = await getCurrentSqliteVersion();
  if (currentVersion) {
    console.log(`Current SQLite version: ${currentVersion}`);

    // Compare versions
    const comparison = compareSqliteVersions(
      currentVersion,
      versionInfo.formatted,
    );
    if (comparison === 0) {
      console.log("\n✅ SQLite is already up to date!");
      process.exit(0);
    } else if (comparison > 0) {
      console.log(
        "\n⚠️  WARNING: Current SQLite version is newer than the latest amalgamation.",
      );
      console.log(
        "You may want to keep the current version or sync from Node.js instead.",
      );

      if (!process.argv.includes("--force")) {
        console.log("Use --force to proceed anyway.");
        process.exit(0);
      }
    }
  }

  // Create temp directory
  console.log("Setting up temporary directory...");
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  // Download amalgamation - try current year first, then previous year
  const zipPath = path.join(TEMP_DIR, "amalgamation.zip");
  console.log(`Downloading SQLite amalgamation...`);

  let downloadSuccess = false;
  const currentYear = new Date().getFullYear();

  // Try current year
  let amalgamationUrl = `https://www.sqlite.org/${currentYear}/sqlite-amalgamation-${version}.zip`;
  console.log(`Trying ${currentYear}...`);
  downloadSuccess = await tryDownloadFile(amalgamationUrl, zipPath);

  // If failed, try previous year
  if (!downloadSuccess) {
    const previousYear = currentYear - 1;
    amalgamationUrl = `https://www.sqlite.org/${previousYear}/sqlite-amalgamation-${version}.zip`;
    console.log(`Trying ${previousYear}...`);
    downloadSuccess = await tryDownloadFile(amalgamationUrl, zipPath);
  }

  if (!downloadSuccess) {
    throw new Error(
      "Could not download SQLite amalgamation from current or previous year directories",
    );
  }

  // Extract ZIP
  console.log("Extracting amalgamation...");
  await execAsync(`unzip -q "${zipPath}" -d "${TEMP_DIR}"`);

  // Find extracted directory
  const entries = await fs.readdir(TEMP_DIR);
  const extractedDir = entries.find((e) =>
    e.startsWith("sqlite-amalgamation-"),
  );
  if (!extractedDir) {
    throw new Error("Could not find extracted amalgamation directory");
  }

  const sourcePath = path.join(TEMP_DIR, extractedDir);

  // Copy files to upstream
  console.log("Copying amalgamation files...");
  const filesToCopy = ["sqlite3.c", "sqlite3.h", "sqlite3ext.h"];

  for (const file of filesToCopy) {
    const src = path.join(sourcePath, file);
    const dest = path.join(UPSTREAM_DIR, file);

    // Check if file exists in source
    try {
      await fs.access(src);
      await fs.copyFile(src, dest);
      console.log(`  Copied ${file}`);
    } catch (err) {
      console.log(`  Skipped ${file} (not found in amalgamation)`);
    }
  }

  // Update SQLite version in package.json
  await updateSqliteVersion(versionInfo.formatted, "amalgamation");

  // Clean up
  console.log("Cleaning up...");
  await fs.rm(TEMP_DIR, { recursive: true, force: true });

  console.log(
    `\nSuccessfully updated SQLite to version ${versionInfo.formatted}`,
  );
}

// Run if executed directly
if (
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

export { main as fetchSqliteAmalgamation };
