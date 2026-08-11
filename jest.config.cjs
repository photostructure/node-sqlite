// @ts-check

const os = require("node:os");
const { arch, argv } = require("node:process");

const isESM =
  process.env.TEST_ESM === "1" ||
  process.env.NODE_OPTIONS?.includes("--experimental-vm-modules");

const isCI = process.env.CI === "true";

/**
 * Determine appropriate Jest worker count for the environment.
 *
 * In CI, we reduce parallelism to avoid resource contention between
 * heavy test files (concurrent-access, multi-process, memory tests).
 * ARM64 runners appear to have I/O bottlenecks that cause severe slowdowns
 * when too many test files run in parallel.
 *
 * @returns {number | undefined} maxWorkers value, or undefined for Jest default
 */
function getMaxWorkers() {
  if (!isCI) {
    // Local development: use Jest default (all available)
    return undefined;
  }

  // os.availableParallelism() was added in Node 18.14 / 19.4
  const parallelism = os.availableParallelism?.() ?? os.cpus().length;

  // ARM64 CI runners have I/O bottlenecks - be conservative
  if (arch === "arm64") {
    // Use at most half, but ensure at least 2 for concurrency testing
    return Math.max(2, Math.floor(parallelism / 2));
  }

  // Other CI platforms: use 75% to leave headroom
  return Math.max(2, Math.floor(parallelism * 0.75));
}

const maxWorkers = getMaxWorkers();

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `@photostructure/sqlite (${isESM ? "ESM" : "CJS"})`,
  testEnvironment: "jest-environment-node",
  globalSetup: "<rootDir>/test/global-setup.cjs",
  // Limit parallelism in CI to avoid resource contention
  ...(maxWorkers != null && { maxWorkers }),
  roots: ["<rootDir>/src", "<rootDir>/test", "<rootDir>/benchmark"],
  coverageProvider: "v8",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  verbose: true,
  silent: false,
  randomize: true,
  collectCoverage: !argv.includes("--no-coverage"),
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.test-*.ts",
    "!src/upstream/**",
    "!src/shims/**",
    "!src/types/**",
  ],
  coveragePathIgnorePatterns: [
    "exports",
    "setup",
    "/test-utils/",
    "\\.d.ts$",
    "/types/",
    "/upstream/",
    "/shims/",
  ],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 30, // Lowered due to dirname/stack_path environment-specific branches
      functions: 20, // Lowered due to dirname/stack_path helper functions
      lines: 70,
    },
  },
  preset: isESM ? "ts-jest/presets/default-esm" : "ts-jest",
  extensionsToTreatAsEsm: isESM ? [".ts"] : [],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: isESM,
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  moduleNameMapper: isESM
    ? {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      }
    : {},
  // Setup files to run after Jest environment is set up
  setupFilesAfterEnv: ["<rootDir>/test/test-setup.ts"],
  // Global test timeout with platform-aware default
  testTimeout: 60000,
  // Exclude api-compatibility test from main test suite (runs separately)
  // Exclude node-compat tests (use node:test runner, run via 'npm run test:node')
  testPathIgnorePatterns: [
    "/node_modules/",
    "api-compatibility\\.test\\.ts",
    "/test/node-compat/",
  ],
};

module.exports = config;
