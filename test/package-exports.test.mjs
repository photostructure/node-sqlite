import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const stableKeys = [
  "DatabaseSync",
  "SQLTagStore",
  "Session",
  "StatementSync",
  "backup",
  "constants",
  "default",
  "enhance",
  "isEnhanced",
];

function checkExperimentalModule(module, label) {
  assert.deepEqual(Object.keys(module).sort(), ["DatabasePool"]);
  assert.equal(typeof module.DatabasePool, "function");
  assert.throws(() => new module.DatabasePool(), /illegal constructor/i);
  assert.equal(typeof module.DatabasePool.open, "function");
  assert.equal(typeof module.DatabasePool.prototype.run, "function");
  assert.equal(typeof module.DatabasePool.prototype.get, "function");
  assert.equal(typeof module.DatabasePool.prototype.all, "function");
  assert.equal(typeof module.DatabasePool.prototype.batch, "function");
  assert.equal(typeof module.DatabasePool.prototype.close, "function");
  assert.equal(
    typeof module.DatabasePool.prototype[Symbol.asyncDispose],
    "function",
  );

  assert.equal(
    "DatabasePool" in module,
    true,
    `${label} should expose DatabasePool`,
  );
}

test("CommonJS resolves the built experimental subpath", () => {
  const resolved = require.resolve("@photostructure/sqlite/experimental");
  assert.equal(
    resolved.endsWith(join("dist", "experimental.cjs")),
    true,
    resolved,
  );
  checkExperimentalModule(
    require("@photostructure/sqlite/experimental"),
    "CommonJS",
  );
});

test("ESM resolves the built experimental subpath", async () => {
  const resolved = fileURLToPath(
    import.meta.resolve("@photostructure/sqlite/experimental"),
  );
  assert.equal(
    resolved.endsWith(join("dist", "experimental.mjs")),
    true,
    resolved,
  );
  checkExperimentalModule(
    await import("@photostructure/sqlite/experimental"),
    "ESM",
  );
});

test("the built stable root export surface is unchanged", async () => {
  const commonjs = require("@photostructure/sqlite");
  const esm = await import("@photostructure/sqlite");

  assert.deepEqual(Object.keys(commonjs).sort(), stableKeys);
  assert.deepEqual(Object.keys(esm).sort(), stableKeys);
  assert.equal("DatabasePool" in commonjs, false);
  assert.equal("DatabasePool" in esm, false);
});
