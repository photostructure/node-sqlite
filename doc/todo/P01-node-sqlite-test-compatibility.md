# TPP: Node.js SQLite Test Suite Compatibility

## Goal

- **Success**: `node --test --test-concurrency=1 test/node-compat/*.test.js` passes with 0 failures
- **Current**: **205 passing** / **10 failing** (.test.js) | **14 passing** / **2 failing** (.test.mjs backup)

## Remaining Failures (10 JS + 2 MJS)

### JS Test Failures

| Test                                                         | Category       | Root Cause                                                                        |
| ------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `accessing the node:sqlite module`                           | N/A            | Tests Node.js built-in, not applicable                                            |
| `can be disabled with --no-experimental-sqlite flag`         | N/A            | Tests Node.js CLI flag, not applicable                                            |
| `iterator keeps the prepared statement from being collected` | Infrastructure | Requires `--expose-gc` flag                                                       |
| `throws if the statement is finalized`                       | Error message  | Returns "Database connection is closed" instead of "statement has been finalized" |
| `session.changeset() - closed database results in exception` | Session        | Session returns "session is not open" after db.close() deletes session            |
| `session.close() - after closing database throws exception`  | Session        | Same session cleanup issue                                                        |
| `conflict resolution`                                        | Changeset      | Error object missing `errcode`/`code` properties                                  |
| `conflict resolution handler returns invalid value`          | Changeset      | Same error property issue                                                         |
| `conflict resolution handler throws`                         | Changeset      | Exception not propagated from handler                                             |
| `filter handler throws`                                      | Changeset      | Exception not propagated from handler                                             |
| `concurrent applyChangeset with workers`                     | Changeset      | Worker thread changeset issue                                                     |

### MJS Backup Test Failures

| Test                                                   | Root Cause                                 |
| ------------------------------------------------------ | ------------------------------------------ |
| `database backup fails when dest file is not writable` | File permission error handling             |
| `backup fails when progress function throws`           | Progress callback exception not propagated |

## Remaining Tasks

### Task A: Fix Statement Finalization Error Message

**Problem**: When database is closed, `stmt.columns()` returns "Database connection is closed" but Node.js returns "statement has been finalized".

**Analysis needed**: Does Node.js mark statements as finalized when their parent database closes?

### Task B: Fix Session Cleanup on Database Close

**Problem**: When `db.close()` is called, session objects return "session is not open" instead of "database is not open".

**Root cause**: `Session::Delete()` sets `session_ = nullptr`, then in `GenericChangeset()`:

1. Check `database_ && !database_->IsOpen()` - false because database\_ is null after cleanup
2. Check `session_ == nullptr` - true, throws "session is not open"

**Fix**: Preserve the `database_` pointer in `Session::Delete()` (only null `session_`), so we can distinguish "db closed" from "session closed".

### Task C: Fix Changeset Error Properties

**Problem**: `applyChangeset()` errors are missing `errcode` and `code` properties on the Error object.

**Expected**:

```javascript
{ name: 'Error', message: 'bad parameter or other API misuse', errcode: 21, code: 'ERR_SQLITE_ERROR' }
```

**Current**:

```javascript
Error: Failed to apply changeset: bad parameter or other API misuse
```

**Fix**: Use `ThrowEnhancedSqliteError` or similar pattern to add proper error properties.

### Task D: Fix Changeset Handler Exception Propagation

**Problem**: When conflict resolution handler or filter handler throws, the exception is swallowed.

**Expected**: Exception should propagate to caller of `applyChangeset()`.

**Location**: Check `ApplyChangeset()` conflict/filter callback handling.

### Task E: Fix Backup Progress Exception Propagation

**Problem**: When progress callback throws, exception is swallowed.

**Location**: `BackupJob::OnProgress()` has `catch (...) { // Ignore errors }`.

**Fix**: Store exception and re-throw in `OnOK()` or `OnError()`.

### Work In Progress: Task B Changes (2025-12-17)

Code changes were made for Task B but rebuild was interrupted. Changes in `sqlite_impl.cpp`:

1. **`Session::Delete()` (line ~2845-2862)**: Now preserves `database_` pointer, only nulls `session_`
2. **`GenericChangeset()` (line ~2865-2885)**: Checks `database_->IsOpen()` before `session_ == nullptr`
3. **`Session::Close()` (line ~2911-2934)**: Same check reordering as GenericChangeset

**Next steps**: Rebuild and test to verify these session fixes work.

## Completed Tasks Summary

All original tasks (1-6, 5B-5M) are complete:

- Constructor validation, StatementSync illegal constructor
- User function error codes (ERR_OUT_OF_RANGE, return type validation)
- Uint8Array instead of Buffer for BLOBs
- Null prototype row objects
- BigInt in run() results, unknown named param error code
- Foreign key disabling, BigInt bind validation
- URL scheme errors, DatabaseSync without new
- isTransaction on closed db, location() validation
- Session error message ordering, backup progress timing

## Validation

```bash
# Rebuild and test
npm run build:native:rebuild && node --test --test-concurrency=1 'test/node-compat/*.test.js'

# Backup tests
node --test 'test/node-compat/test-sqlite-backup.test.mjs'

# Jest tests (ensure no regressions)
npm test
```

## Key Reference Patterns

When fixing remaining issues, refer to Node.js patterns:

```bash
# Node.js error patterns
grep -n "THROW_ERR" src/upstream/node_sqlite.cc | head -30

# Our error utilities
cat src/shims/node_errors.h

# Enhanced SQLite errors (for errcode/code properties)
grep -n "ThrowEnhancedSqliteError" src/sqlite_impl.cpp
```
