# Node.js Compatibility Tests

These tests are adapted from Node.js's SQLite test suite.
They verify our implementation matches node:sqlite behavior.

**Auto-generated** - Run `npm run sync:tests` to regenerate.

## Running

```bash
node --test 'test/node-compat/*.test.{js,mjs}'
```

Or run a specific test:

```bash
node --test test/node-compat/test-sqlite-statement-sync-columns.test.js
```

Source: https://github.com/nodejs/node/tree/v26.x-staging/test/parallel
Commit: 079339a01e5ddc4c01202d89108be5577bcbf1da
