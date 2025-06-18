import pluginJs from "@eslint/js";
import regexp_plugin from "eslint-plugin-regexp";
import security_plugin from "eslint-plugin-security";
import globals from "globals";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: [
      "src/**/*.ts",
      "test/**/*.ts",
      "scripts/*.js",
      "scripts/*.ts",
      "scripts/*.mjs",
    ],
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
  // Add security plugin configuration
  {
    plugins: {
      security: security_plugin,
    },
    rules: {
      ...security_plugin.configs.recommended.rules,
      // Additional security rules for detecting command injection
      "security/detect-child-process": "error",
      "security/detect-non-literal-require": "warn",
      "security/detect-non-literal-fs-filename": "warn",
      // Custom rule to prevent execSync with dynamic paths
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='execSync'][arguments.0.type!='Literal']",
          message:
            "execSync with dynamic paths is a security risk. Use execFileSync with explicit command and arguments instead.",
        },
        {
          selector:
            "CallExpression[callee.property.name='execSync'][arguments.0.type!='Literal']",
          message:
            "execSync with dynamic paths is a security risk. Use execFileSync with explicit command and arguments instead.",
        },
      ],
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
  // Special rules for utility scripts that safely use execSync with GitHub CLI
  {
    files: ["scripts/dismiss-*.ts"],
    rules: {
      "no-restricted-syntax": "off", // These scripts use GitHub CLI safely
    },
  },
  // Disable security rules for test files - all inputs are controlled test data
  {
    files: ["test/**/*.ts", "test/**/*.js", "test/**/*.cjs"],
    rules: {
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-child-process": "off",
      "security/detect-non-literal-require": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-unsafe-regex": "off",
    },
  },
];
