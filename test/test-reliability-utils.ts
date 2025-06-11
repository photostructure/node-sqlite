/**
 * Test reliability utilities for node-sqlite
 *
 * This module provides helper functions to make tests more reliable across
 * different platforms and CI environments.
 */

import { getTimingMultiplier } from "./test-timeout-config";

/**
 * Wait for a condition to become true with platform-aware retry logic
 */
export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: {
    maxAttempts?: number;
    delay?: number;
    timeoutMs?: number;
    description?: string;
  } = {},
): Promise<boolean> {
  const {
    maxAttempts = 10,
    delay = 100,
    timeoutMs,
    description = "condition",
  } = options;

  const multiplier = getTimingMultiplier();
  const adjustedMaxAttempts = Math.ceil(maxAttempts * multiplier);
  const adjustedDelay = delay;

  const startTime = Date.now();

  for (let i = 0; i < adjustedMaxAttempts; i++) {
    if (timeoutMs && Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for ${description} after ${timeoutMs}ms`,
      );
    }

    const result = await check();
    if (result) {
      return true;
    }

    if (i < adjustedMaxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, adjustedDelay));
    }
  }

  return false;
}

/**
 * Retry an operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    description?: string;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffFactor = 2,
    description = "operation",
  } = options;

  const multiplier = getTimingMultiplier();
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(
          `Failed ${description} after ${maxRetries + 1} attempts: ${error}`,
        );
      }

      const adjustedDelay = Math.min(delay * multiplier, maxDelay);
      await new Promise((resolve) => setTimeout(resolve, adjustedDelay));
      delay *= backoffFactor;
    }
  }

  throw new Error(`Unexpected end of retry loop for ${description}`);
}

/**
 * Wait for output from a child process with timeout
 */
export async function waitForOutput(
  process: NodeJS.Process | { stdout?: NodeJS.ReadableStream },
  expectedOutput: string,
  timeoutMs: number = 5000,
): Promise<void> {
  const multiplier = getTimingMultiplier();
  const adjustedTimeout = timeoutMs * multiplier;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for output: "${expectedOutput}"`));
    }, adjustedTimeout);

    let buffer = "";

    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes(expectedOutput)) {
        clearTimeout(timeout);
        resolve();
      }
    };

    if (process.stdout) {
      process.stdout.on("data", onData);
    }
  });
}

/**
 * Enhanced error matcher that handles platform-specific error variations
 */
export function expectError(
  operation: () => any,
  patterns: string | string[] | RegExp | RegExp[],
): void {
  const normalizedPatterns = Array.isArray(patterns) ? patterns : [patterns];

  let error: Error | undefined;
  try {
    operation();
  } catch (e) {
    error = e as Error;
  }

  if (!error) {
    throw new Error("Expected operation to throw an error");
  }

  const message = error.message;
  const matched = normalizedPatterns.some((pattern) => {
    if (typeof pattern === "string") {
      return message.includes(pattern);
    } else {
      return pattern.test(message);
    }
  });

  if (!matched) {
    throw new Error(
      `Error message "${message}" did not match any of the expected patterns: ${normalizedPatterns}`,
    );
  }
}

/**
 * Deterministic random number generator for consistent test data
 */
export function createSeededRandom(seed: string): () => number {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Linear congruential generator
  let current = Math.abs(hash);
  return () => {
    current = (current * 1664525 + 1013904223) % 0x100000000;
    return current / 0x100000000;
  };
}

/**
 * Create deterministic test data based on test name
 */
export function createTestData(
  testName: string,
  count: number,
): Array<{
  id: number;
  name: string;
  value: number;
  timestamp: number;
}> {
  const random = createSeededRandom(testName);
  const baseTimestamp = 1704067200000; // 2024-01-01 00:00:00 UTC

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `test_${i}_${Math.floor(random() * 1000)}`,
    value: Math.floor(random() * 10000) / 100, // 2 decimal places
    timestamp: baseTimestamp + i * 86400000, // One day apart
  }));
}

/**
 * Validate timing with appropriate margins for CI environments
 */
export function expectTiming(
  actual: number,
  expected: number,
  marginPercent: number = 50,
): void {
  const multiplier = getTimingMultiplier();
  const adjustedMargin = marginPercent * multiplier;
  const lowerBound = expected * (1 - adjustedMargin / 100);
  const upperBound = expected * (1 + adjustedMargin / 100);

  if (actual < lowerBound || actual > upperBound) {
    throw new Error(
      `Timing assertion failed: expected ${actual}ms to be within ${adjustedMargin}% of ${expected}ms (${lowerBound.toFixed(1)}-${upperBound.toFixed(1)}ms)`,
    );
  }
}

/**
 * Platform-aware test skipping
 */
export const testIf = (condition: boolean) => (condition ? test : test.skip);
export const describeIf = (condition: boolean) =>
  condition ? describe : describe.skip;

// Platform detection helpers
export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isCI = process.env.CI === "true";
export const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

// Environment-specific test configuration
export const skipOnWindows = testIf(!isWindows);
export const skipOnMacOS = testIf(!isMacOS);
export const skipOnLinux = testIf(!isLinux);
export const skipInCI = testIf(!isCI);
export const skipLocally = testIf(isCI);

export const describeSkipOnWindows = describeIf(!isWindows);
export const describeSkipOnMacOS = describeIf(!isMacOS);
export const describeSkipOnLinux = describeIf(!isLinux);
export const describeSkipInCI = describeIf(!isCI);
export const describeSkipLocally = describeIf(isCI);
