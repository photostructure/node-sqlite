/**
 * Node.js SQLite compatibility test
 * Adapted from: test-sqlite-statement-binding-reentry.js
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test test-sqlite-statement-binding-reentry.test.js
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

// Shim for Node.js test helper
const mustCall = (fn) => fn;

("use strict");

const assert = require("node:assert");
const { test } = require("node:test");
const { DatabaseSync } = require("@photostructure/sqlite");

const reentryError = {
  code: "ERR_INVALID_STATE",
  message: "statement is already being executed",
};

// Binding a named parameter reads properties off the supplied object, so a
// getter runs JavaScript after the statement has been reset but before it is
// stepped. Reentering the same statement there resets it a second time and
// hands out a second iterator over one virtual machine.
for (const method of ["all", "get", "run", "iterate"]) {
  test(`${method}() reentry during parameter binding is rejected`, () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE data (value INTEGER);
      INSERT INTO data VALUES (1), (2), (3);
    `);

    let statement;
    const invoke = (params) =>
      method === "iterate"
        ? [...statement.iterate(params)]
        : statement[method](params);
    const reenter = mustCall(() => {
      assert.throws(() => invoke({ $min: 2 }), reentryError);
      return 1;
    });
    const params = {
      get $min() {
        return reenter();
      },
    };

    statement = db.prepare("SELECT value FROM data WHERE value >= $min");
    invoke(params);
  });
}

test("two iterators cannot share one virtual machine", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE data (value INTEGER);
    INSERT INTO data VALUES (1), (2), (3);
  `);

  const statement = db.prepare("SELECT value FROM data WHERE value >= $min");
  let inner;
  const reenter = mustCall(() => {
    assert.throws(() => {
      inner = statement.iterate({ $min: 1 });
    }, reentryError);
    return 1;
  });
  const params = {
    get $min() {
      return reenter();
    },
  };

  assert.deepStrictEqual(
    [...statement.iterate(params)].map((row) => row.value),
    [1, 2, 3],
  );
  assert.strictEqual(inner, undefined);
});
