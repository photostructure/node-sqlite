import { afterAll, afterEach, beforeAll, beforeEach } from "@jest/globals";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "../src";
import { getTestTimeout, getTimingMultiplier } from "./test-timeout-config.cjs";

export { getTestTimeout, getTimingMultiplier };

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
  const stack = e.stack || "";

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

export interface TempDirContext {
  tempDir: string;
  getDbPath: (name?: string) => string;
  closeDatabases: (
    ...dbs: Array<InstanceType<typeof DatabaseSync> | undefined | null>
  ) => void;
  addFile: (filePath: string) => void;
  writeWorkerScript: (name: string, code: string) => string;
}

/**
 * Sets up temporary directory management for tests.
 * Creates a unique temp directory in beforeEach and cleans it up in afterEach
 * with Windows-compatible retry logic.
 *
 * @param prefix - Prefix for the temporary directory name
 * @param options - Optional configuration
 * @returns Context object with tempDir path and helper functions
 */
export function useTempDir(
  prefix = "sqlite-test-",
  options?: {
    timeout?: number;
    cleanupWalFiles?: boolean;
  },
): TempDirContext {
  const additionalFiles = new Set<string>();

  const context: TempDirContext = {
    tempDir: "",
    getDbPath: (name = "test.db") => path.join(context.tempDir, name),
    closeDatabases: (...dbs) => {
      for (const db of dbs) {
        try {
          if (db && typeof db.close === "function") {
            // Always try to close, regardless of state
            db.close();
          }
        } catch (err) {
          // Log but don't throw during cleanup
          if (process.platform === "win32" || process.env.DEBUG_CLEANUP) {
            console.log(`Warning: Error closing database: ${err}`);
          }
        }
      }
    },
    addFile: (filePath: string) => {
      additionalFiles.add(filePath);
    },
    writeWorkerScript: (name: string, code: string) => {
      const scriptPath = path.join(context.tempDir, name);
      fs.writeFileSync(scriptPath, code);
      additionalFiles.add(scriptPath);
      return scriptPath;
    },
  };

  beforeEach(() => {
    // Create a unique subdirectory for each test to avoid concurrent test issues
    // Format: prefix + timestamp + random string + process ID
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const pid = process.pid;
    const uniqueName = `${prefix}${timestamp}-${random}-${pid}`;

    context.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), uniqueName + "-"));
  });

  afterEach(async () => {
    const startTime = Date.now();
    const logDebug = (msg: string) => {
      if (process.env.DEBUG_CLEANUP || process.platform === "win32") {
        console.log(`[${Date.now() - startTime}ms] ${msg}`);
      }
    };

    logDebug(`afterEach starting for tempDir: ${context.tempDir}`);

    // Force a small delay to ensure databases are closed
    // This helps with the timing of cleanup vs database closure
    await new Promise((resolve) => setTimeout(resolve, 50));

    // On Windows, we need to be more careful about cleanup timing
    if (process.platform === "win32") {
      logDebug("Windows detected - using special cleanup procedure");
      
      // First, give SQLite time to release file handles
      logDebug("Initial wait for SQLite cleanup");
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Try to clean up WAL and SHM files
      if (options?.cleanupWalFiles && fs.existsSync(context.tempDir)) {
        logDebug("Cleaning up WAL/SHM files");
        let retryCount = 0;
        const maxRetries = 5;
        
        while (retryCount < maxRetries) {
          try {
            const files = fs.readdirSync(context.tempDir);
            let walShmFound = false;
            
            for (const file of files) {
              if (file.endsWith("-wal") || file.endsWith("-shm")) {
                walShmFound = true;
                try {
                  fs.unlinkSync(path.join(context.tempDir, file));
                  logDebug(`Deleted ${file} on attempt ${retryCount + 1}`);
                } catch (err: any) {
                  if (err.code === 'EBUSY' || err.code === 'EPERM') {
                    logDebug(`File ${file} still in use, will retry`);
                  } else {
                    logDebug(`Failed to delete ${file}: ${err}`);
                  }
                }
              }
            }
            
            if (!walShmFound) {
              logDebug("No WAL/SHM files found");
              break;
            }
            
            // Check if all WAL/SHM files are gone
            const remainingFiles = fs.readdirSync(context.tempDir);
            const hasWalShm = remainingFiles.some(f => f.endsWith("-wal") || f.endsWith("-shm"));
            
            if (!hasWalShm) {
              logDebug("All WAL/SHM files successfully deleted");
              break;
            }
            
            retryCount++;
            if (retryCount < maxRetries) {
              logDebug(`Retry ${retryCount}/${maxRetries} - waiting 200ms`);
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          } catch (err) {
            logDebug(`Error during WAL/SHM cleanup: ${err}`);
            break;
          }
        }
      }
      
      // Additional wait before main cleanup
      logDebug("Final wait before directory removal");
      await new Promise((resolve) => setTimeout(resolve, 300));
    } else {
      // Non-Windows cleanup
      if (options?.cleanupWalFiles && fs.existsSync(context.tempDir)) {
        logDebug("Cleaning up WAL/SHM files");
        try {
          const files = fs.readdirSync(context.tempDir);
          for (const file of files) {
            if (file.endsWith("-wal") || file.endsWith("-shm")) {
              try {
                fs.unlinkSync(path.join(context.tempDir, file));
                logDebug(`Deleted ${file}`);
              } catch (err) {
                logDebug(`Failed to delete ${file}: ${err}`);
              }
            }
          }
        } catch (err) {
          logDebug(`Error reading directory: ${err}`);
        }
      }
    }

    if (fs.existsSync(context.tempDir)) {
      logDebug("Starting fsp.rm of tempDir");
      try {
        await fsp.rm(context.tempDir, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 3 : 3,
          retryDelay: process.platform === "win32" ? 100 : 100,
        });
        logDebug("Successfully removed tempDir");
      } catch (err) {
        logDebug(`Error removing tempDir: ${err}`);
        // On Windows, if the directory still exists, it's likely in use
        // Log but don't fail - the OS will clean it up eventually
        if (process.platform === "win32" && fs.existsSync(context.tempDir)) {
          logDebug(`Warning: Could not remove ${context.tempDir} - likely still in use`);
          
          // Try one more time with execSync, but don't wait
          try {
            const { exec } = await import("child_process");
            exec(`rmdir /s /q "${context.tempDir}" 2>nul`, (err) => {
              if (err) {
                logDebug(`Background cleanup also failed: ${err.message}`);
              }
            });
          } catch {
            // Ignore
          }
        }
      }
    }

    // Clear additional files set
    additionalFiles.clear();
    logDebug("afterEach completed");
  }, options?.timeout ?? getTestTimeout()); // Use environment-aware timeout

  return context;
}

