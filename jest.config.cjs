// @ts-check

const { argv } = require("node:process");

const isESM =
  process.env.TEST_ESM === "1" ||
  process.env.NODE_OPTIONS?.includes("--experimental-vm-modules");

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `@photostructure/sqlite (${isESM ? "ESM" : "CJS"})`,
  testEnvironment: "jest-environment-node",
  roots: ["<rootDir>/src", "<rootDir>/test"],
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
  testPathIgnorePatterns: ["/node_modules/", "api-compatibility\\.test\\.ts"],
};

module.exports = config;
