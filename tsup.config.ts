import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/experimental.ts"],
  format: ["cjs", "esm"],
  dts: true, // Generate .d.ts files automatically
  clean: true, // Clean dist before each build
  sourcemap: true,
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs", // Use .cjs for CommonJS and .mjs for ESM
  }),
  shims: true, // Inject CJS shims (__dirname, __filename) in ESM output
  target: "es2022", // Align with TypeScript target
  // esbuild renames a class or function expression whose name a top-level
  // binding also uses, which changes its .name (DatabasePool became
  // _DatabasePool). test/package-exports.test.mjs checks the built names.
  keepNames: true,
  tsconfig: "tsconfig.build.json", // Use a single tsconfig for building
});
