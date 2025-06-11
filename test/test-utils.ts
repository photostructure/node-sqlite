import { afterAll, afterEach, beforeAll, beforeEach } from "@jest/globals";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "../src";
import {
  getTestTimeout,
  getTimingMultiplier,
  isAlpineLinux,
  isEmulated,
} from "./test-timeout-config";

export { getTestTimeout, getTimingMultiplier, isAlpineLinux, isEmulated };

/**
 * Helper to get __dirname in both CJS and ESM environments
 * Call it without arguments and it will auto-detect the environment
 */
export function getDirname(): string {
  // In CJS, __dirname is available
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }

  // In ESM with Jest, we need to extract from stack trace
  const e = new Error();
  const stack = e.stack ?? "";

  // Look for the calling file in the stack trace
  const frames = stack.split("\n");
  for (const frame of frames) {
    // Skip getDirname itself
    if (frame.includes("getDirname")) continue;

    // Try to extract file path from the frame
    // Split the logic to avoid complex regex backtracking
    let pathMatch: RegExpMatchArray | null = null;

    // First try direct path: "at /path/file.js:1:1"
    pathMatch = frame.match(/at\s+(?:file:\/\/)?([^:\s()]+):\d+:\d+$/);

    // If not found, try with function name: "at functionName (/path/file.js:1:1)"
    if (!pathMatch) {
      pathMatch = frame.match(/\((?:file:\/\/)?([^:)]+):\d+:\d+\)$/);
    }

    const match = pathMatch;
    if (match && match[1]) {
      let filePath = match[1];
      // Handle file:// URLs
      if (filePath.startsWith("file://")) {
        filePath = fileURLToPath(filePath);
      }
      return path.dirname(filePath);
    }
  }

  throw new Error("Unable to determine directory");
}

/**
 * Manages temporary directories for tests with automatic cleanup
 */
export class TempDir {
  tempDir = "";
  private readonly additionalFiles = new Set<string>();

  /**
   * Set up temp directory management with beforeEach/afterEach hooks
   */
  static perTest(prefix = "sqlite-test-", _options?: any) {
    const instance = new TempDir();

    beforeEach(() => {
      instance.tempDir = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}-`,
        ),
      );
    });

    afterEach(async () => {
      await instance.cleanup();
    }, getTestTimeout());

    // Return object that supports destructuring
    return {
      get tempDir() {
        return instance.tempDir;
      },
      getDbPath: (name?: string) => instance.getDbPath(name),
      closeDatabases: (...dbs: any[]) => instance.closeDatabases(...dbs),
      addFile: (filePath: string) => instance.addFile(filePath),
      writeWorkerScript: (name: string, code: string) =>
        instance.writeWorkerScript(name, code),
      removeFile: (filePath: string) => instance.removeFile(filePath),
    };
  }

  /**
   * Set up temp directory management with beforeAll/afterAll hooks
   */
  static perSuite(prefix = "sqlite-suite-", _options?: any) {
    const instance = new TempDir();

    beforeAll(() => {
      instance.tempDir = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}-`,
        ),
      );
    });

    afterAll(async () => {
      // Extra wait on Windows for file handles
      if (process.platform === "win32") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await instance.cleanup();
    }, getTestTimeout());

    // Return object that supports destructuring
    return {
      get tempDir() {
        return instance.tempDir;
      },
      getDbPath: (name?: string) => instance.getDbPath(name),
      closeDatabases: (...dbs: any[]) => instance.closeDatabases(...dbs),
      addFile: (filePath: string) => instance.addFile(filePath),
      writeWorkerScript: (name: string, code: string) =>
        instance.writeWorkerScript(name, code),
      removeFile: (filePath: string) => instance.removeFile(filePath),
    };
  }

  getDbPath(name = "test.db"): string {
    return path.join(this.tempDir, name);
  }

  closeDatabases(
    ...dbs: Array<InstanceType<typeof DatabaseSync> | undefined | null>
  ): void {
    for (const db of dbs) {
      try {
        if (db && typeof db.close === "function") {
          db.close();
        }
      } catch (err) {
        // Log but don't throw during cleanup
        if (process.platform === "win32" || process.env.DEBUG_CLEANUP) {
          console.log(`Warning: Error closing database: ${err}`);
        }
      }
    }
  }

  addFile(filePath: string): void {
    this.additionalFiles.add(filePath);
  }

  writeWorkerScript(name: string, code: string): string {
    const scriptPath = path.join(this.tempDir, name);
    fs.writeFileSync(scriptPath, code);
    this.additionalFiles.add(scriptPath);
    return scriptPath;
  }

  async removeFile(filePath: string): Promise<void> {
    await rm(filePath);
    this.additionalFiles.delete(filePath);
  }

  private async cleanup(): Promise<void> {
    if (!this.tempDir) return;
    await rm(this.tempDir);
    this.additionalFiles.clear();
    this.tempDir = "";
  }
}

// Export the old function names for backward compatibility
export const useTempDir = TempDir.perTest;
export const useTempDirSuite = TempDir.perSuite;

/**
 * Helper to create a test database with optional initial schema
 */
/**
 * Generates a unique table name for testing to avoid conflicts
 * @param prefix - Optional prefix for the table name (default: "test_table")
 * @returns A unique table name safe for concurrent tests
 */
export function getUniqueTableName(prefix = "test_table"): string {
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${random}`;
}

export function createTestDb(
  dbPath: string,
  schema?: string,
): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(dbPath);
  if (schema) {
    db.exec(schema);
  }
  return db;
}

/**
 * Generate unique database filename for tests
 */
export function uniqueDbName(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
}

/**
 * Windows-safe file removal utility with retry logic
 * @param filePath - Path to the file to remove
 * @param options - Optional configuration
 */
export async function rm(
  filePath: string,
  options?: {
    maxRetries?: number;
    retryDelay?: number;
  },
): Promise<void> {
  try {
    await fsp.rm(filePath, {
      recursive: true, // Remove directories and their contents
      force: true, // Ignore if file doesn't exist
      maxRetries: options?.maxRetries ?? (process.platform === "win32" ? 3 : 1),
      retryDelay:
        options?.retryDelay ?? (process.platform === "win32" ? 100 : 0),
    });
  } catch (err: any) {
    // Only log errors if debugging or on Windows
    if (process.env.DEBUG_CLEANUP || process.platform === "win32") {
      console.log(`Warning: Failed to remove file ${filePath}: ${err.message}`);
    }
    // Don't throw - just log and continue (OS will clean up eventually)
  }
}
