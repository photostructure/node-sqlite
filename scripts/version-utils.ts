import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, "..");

interface PackageJson {
  versions?: {
    sqlite?: string;
    nodejs?: string;
  };
  [key: string]: unknown;
}

interface UpdateInfo {
  branch?: string;
  nodeVersion?: string;
  commitSha?: string;
}

/**
 * Get the current SQLite version from package.json or sqlite3.c
 */
export async function getCurrentSqliteVersion(): Promise<string | null> {
  try {
    // Import package.json to check version
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonContent) as PackageJson;

    if (packageJson.versions?.sqlite) {
      return packageJson.versions.sqlite;
    }
  } catch (err) {
    // Package.json read failed
  }

  try {
    // Fall back to checking sqlite3.c file
    const sqlitePath = path.join(packageRoot, "src/upstream/sqlite3.c");
    const content = await fs.readFile(sqlitePath, "utf8");

    // Look for SQLITE_VERSION in the file
    const versionMatch = content.match(/#define\s+SQLITE_VERSION\s+"([^"]+)"/);
    if (versionMatch) {
      return versionMatch[1];
    }
  } catch (err) {
    // File doesn't exist or can't be read
  }

  return null;
}

/**
 * Update SQLite version in package.json
 */
export async function updateSqliteVersion(
  sqliteVersion: string,
  source: "node" | "amalgamation",
  additionalInfo: UpdateInfo = {},
): Promise<void> {
  try {
    await execAsync(`npm pkg set versions.sqlite="${sqliteVersion}"`, {
      cwd: packageRoot,
    });

    if (source === "node" && additionalInfo.nodeVersion) {
      const nodeVersionString =
        additionalInfo.nodeVersion +
        (additionalInfo.commitSha ? `@${additionalInfo.commitSha}` : "");
      await execAsync(`npm pkg set versions.nodejs="${nodeVersionString}"`, {
        cwd: packageRoot,
      });
    }

    console.log(
      `\nUpdated package.json with SQLite version ${sqliteVersion}${source === "node" ? ` from Node.js ${additionalInfo.nodeVersion || additionalInfo.branch}` : ""}`,
    );
  } catch (err) {
    console.error("Failed to update package.json:", (err as Error).message);
  }
}

/**
 * Compare two SQLite version strings
 * @returns 1 if version1 > version2, -1 if version1 < version2, 0 if equal
 */
export function compareSqliteVersions(
  version1: string,
  version2: string,
): number {
  const v1Parts = version1.split(".").map((n) => parseInt(n));
  const v2Parts = version2.split(".").map((n) => parseInt(n));

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const p1 = v1Parts[i] || 0;
    const p2 = v2Parts[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

/**
 * Extract SQLite version from sqlite3.c content
 */
export function getSqliteVersionFromContent(content: string): string | null {
  const versionMatch = content.match(/#define\s+SQLITE_VERSION\s+"([^"]+)"/);
  return versionMatch ? versionMatch[1] : null;
}
