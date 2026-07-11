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

Source: https://github.com/nodejs/node/tree/main/test/parallel
Commit: ab41cf0a783fdd8ecfe915a253b3998c9f598e18
