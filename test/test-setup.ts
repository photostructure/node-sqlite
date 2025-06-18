/**
 * Centralized test setup and configuration for node-sqlite
 *
 * This file is automatically loaded by Jest via setupFilesAfterEnv
 * to ensure consistent:
 * - Timeout configuration
 * - Environment setup
 * - Resource cleanup
 * - Error handling
 */

import { getTestTimeout } from "./test-timeout-config";

// Set default Jest timeout using adaptive configuration
if (typeof jest !== "undefined") {
  jest.setTimeout(getTestTimeout(30000)); // 30s base timeout, adjusted per environment
}

// Configure Jest to handle native modules properly
if (typeof expect !== "undefined") {
  expect.extend({
    toBeWithinRange(received: number, floor: number, ceiling: number) {
      const pass = received >= floor && received <= ceiling;
      return {
        message: () =>
          `expected ${received} ${pass ? "not " : ""}to be within range ${floor} - ${ceiling}`,
        pass,
      };
    },
  });
}

// Track active resources for cleanup
const activeResources = new Set<() => Promise<void> | void>();

/**
 * Register a cleanup function to be called during test teardown
 */
export function registerCleanup(cleanup: () => Promise<void> | void): void {
  activeResources.add(cleanup);
}

/**
 * Unregister a cleanup function
 */
export function unregisterCleanup(cleanup: () => Promise<void> | void): void {
  activeResources.delete(cleanup);
}

// Global test setup
beforeAll(async () => {
  // Ensure we're in test mode
  process.env.NODE_ENV = "test";

  // Set stable timezone for consistent test results
  process.env.TZ = "UTC";

  // Configure memory tests flag if not set
  if (!process.env.TEST_MEMORY) {
    process.env.TEST_MEMORY = "0"; // Default to disabled
  }
});

// Global test cleanup
afterEach(async () => {
  // Clean up any registered resources
  const cleanups = Array.from(activeResources);
  activeResources.clear();

  await Promise.allSettled(
    cleanups.map(async (cleanup) => {
      try {
        await cleanup();
      } catch (error) {
        console.warn("Cleanup error:", error);
      }
    }),
  );
});

afterAll(async () => {
  // Final cleanup to ensure Jest can exit cleanly
  await new Promise((resolve) => setImmediate(resolve));
});

// Handle unhandled rejections in tests
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit the process in tests, just log the error
});

// Enhanced error messages for SQLite errors
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  // Add context for SQLite-related errors
  const message = args.join(" ");
  if (message.includes("SQLITE_") || message.includes("database")) {
    const stack = new Error().stack;
    originalConsoleError(...args, "\nStack trace:", stack);
  } else {
    originalConsoleError(...args);
  }
};

// Environment detection helpers
export const isCI = process.env.CI === "true";
export const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
export const isMemoryTest = process.env.TEST_MEMORY === "1";

// Platform-specific test configuration
export const testConfig = {
  // Adjust concurrency based on platform
  maxConcurrency: isCI ? 2 : 4,

  // Database operation timeouts
  dbTimeout: getTestTimeout(5000),

  // File system operation timeouts
  fsTimeout: getTestTimeout(10000),

  // Multi-process operation timeouts
  processTimeout: getTestTimeout(30000),

  // Memory test configuration
  memoryTestTimeout: getTestTimeout(60000),

  // Worker thread timeouts
  workerTimeout: getTestTimeout(15000),
};

// Export timeout configuration for backwards compatibility
export { getTestTimeout } from "./test-timeout-config";
