# Testing Philosophy

This document outlines the testing approach for @photostructure/sqlite.

## Core Principle: Exact node:sqlite Compatibility

Our goal is to be a **drop-in replacement** for Node.js's built-in `node:sqlite` module. This means:

- **Exact same error messages** - Users switching from node:sqlite should see identical errors
- **Exact same error codes** - ERR_INVALID_ARG_TYPE, ERR_SQLITE_ERROR, etc.
- **Exact same behavior** - Pass the Node.js SQLite test suite

### Why Exact Compatibility Matters

1. **Drop-in replacement**: Users should be able to swap imports without any code changes
2. **Test suite compatibility**: We sync and run Node.js's own SQLite tests
3. **Error handling code**: User code that catches and parses errors must work identically
4. **Documentation accuracy**: Node.js docs should apply to our package

## Node.js Test Suite Synchronization

We sync test files from the Node.js repository and adapt them to use our package:

```bash
npm run sync:tests     # Sync from Node.js repo
node --test test/node-compat/   # Run adapted tests
```

These tests verify exact compatibility with node:sqlite behavior, including error messages.

## Error Message Requirements

When implementing error handling, always match Node.js's exact error messages:

```cpp
// CORRECT - matches Node.js exactly
Napi::TypeError::New(env,
    "The \"name\" argument must be a string.").ThrowAsJavaScriptException();

// WRONG - different message
Napi::TypeError::New(env,
    "Expected name to be a string").ThrowAsJavaScriptException();
```

Reference the upstream Node.js source (`src/upstream/node_sqlite.cc`) to find exact error messages.

## SQLite Error Properties

SQLite errors must include all standard properties:

```javascript
{
  code: 'ERR_SQLITE_ERROR',
  errcode: 19,
  errstr: 'constraint failed',
  sqliteCode: 19,
  sqliteExtendedCode: 2067,
  sqliteCodeName: 'SQLITE_CONSTRAINT_UNIQUE',
  sqliteErrorString: 'UNIQUE constraint failed: users.email'
}
```

## Platform Considerations

### CI Environment Differences

- GitHub Actions runners vary significantly in performance
- Alpine Linux ARM64 emulation is 5-20x slower
- Windows process operations are 4x slower
- Use adaptive timeouts from `test-timeout-config.cjs`

### Test Isolation

The node-compat tests share a temp directory and must run with `--test-concurrency=1` to avoid database locking conflicts.

## Test Organization

- `test/*.test.ts` - Jest-based unit and integration tests
- `test/node-compat/*.test.js` - Adapted Node.js test suite (node:test runner)
- `test/upstream/` - Original unmodified Node.js tests (reference only)
- `test/common/` - Shared test utilities

## Contributing

When implementing or fixing features:

1. Check Node.js's implementation in `src/upstream/node_sqlite.cc`
2. Match error messages and behavior exactly
3. Run `node --test --test-concurrency=1 test/node-compat/` to verify compatibility
4. Add Jest tests for additional coverage as needed
