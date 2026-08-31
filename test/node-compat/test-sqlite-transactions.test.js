/**
 * Node.js SQLite compatibility test
 * Adapted from: test-sqlite-transactions.js
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test test-sqlite-transactions.test.js
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

"use strict";
const { DatabaseSync } = require("@photostructure/sqlite");
const { suite, test } = require("node:test");

suite("manual transactions", () => {
  test("a transaction is committed", (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => {
      db.close();
    });
    const setup = db.exec(`
      CREATE TABLE data(
        key INTEGER PRIMARY KEY
      ) STRICT;
    `);
    t.assert.strictEqual(setup, undefined);
    t.assert.deepStrictEqual(db.prepare("BEGIN").run(), {
      changes: 0,
      lastInsertRowid: 0,
    });
    t.assert.deepStrictEqual(
      db.prepare("INSERT INTO data (key) VALUES (100)").run(),
      { changes: 1, lastInsertRowid: 100 },
    );
    t.assert.deepStrictEqual(db.prepare("COMMIT").run(), {
      changes: 1,
      lastInsertRowid: 100,
    });
    t.assert.deepStrictEqual(db.prepare("SELECT * FROM data").all(), [
      { __proto__: null, key: 100 },
    ]);
  });

  test("a transaction is rolled back", (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => {
      db.close();
    });
    const setup = db.exec(`
      CREATE TABLE data(
        key INTEGER PRIMARY KEY
      ) STRICT;
    `);
    t.assert.strictEqual(setup, undefined);
    t.assert.deepStrictEqual(db.prepare("BEGIN").run(), {
      changes: 0,
      lastInsertRowid: 0,
    });
    t.assert.deepStrictEqual(
      db.prepare("INSERT INTO data (key) VALUES (100)").run(),
      { changes: 1, lastInsertRowid: 100 },
    );
    t.assert.deepStrictEqual(db.prepare("ROLLBACK").run(), {
      changes: 1,
      lastInsertRowid: 100,
    });
    t.assert.deepStrictEqual(db.prepare("SELECT * FROM data").all(), []);
  });
});
