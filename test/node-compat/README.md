# Node.js Compatibility Tests

These tests are adapted from Node.js's SQLite test suite.
They verify our implementation matches node:sqlite behavior.
The scripts they spawn live in `test/fixtures/sqlite/`, synced from the
same commit.

**Auto-generated** - Run `npm run sync:tests` to regenerate.

## Running

```bash
node --test 'test/node-compat/*.test.{js,mjs}'
```

Or run a specific test:

```bash
node --test test/node-compat/test-sqlite-statement-columns.test.js
```

Source: https://github.com/nodejs/node/tree/v26.x-staging/test/parallel
Commit: e65b7079ee34de03465c06cca38cb46c4decc988