/**
 * Sets up temporary directory management for tests using beforeAll/afterAll.
 * Creates a single temp directory for all tests in the suite.
 *
 * @param prefix - Prefix for the temporary directory name
 * @param options - Optional configuration
 * @returns Context object with tempDir path and helper functions
 */
export function useTempDirSuite(
  prefix = "sqlite-test-suite-",
  options?: {
    timeout?: number;
  },
): TempDirContext {
  const context: TempDirContext = {
    tempDir: "",
    getDbPath: (name = "test.db") => path.join(context.tempDir, name),
    closeDatabases: (...dbs) => {
      for (const db of dbs) {
        try {
          if (db && typeof db.close === "function") {
            // Always try to close, regardless of state
            db.close();
          }
        } catch (err) {
          // Log but don't throw during cleanup
          if (process.platform === "win32" || process.env.DEBUG_CLEANUP) {
            console.log(`Warning: Error closing database: ${err}`);
          }
        }
      }
    },
    addFile: () => {
      // No-op for suite-level management
    },
    writeWorkerScript: (name: string, code: string) => {
      const scriptPath = path.join(context.tempDir, name);
      fs.writeFileSync(scriptPath, code);
      return scriptPath;
    },
  };

  beforeAll(() => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const pid = process.pid;
    const uniqueName = `${prefix}${timestamp}-${random}-${pid}`;

    context.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), uniqueName + "-"));
  });

  afterAll(async () => {
    // Wait a bit for Windows file handles to be released
    if (process.platform === "win32") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      if (fs.existsSync(context.tempDir)) {
        await fsp.rm(context.tempDir, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 10 : 3,
          retryDelay: process.platform === "win32" ? 1000 : 500,
        });
      }
    } catch {
      // Ignore cleanup errors
    }
  }, options?.timeout ?? getTestTimeout());

  return context;
}

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
