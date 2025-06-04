import pluginJs from "@eslint/js";
import regexp_plugin from "eslint-plugin-regexp";
import globals from "globals";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts", "scripts/*.js", "scripts/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // Additional configuration for CommonJS test files
  {
    files: ["test/**/*.js", "test/**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.commonjs,
      },
    },
  },
  // Ignore build artifacts and upstream files
  {
    ignores: [
      "build",
      "coverage",
      "dist",
      "docs",
      "*.cts",
      "prebuilds",
      "node_modules",
      "src/upstream/**", // Ignore upstream Node.js files
      "src/shims/**", // Ignore Node.js compatibility shims
    ],
  },
  pluginJs.configs.recommended,
  ...ts_eslint.configs.recommended,
  regexp_plugin.configs["flat/recommended"],
  {
    rules: {
      "@typescript-eslint/no-shadow": "error",
      // Allow require() for native module loading
      "@typescript-eslint/no-require-imports": "off",
      // Allow any for native bindings and Node.js compatibility
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      // Allow underscore-prefixed parameters to be unused
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
