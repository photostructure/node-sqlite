/**
 * Node.js SQLite compatibility test
 * Adapted from: test-sqlite-database-sync-dispose.js
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test test-sqlite-database-sync-dispose.test.js
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

'use strict';
const { tmpdir, isWindows } = require("../common/test-utils.cjs");
const assert = require('node:assert');
const { join } = require('node:path');
const { DatabaseSync } = require("@photostructure/sqlite");
const { suite, test } = require('node:test');
let cnt = 0;

tmpdir.refresh();

function nextDb() {
  return join(tmpdir.path, `database-${cnt++}.db`);
}

suite('DatabaseSync.prototype[Symbol.dispose]()', () => {
  test('closes an open database', () => {
    const db = new DatabaseSync(nextDb());
    db[Symbol.dispose]();
    assert.throws(() => {
      db.close();
    }, /database is not open/);
  });

  test('supports databases that are not open', () => {
    const db = new DatabaseSync(nextDb(), { open: false });
    db[Symbol.dispose]();
    assert.throws(() => {
      db.close();
    }, /database is not open/);
  });
});
