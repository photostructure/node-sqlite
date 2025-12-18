# TPP: Node.js SQLite Test Suite Compatibility

## Goal Definition

- **What Success Looks Like**: `node --test --test-concurrency=1 test/node-compat/*.test.js` passes with 0 failures
- **Core Problem**: Error messages, error codes, and data types don't match node:sqlite exactly, breaking drop-in replacement promise
- **Key Constraints**: Must match node:sqlite behavior exactly - test against Node.js 22+ built-in
- **Success Validation**: All 215 node-compat tests pass

## Current Status (2025-12-17 Update #2)

After all previous fixes + this session's fixes:

- **205 passing** / **10 failing** on `.test.js` tests
- **14 passing** / **2 failing** on backup `.test.mjs` tests

### Fixes from This Session (2025-12-17 Evening)

Major progress: **191 → 205 passing** (+14 tests fixed)

- ✅ **Parameter binding errors**: `undefined`, functions, Symbols now throw `ERR_INVALID_ARG_TYPE` with proper error code (was missing code property for named params)
- ✅ **BigInt too large**: Now throws `ERR_INVALID_ARG_VALUE` instead of generic error
- ✅ **SQLite bind errors**: When binding to out-of-range parameter indices, now properly returns `ERR_SQLITE_ERROR` with `errcode` and `errstr` properties (uses `ThrowEnhancedSqliteError`)
- ✅ **Iterator `toArray()` method**: Added `toArray()` to `StatementSyncIterator` class
- ✅ **Iterator inheritance**: Iterator now inherits from `Iterator.prototype` so `iter instanceof Iterator` returns true and all Iterator Helper methods (`.map()`, `.filter()`, etc.) work
- ✅ **Null prototype objects**: Row objects, column metadata from `columns()`, and iterator result objects (`{done, value}`) now have null prototype matching Node.js security patterns
- ✅ **URI query params**: URL objects with query params (e.g., `file:///path?mode=ro`) now work correctly - added `SQLITE_OPEN_URI` flag and pass full URI to SQLite
- ✅ **Session error order**: Fixed check order in `Session::Close()` and `GenericChangeset()` - now checks if database is open first (when db was closed), then if session is open (when session was explicitly closed)

### Key Code Changes This Session

| File | Change |
|------|--------|
| `sqlite_impl.cpp:2224-2275` | Check `env.IsExceptionPending()` after `BindSingleParameter()` to preserve error codes |
| `sqlite_impl.cpp:2386-2394` | Check `sqlite3_bind_*` return values and call `ThrowEnhancedSqliteError` on failure |
| `sqlite_impl.cpp:2581-2610` | Iterator inherits from `Iterator.prototype` via `Object.setPrototypeOf` |
| `sqlite_impl.cpp:2719-2749` | Added `StatementSyncIterator::ToArray()` method |
| `sqlite_impl.cpp:2661-2693` | Iterator result objects use `CreateObjectWithNullPrototype()` |
| `sqlite_impl.cpp:2093` | Column metadata uses `CreateObjectWithNullPrototype()` |
| `sqlite_impl.cpp:101-107` | URL with query params returns full URI for SQLite URI mode |
| `sqlite_impl.cpp:824-827` | Add `SQLITE_OPEN_URI` flag when `config_.get_open_uri()` is true |
| `sqlite_impl.cpp:2845-2862` | `Session::Delete()` preserves `database_` pointer for error checking |
| `sqlite_impl.cpp:2911-2934` | `Session::Close()` checks db.IsOpen() before session nullptr |
| `sqlite_impl.h:112-113` | Added `open_uri_` flag to `DatabaseOpenConfiguration` |

### Previous Fixes (2025-12-17 Earlier Session)

