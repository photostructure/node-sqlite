# TPP: DatabasePool rejects oversized SQLite error messages with "Unknown failure"

**Status:** done 2026-10-16, uncommitted. The success test failed before the fix (the rejection had no `code`) and passes after; the eight `test/async-pool-*.test.ts` suites still pass. A test in `test/async-pool-values.test.ts` pins the NUL-key message.

## Goal definition

- **Bug**: when a SQLite error message exceeds V8's maximum string length, `DatabasePool` (`@photostructure/sqlite/experimental`) rejects with `Error: Unknown failure` and no `code`. The synchronous API throws `ERR_STRING_TOO_LONG` for the same SQL, as `node:sqlite` does since [nodejs/node#66521](https://github.com/nodejs/node/pull/66521).
- **Reproducing input**: `await pool.get('SELECT 1 FROM "<identifier>"')`, where the identifier is `"€".repeat(Math.ceil(constants.MAX_STRING_LENGTH / 3) + 10)`. Measured on Linux x64 with Node v24.21.0: it rejects with `Error: Unknown failure`, and the pool stays usable afterwards.
- **Root cause**: `CreateNativeError()` in `src/async_pool_impl.cpp` builds the error with `Napi::Error::New(env, native.message)`. V8 refuses the oversized message string, node-addon-api throws a C++ `Napi::Error` carrying Node-API's generic failure message, and `PoolWorker::CompleteThunk` catches it and rejects with that error.
- **Fix approach**: for errors marked `native.sqlite`, build the message with `node::NewErrorFromSqliteText()` (`src/shims/node_errors.h`); when it returns an empty error, reject with the pending `ERR_STRING_TOO_LONG` exception, taken with `env.GetAndClearPendingException()`. Other errors keep `Napi::Error::New(env, std::string)`, whose explicit length preserves a NUL in a quoted JavaScript key ("Unknown named parameter 'tenant\0x'"); `strlen()` would cut it off. `SetRangeError()` builds a fixed sentence plus an integer, so range errors need no change.
- **Success test**: a `DatabasePool` case in `test/string-too-long.test.ts` that rejects with `{ code: "ERR_STRING_TOO_LONG" }` and then serves a normal query.
