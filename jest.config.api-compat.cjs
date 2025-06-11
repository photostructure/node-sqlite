// @ts-check


/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `API Compatibility Test`,
  testEnvironment: "jest-environment-node",
  roots: ["<rootDir>/src"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  verbose: true,
  silent: false,
  preset: "ts-jest",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  // Only run the api-compatibility test
  testMatch: ["**/api-compatibility.test.ts"],
};

module.exports = config;