- ✅ **Task 5D**: Unknown named parameter now throws `ERR_INVALID_STATE` (was `ERR_INVALID_ARG_VALUE`)
- ✅ **Task 5E**: `run()` returns BigInt for `changes`/`lastInsertRowid` when `readBigInts: true`
- ✅ **Task 5F**: Foreign key disabling now uses `sqlite3_db_config(SQLITE_DBCONFIG_ENABLE_FKEY)`
- ✅ **Task 5G**: BigInt too large to bind now throws error (was converting to text)
- ✅ **Task 5H**: URL scheme error message now matches Node.js: "The URL must be of scheme file:"
- ✅ **Task 5I**: `DatabaseSync()` without `new` now throws `ERR_CONSTRUCT_CALL_REQUIRED`
- ✅ **Task 5J**: `isTransaction` on closed database now throws `ERR_INVALID_STATE`
- ✅ **Task 5K**: `location()` with non-string dbName now throws `ERR_INVALID_ARG_TYPE`
- ✅ **Task 5L**: Session error messages now check database before session (matching Node.js order)
- ✅ **Task 5M**: Backup progress callback no longer called with `remainingPages: 0`

### Even Earlier Fixes

- ✅ **Task 5B**: Row objects now have `null` prototype (matching Node.js)
- ✅ **Task 5C**: `SQLTagStore.size` is now a getter (Node.js PR #60246 changed method→getter)
- ✅ **Statement lock fix**: `Get()`, `All()` now call `sqlite3_reset()` after operations
- ✅ **Sync script**: Updated to sync from `main` branch and preserve `__proto__: null` in tests

### Remaining 10 Failures

```
✖ accessing the node:sqlite module - Tests Node.js built-in, not our package
✖ can be disabled with --no-experimental-sqlite flag - Tests Node.js flag, not applicable
✖ concurrent applyChangeset with workers - Worker thread changeset issue
✖ conflict resolution - Changeset conflict handler issue
✖ conflict resolution handler returns invalid value - Changeset issue
✖ conflict resolution handler throws - Changeset issue
✖ database.applyChangeset() - SQLITE_CHANGESET_CONFLICT - Changeset issue
✖ filter handler throws - Changeset filter issue
✖ iterator keeps the prepared statement from being collected - Requires --expose-gc flag
✖ throws if the statement is finalized - Error message mismatch (db closed vs stmt finalized)
```

### Remaining Failure Categories (~10 failures)

| Category | Count | Root Cause |
|----------|-------|------------|
| Changeset/Session | 6 | Conflict resolution handlers, filter handlers |
| Node.js module tests | 2 | Tests `node:sqlite` built-in module, not applicable to us |
| GC-dependent test | 1 | Test requires `--expose-gc` flag |
| Error message | 1 | "statement finalized" vs "database closed" ordering |

Run tests with:

```bash
npm run build:native:rebuild && node --test --test-concurrency=1 'test/node-compat/*.test.js'
# Also run backup tests:
node --test 'test/node-compat/test-sqlite-backup.test.mjs'
```

## Context Research

### Existing Patterns

Node.js error throwing patterns are in:

```bash
grep -n "THROW_ERR" src/upstream/node_sqlite.cc | head -30
```

Our error throwing utilities:

```bash
cat src/shims/node_errors.h
```

### Landmines

1. **N-API callback context**: ~~Inside SQLite callbacks (xFunc, xStep, etc.), we can't use N-API to throw JavaScript errors directly.~~ **RESOLVED**: We ARE in a valid N-API context inside xFunc/xStep callbacks, so we CAN throw JavaScript exceptions directly. The key is to also set `db_->SetIgnoreNextSQLiteError(true)` and call `sqlite3_result_error(ctx, "", 0)` so SQLite knows the function failed, but our error handlers skip the duplicate SQLite error.

2. **info.Data() doesn't work for constructor detection**: N-API ObjectWrap doesn't set Data() in a way we can use to detect direct vs internal construction.

3. **Error code propagation**: ~~When throwing from SQLite callbacks, error codes get lost - everything becomes ERR_SQLITE_ERROR.~~ **RESOLVED**: Use the same pattern as the authorizer callback - throw the JS exception directly, set `SetIgnoreNextSQLiteError(true)`, then call `sqlite3_result_error(ctx, "", 0)`. The error handlers check `ShouldIgnoreSQLiteError()` and don't throw a duplicate error.

### node:sqlite Behavior Reference

Key error patterns from `src/upstream/node_sqlite.cc`:

- Line 85-88: `THROW_ERR_OUT_OF_RANGE` for large integers
- Line 894: `THROW_ERR_CONSTRUCT_CALL_REQUIRED` for DatabaseSync
- Line 1146, 1169: `"The \"sql\" argument must be a string."`
- Line 1185-1278: Constructor option validation with specific messages

## Tasks

### Don't blindly follow this section!

**It is your responsibility to complete (or at least make progress towards) this TPP's goal.**

These tasks were what seemed to be the best course of action at planning time. As research reveals new details, reconsider and propose alternatives.

---

### Task 1: Fix DatabaseSync Constructor Option Validation ✅ COMPLETED

**Success**: `node --test --test-concurrency=1 test/node-compat/test-sqlite-database-sync.test.js` - constructor tests pass

**Problem**: We silently ignore invalid option types instead of throwing ERR_INVALID_ARG_TYPE.

**Solution Implemented**:

Rewrote constructor options parsing in `src/sqlite_impl.cpp` (lines 367-523) to:

1. Check if `options` argument is an object, throw `ERR_INVALID_ARG_TYPE` if not
2. For each option, check if undefined first, then validate type
3. Use exact Node.js error messages with proper punctuation

**Files Modified**:

- `src/sqlite_impl.cpp` - DatabaseSync constructor

**Completion checklist**:

- [x] Each option validated: open, readOnly, timeout, enableForeignKeyConstraints, enableDoubleQuotedStringLiterals, readBigInts, returnArrays, allowBareNamedParameters, allowUnknownNamedParameters, defensive, allowExtension
- [x] Error messages match exactly (e.g., `"The \"options.open\" argument must be a boolean."`)
- [x] Integer validation for timeout uses `std::trunc()` check

---

### Task 2: Fix StatementSync Illegal Constructor ✅ COMPLETED

**Success**: `node --test test/node-compat/test-sqlite-statement-sync.test.js` - "StatementSync cannot be constructed directly" passes

**Problem**: When user does `new StatementSync()`, should throw ERR_ILLEGAL_CONSTRUCTOR with "Illegal constructor" message.

**Solution Implemented** (Option A - TypeScript Wrapper):

In `src/index.ts`, wrapped the exported StatementSync:

```typescript
const _StatementSync = binding.StatementSync;
export const StatementSync = function StatementSync() {
  const err = new TypeError("Illegal constructor");
  (err as NodeJS.ErrnoException).code = "ERR_ILLEGAL_CONSTRUCTOR";
  throw err;
} as unknown as SqliteModule["StatementSync"];
// Use the native prototype directly so instanceof checks work correctly
StatementSync.prototype = _StatementSync.prototype;
```

**Key insight**: Setting `StatementSync.prototype = _StatementSync.prototype` directly (not using `Object.setPrototypeOf`) ensures `stmt instanceof StatementSync` works correctly because the prototype chain check finds the same object.

**Files Modified**:

- `src/index.ts` - StatementSync export

**Completion checklist**:

- [x] `new StatementSync()` throws ERR_ILLEGAL_CONSTRUCTOR
- [x] `db.prepare("SELECT 1")` still works
- [x] `stmt instanceof StatementSync` still works
- [x] Test passes

---

### Task 3: Fix ERR_OUT_OF_RANGE in User-Defined Functions ✅ COMPLETED

**Success**: `node --test test/node-compat/test-sqlite-custom-functions.test.js` - "throws if value cannot fit in a number" passes

**Problem**: When a large integer (> MAX_SAFE_INTEGER) is passed to a user function without useBigIntArguments, should throw ERR_OUT_OF_RANGE, not ERR_SQLITE_ERROR.

**Root Cause**: Inside `UserDefinedFunction::xFunc`, we threw `std::runtime_error` which gets caught and converted to `sqlite3_result_error()`. This becomes ERR_SQLITE_ERROR.

**Solution Implemented**: Direct exception throw pattern (same as Node.js uses):

1. In `SqliteValueToJS`, throw `ERR_OUT_OF_RANGE` directly using `node::THROW_ERR_OUT_OF_RANGE()`:

   ```cpp
   if (std::abs(int_val) > kMaxSafeJsInteger) {
     char error_msg[128];
     snprintf(error_msg, sizeof(error_msg),
              "Value is too large to be represented as a JavaScript number: %" PRId64,
              static_cast<int64_t>(int_val));
     node::THROW_ERR_OUT_OF_RANGE(env_, error_msg);
     return env_.Undefined();
   }
   ```

2. In `xFunc`, after calling `SqliteValueToJS`, check for pending exception:

   ```cpp
   if (self->env_.IsExceptionPending()) {
     self->db_->SetIgnoreNextSQLiteError(true);
     sqlite3_result_error(ctx, "", 0);
     return;
   }
   ```

3. Existing error handlers (`ThrowEnhancedSqliteErrorWithDB`, `ThrowErrSqliteErrorWithDb`) already check `ShouldIgnoreSQLiteError()` and skip throwing if true.

**Files Modified**:

- `src/user_function.cpp` - SqliteValueToJS, xFunc
- `src/aggregate_function.cpp` - SqliteValueToJS, xStepBase, xValueBase
- `src/aggregate_function.h` - Added `db_` member

**Completion checklist**:

- [x] Large integer throws ERR_OUT_OF_RANGE, not ERR_SQLITE_ERROR
- [x] Error message matches: `/Value is too large to be represented as a JavaScript number: \d+/`
- [x] Same fix applied to aggregate functions
- [x] Test passes ("throws if value cannot fit in a number" under useBigIntArguments)

---

### Task 4: Fix Return Type Validation in User Functions ✅ COMPLETED

**Success**: `test-sqlite-custom-functions.test.js` - return type tests pass

**Problem**: Tests for "throws on unsupported return types", "does not support Promise return values" were failing with wrong error messages.

**Solution Implemented**:

Updated `JSValueToSqliteResult` in both `user_function.cpp` and `aggregate_function.cpp` to:

1. **Promise detection**: Use `value.IsPromise()` and exact Node.js message:

   ```cpp
   sqlite3_result_error(ctx, "Asynchronous user-defined functions are not supported", -1);
   ```

2. **Unsupported types**: Use exact Node.js message:

   ```cpp
   sqlite3_result_error(ctx, "Returned JavaScript value cannot be converted to a SQLite value", -1);
   ```

3. **BigInt too large for SQLite**: Throw `ERR_OUT_OF_RANGE` directly:

   ```cpp
   if (!lossless) {
     node::THROW_ERR_OUT_OF_RANGE(env_, "BigInt value is too large to be represented as a SQLite integer");
     return;
   }
   ```

4. **Boolean extension**: Added boolean-to-int conversion (0/1) as an extension over Node.js to maintain backwards compatibility with existing tests.

**Files Modified**:

- `src/user_function.cpp` - JSValueToSqliteResult
- `src/aggregate_function.cpp` - JSValueToSqliteResult

**Completion checklist**:

- [x] Promise rejection has correct message: "Asynchronous user-defined functions are not supported"
- [x] Unsupported types throw with correct message: "Returned JavaScript value cannot be converted to a SQLite value"
- [x] BigInt too large throws ERR_OUT_OF_RANGE (not ERR_SQLITE_ERROR)
- [x] Tests pass (27/30, remaining 3 are unrelated issues)

**Remaining test failures** (not related to Task 4):

1. `supported return types` - Uint8Array vs Buffer type mismatch (output type issue, not error handling)
2. `throws if returned BigInt is too large for SQLite` - Test uses value that fits in int64 (test may be incorrect)
3. `supported argument types` - Missing `mustCall` test helper (test infrastructure issue)

---

### Task 5: Return Uint8Array Instead of Buffer for BLOBs ✅ COMPLETED

**Success**: All TypedArray tests pass, `row.data instanceof Uint8Array` returns true

**Problem**: We returned `Napi::Buffer<uint8_t>` for SQLite BLOBs; Node.js returns `Uint8Array`.

**Solution Implemented**:

Replaced all `Napi::Buffer` returns for BLOBs with `Napi::Uint8Array`:

```cpp
// Now using:
auto array_buffer = Napi::ArrayBuffer::New(env, size);
memcpy(array_buffer.Data(), data, size);
value = Napi::Uint8Array::New(env, size, array_buffer, 0);
```

**Files Modified**:

- `src/sqlite_impl.cpp` - `GetResult()` method (lines ~2493, ~2497, ~2566, ~2570)
- `src/user_function.cpp` - `SqliteValueToJS()` (lines ~183, ~186)
- `src/aggregate_function.cpp` - Multiple locations (~273, ~441, ~591, ~594)

**Completion checklist**:

- [x] `sqlite_impl.cpp` GetResult() returns Uint8Array for BLOBs
- [x] `user_function.cpp` SqliteValueToJS() returns Uint8Array
- [x] `aggregate_function.cpp` returns Uint8Array
- [x] All TypedArray tests pass
- [x] `supported data types` test passes
- [x] `supported return types` test passes

---

### Task 5B: Create Row Objects with Null Prototype ✅ COMPLETED

**Success**: `Object.getPrototypeOf(row) === null` returns true for all row objects

**Problem**: We created row objects with normal prototype; Node.js creates them with `null` prototype.

**Solution Implemented**:

Since N-API doesn't have direct support for creating objects with null prototype, we cache `Object.create` and use it:

1. Added `objectCreateFn` to `AddonData` (cached `Object.create` function)
2. Created `CreateObjectWithNullPrototype()` helper:
   ```cpp
   Napi::Object CreateObjectWithNullPrototype(Napi::Env env) {
     AddonData *addon_data = GetAddonData(env);
     if (addon_data && !addon_data->objectCreateFn.IsEmpty()) {
       return addon_data->objectCreateFn.Value()
           .Call({env.Null()})
           .As<Napi::Object>();
     }
     return Napi::Object::New(env);
   }
   ```
3. Updated `CreateResult()` to use the helper for row objects

**Files Modified**:

- `src/sqlite_impl.h` - Added `objectCreateFn` to AddonData, declared helper
- `src/sqlite_impl.cpp` - Implemented helper, updated CreateResult()
- `src/binding.cpp` - Cache Object.create on init, cleanup on finalize

**Completion checklist**:

- [x] Row objects have `null` prototype
- [x] sql.get, sql.all tests pass with prototype checks
- [x] Iterator result objects use CreateResult() which now has null prototype

---

### Task 5C: SQLTagStore.size as Getter ✅ COMPLETED (No Change Needed)

**Success**: `sql.size` works as a getter property

**Problem (Original)**: TPP incorrectly stated Node.js used `size()` method.

**Resolution**: Node.js PR #60246 (merged Dec 11, 2025) changed `size()` from a method to a getter to match `db` and `capacity`. Our implementation already had `get size` - no code change needed!

**What was done**:

1. Verified our implementation already uses `get size(): number` ✅
2. Updated sync script to:
   - Sync from `main` branch (not `v25.x-staging`) to get latest changes
   - Stop stripping `__proto__: null` from tests (since we now support null prototype)
3. Re-synced tests which now use `sql.size` (getter syntax)

**Files Modified**:

- `scripts/sync-node-tests.ts` - Changed default branch to `main`, removed `__proto__` stripping

**Root Cause of Original Confusion**:

- TPP was written when Node.js still used `size()` method
- PR #60246 changed it to a getter after the TPP was created
- Our implementation was coincidentally already correct

**Completion checklist**:

- [x] `sql.size` works as getter (was already implemented correctly)
- [x] TagStore tests pass (after syncing from main branch)
- [x] Type definitions already correct

---

### Task 5D: Fix Unknown Named Parameter Error Code ✅ COMPLETED

**Success**: Unknown named parameter throws `ERR_INVALID_STATE`, not `ERR_INVALID_ARG_VALUE`

**Problem**: We threw `ERR_INVALID_ARG_VALUE`; Node.js throws `ERR_INVALID_STATE`.

**Solution Implemented**:

Changed at [sqlite_impl.cpp:2256-2257](src/sqlite_impl.cpp#L2256):
```cpp
std::string msg = "Unknown named parameter '" + key_str + "'";
node::THROW_ERR_INVALID_STATE(env, msg.c_str());
```

**Files Modified**:

- `src/sqlite_impl.cpp` - `BindParameters()` method, unknown named parameter handling

**Completion checklist**:

- [x] Unknown named parameter throws `ERR_INVALID_STATE`
- [x] `throws on unknown named parameters` test passes
- [x] `unknown named parameter support can be toggled` test passes

---

### Task 5E: Fix BigInt in run() Results ✅ COMPLETED

**Success**: When `readBigInts: true`, `changes` and `lastInsertRowid` are BigInt

**Problem**: We returned numbers for `changes` and `lastInsertRowid`; Node.js returns BigInt when `readBigInts` is true.

**Solution Implemented**:

In `StatementSync::Run()` at [sqlite_impl.cpp:1762-1778](src/sqlite_impl.cpp#L1762):

```cpp
// When readBigInts is true, return BigInt for both (matches Node.js)
if (use_big_ints_) {
  result_obj.Set("changes",
                 Napi::BigInt::New(env, static_cast<int64_t>(changes)));
  result_obj.Set("lastInsertRowid",
                 Napi::BigInt::New(env, static_cast<int64_t>(last_rowid)));
} else if (last_rowid > JS_MAX_SAFE_INTEGER || ...) {
  // ...
}
```

**Files Modified**:

- `src/sqlite_impl.cpp` - `StatementSync::Run()` method result creation

**Completion checklist**:

- [x] `changes` is BigInt when `readBigInts: true`
- [x] `lastInsertRowid` is BigInt when `readBigInts: true`
- [x] `allows reading big integers` test passes

---

### Task 5F: Fix Foreign Key Constraint Disabling ✅ COMPLETED

**Solution Implemented**: Uses `sqlite3_db_config(SQLITE_DBCONFIG_ENABLE_FKEY)` at [sqlite_impl.cpp:861](src/sqlite_impl.cpp#L861)

---

### Task 5G: Fix BigInt Too Large to Bind ✅ COMPLETED

**Solution Implemented**: Throws `ERR_INVALID_ARG_VALUE` at [sqlite_impl.cpp:2324](src/sqlite_impl.cpp#L2324)

---

### Task 5H: Fix URL Scheme Error Message ✅ COMPLETED

**Solution Implemented**: Error message "The URL must be of scheme file:" at [node_errors.h:74](src/shims/node_errors.h#L74)

---

### Task 5I: Fix DatabaseSync() Without New ✅ COMPLETED

**Solution Implemented**: TypeScript Proxy wrapper at [index.ts:141-149](src/index.ts#L141) throws `ERR_CONSTRUCT_CALL_REQUIRED`

---

### Task 5J: Fix isTransaction on Closed Database ✅ COMPLETED

**Solution Implemented**: Throws `ERR_INVALID_STATE` at [sqlite_impl.cpp:815-816](src/sqlite_impl.cpp#L815)

---

### Task 5K: Fix location() dbName Validation ✅ COMPLETED

**Solution Implemented**: Validates string type at [sqlite_impl.cpp:788-790](src/sqlite_impl.cpp#L788)

---

### Task 5L: Fix Session Error Messages ✅ COMPLETED

**Solution Implemented**: Session methods check database before session at [sqlite_impl.cpp:2869-2874](src/sqlite_impl.cpp#L2869)

---

### Task 5M: Fix Backup Progress Callback Timing ✅ COMPLETED

**Solution Implemented**: Progress only called when `remaining_pages > 0` at [sqlite_impl.cpp:3030-3034](src/sqlite_impl.cpp#L3030)

---

### Task 6: Fix Session/Changeset Error Messages ✅ COMPLETED

**Success**: `test-sqlite-session.test.js` passes

**Problem**: Session-related tests failing with error message mismatches.

**Solution Implemented**:

1. Fixed `applyChangeset()` error message from "must be a Buffer" to "must be a Uint8Array" to match Node.js
2. Updated `applyChangeset()` to properly handle TypedArray (Uint8Array) input using `ArrayBuffer` API instead of `Napi::Buffer`

**Files Modified**:

- `src/sqlite_impl.cpp` - ApplyChangeset method

**Code change**:

```cpp
// Before: IsBuffer() and As<Napi::Buffer<uint8_t>>()
// After:
if (info.Length() < 1 || !info[0].IsTypedArray()) {
  node::THROW_ERR_INVALID_ARG_TYPE(
      env, "The \"changeset\" argument must be a Uint8Array.");
  return env.Undefined();
}
// ...
Napi::TypedArray typed_array = info[0].As<Napi::TypedArray>();
Napi::ArrayBuffer array_buffer = typed_array.ArrayBuffer();
size_t byte_offset = typed_array.ByteOffset();
size_t byte_length = typed_array.ByteLength();
uint8_t *data = static_cast<uint8_t *>(array_buffer.Data()) + byte_offset;
```

**Completion checklist**:

- [x] Session error messages match Node.js
- [x] Changeset input accepts Uint8Array (matches Node.js)
- [x] CreateSession error messages already matched

---

### Additional: Fix backup() Function ✅ PARTIALLY COMPLETED

**Problem**: backup() tests failing due to multiple issues:

1. Validation errors returned as rejected promises instead of synchronous throws
2. Argument name was "destination" instead of "path"
3. Error messages were generic instead of SQLite's actual messages

**Solution Implemented**:

1. **Synchronous validation throws** (matching Node.js behavior):
   - `THROW_ERR_INVALID_STATE` for closed database
   - `ValidateDatabasePath` for path validation (already throws)
   - `THROW_ERR_INVALID_ARG_TYPE` for options validation

2. **Argument naming**: Changed from "destination" to "path" to match Node.js

3. **Error messages**: Use SQLite's actual error messages instead of generic ones:
   ```cpp
   // Before:
   SetError("Failed to open destination database");
   // After:
   SetError(sqlite3_errmsg(dest_));  // e.g., "unable to open database file"
   ```

**Files Modified**:

- `src/sqlite_impl.cpp` - DatabaseSync::Backup method
- `src/binding.cpp` - standalone backup() function wrapper

**Remaining backup issues** (not yet fixed):

- Progress callback exception propagation needs work
- Some error code properties (ERR_SQLITE_ERROR) may need adjustment

**Completion checklist**:

- [x] Validation errors thrown synchronously
- [x] Argument name is "path" not "destination"
- [x] Error messages match Node.js (e.g., "unknown database invalid", "unable to open database file")
- [x] Options validation with correct messages (rate, source, target, progress)
- [ ] Progress callback error handling (test: "backup fails when progress function throws")
- [ ] URL scheme validation error code

---

### Task 7: Validate All Fixes Across Test Suite

**Success**: Full test suite passes

**Implementation**:

1. Run complete test suite:

   ```bash
   node --test --test-concurrency=1 'test/node-compat/*.test.js'
   ```

2. For any remaining failures, repeat the pattern:
   - Identify expected vs actual
   - Find Node.js implementation
   - Match exactly

3. Run Jest tests to ensure no regressions:
   ```bash
   npm test
   ```

**Completion checklist**:

- [ ] All 215+ node-compat tests pass
- [ ] All existing Jest tests pass
- [ ] `npm run lint` passes

---

## Validation

Final validation commands:

```bash
# Rebuild
npm run build:native:rebuild

# Run node-compat tests (JS)
node --test --test-concurrency=1 'test/node-compat/*.test.js'

# Run node-compat tests (MJS - backup)
node --test 'test/node-compat/test-sqlite-backup.test.mjs'

# Run Jest tests
npm test

# Lint
npm run lint
```

- [ ] All 215 node-compat JS tests pass (0 failures)
- [ ] All 16 backup MJS tests pass
- [ ] All existing Jest tests pass
- [ ] Linting passes
- [ ] API matches node:sqlite (verified by passing their tests)

## Notes for Implementers

### Priority Order (Updated 2025-12-18)

**✅ COMPLETED:**

- **Task 5B** - Row objects with null prototype ✅
- **Task 5C** - SQLTagStore.size as getter ✅ (was already correct)
- **Statement lock fix** - Get()/All() now reset statements to release locks ✅

**🔴 HIGH PRIORITY (fixes 12+ tests each):**

1. **Task 5** - Return Uint8Array instead of Buffer (12+ tests)

**🟡 MEDIUM PRIORITY (fixes 1-5 tests each):** 2. **Task 5D** - Unknown named parameter error code (3 tests) 3. **Task 5E** - BigInt in run() results (2 tests) 4. **Task 5F** - Foreign key constraint disabling (1 test) 5. **Task 5G** - BigInt too large to bind (1 test)

**🟢 LOW PRIORITY (1 test each):** 8. **Task 5H** - URL scheme error message 9. **Task 5I** - DatabaseSync() without new 10. **Task 5J** - isTransaction on closed database 11. **Task 5K** - location() dbName validation 12. **Task 5L** - Session error messages 13. **Task 5M** - Backup progress callback timing

### Estimated Impact

| Tasks       | Tests Fixed   |
| ----------- | ------------- |
| Task 5 + 5B | ~25 tests     |
| Task 5C-5G  | ~10 tests     |
| Task 5H-5M  | ~10 tests     |
| **Total**   | **~45 tests** |

Note: Some tests have multiple issues, so total may be lower than sum.

### Parallelization

- **Group A (C++ changes)**: Tasks 5, 5B, 5D, 5E, 5F, 5G, 5H, 5J, 5K, 5L
- **Group B (TypeScript)**: Tasks 5C, 5I
- **Group C (Backup specific)**: Task 5M

Tasks in Group A require rebuild; Tasks in Group B are TypeScript only.

### Testing Each Change

After each fix:

```bash
# For C++ changes
npm run build:native:rebuild

# Test specific file
node --test --test-concurrency=1 'test/node-compat/SPECIFIC_TEST.test.js'

# For TypeScript changes (no rebuild needed)
npx tsc && node --test --test-concurrency=1 'test/node-compat/SPECIFIC_TEST.test.js'
```

### Key Code Locations

| Issue                 | File             | Line(s)                |
| --------------------- | ---------------- | ---------------------- |
| Buffer→Uint8Array     | sqlite_impl.cpp  | 2350, 2352, 2413, 2415 |
| Row null prototype    | sqlite_impl.cpp  | GetResult() method     |
| SQLTagStore.size      | sql-tag-store.ts | 52                     |
| Unknown param error   | sqlite_impl.cpp  | 2167                   |
| BigInt run() results  | sqlite_impl.cpp  | Run() method           |
| FK constraint         | sqlite_impl.cpp  | InternalOpen()         |
| BigInt bind           | sqlite_impl.cpp  | 2205-2210              |
| isTransaction         | sqlite_impl.cpp  | 769-772                |
| location() validation | sqlite_impl.cpp  | LocationMethod()       |

Don't run full suite until individual tests pass.
