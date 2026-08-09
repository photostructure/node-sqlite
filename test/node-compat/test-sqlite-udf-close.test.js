/**
 * Node.js SQLite compatibility test
 * Adapted from: test-sqlite-udf-close.js
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test test-sqlite-udf-close.test.js
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { DatabaseSync } = require("@photostructure/sqlite");

for (const method of ['all', 'get', 'run', 'iterate']) {
  test(`database.close() from a UDF during statement.${method}()`, () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE data (value INTEGER);
      INSERT INTO data VALUES (1), (2), (3);
    `);

    db.function('close_db', (value) => {
      db.close();
      return value;
    });

    const statement = db.prepare('SELECT close_db(value) FROM data');
    assert.throws(() => {
      if (method === 'iterate') {
        for (const row of statement.iterate()) {
          assert.ok(row);
        }
      } else {
        statement[method]();
      }
    }, {
      code: 'ERR_INVALID_STATE',
      message: 'database cannot be closed while in a callback',
    });

    assert.strictEqual(db.isOpen, true);
    db.close();
  });
}
