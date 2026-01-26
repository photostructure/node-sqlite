# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - to be released

### Added

- **`enhance()` function** - Adds better-sqlite3-style `.pragma()` and `.transaction()` methods to any compatible database instance
- **`isEnhanced()` type guard** - Check if a database has enhanced methods
- **Transaction helper** - Automatic BEGIN/COMMIT/ROLLBACK with savepoint support for nested transactions
- **Pragma convenience method** - Simple API for reading and setting SQLite pragmas with `simple` option
- **Node.js test sync script** - `npm run sync:tests` downloads and adapts upstream Node.js SQLite tests for compatibility validation
- **Percentile extension** - `SQLITE_ENABLE_PERCENTILE` now enabled, adding `percentile()`, `median()`, `percentile_cont()`, `percentile_disc()` SQL functions (Node.js v25+)
- **Prepare options** - `db.prepare(sql, options)` now accepts per-statement options: `readBigInts`, `returnArrays`, `allowBareNamedParameters`, `allowUnknownNamedParameters` to override database-level defaults. **Note:** This is a Node.js v25+ feature; `node:sqlite` on v24 and earlier silently ignores these options.

### Changed

- **BREAKING**: Removed API extensions to achieve exact parity with `node:sqlite`:
  - Removed `stmt.finalize()` method (use database close for cleanup)
  - Removed `stmt.finalized` property
  - Removed `stmt[Symbol.dispose]` (still available on `DatabaseSync` and `Session`)
  - Removed `db.backup()` instance method (use standalone `backup(db, path)` function)
- **BREAKING**: `Session.changeset()` and `Session.patchset()` now return `Uint8Array` instead of `Buffer` to match `node:sqlite` API
- **BREAKING**: Defensive mode now defaults to `true` instead of `false` to match Node.js v25+ behavior. Use `{ defensive: false }` to restore old behavior.

### Fixed

- `createTagStore()` now throws errors with `code: 'ERR_INVALID_STATE'` property when database is closed, matching Node.js error format

## [0.3.0] (2025-12-16)

### Changed

- **BREAKING**: `SQLTagStore.size` changed from method to getter for Node.js API parity ([Node.js PR #60246](https://github.com/nodejs/node/pull/60246))
  - Before: `sql.size()`
  - After: `sql.size`
  - **Note**: This change was merged into Node.js main on December 11, 2025 and will appear in a future Node.js release. Current Node.js v24.x still uses `sql.size()` as a method.

## [0.2.1] (2025-12-01)

### Added

- Windows ARM64 prebuilt binaries

### Fixed

- Error message handling on Windows ARM64 (ABI compatibility)
- Error handling consistency across platforms

## [0.2.0] (2025-12-01)

### Added

- **Node.js v25 API sync**: SQLite 3.51.1, native `Symbol.dispose` in C++, Session class exposed in public API
- **New database open options**: `readBigInts`, `returnArrays`, `allowBareNamedParameters`, `allowUnknownNamedParameters`, `defensive`, `open`
- **Defensive mode**: `enableDefensive()` method to prevent SQL from deliberately corrupting the database
- **Statement enhancements**: `setAllowUnknownNamedParameters()` method, `finalized` property
- **Type identification**: `sqlite-type` symbol property on DatabaseSync (Node.js PR #59405)
- **Enhanced SQLite errors**: New properties `sqliteCode`, `sqliteExtendedCode`, `code`, `sqliteErrorString`, `systemErrno`
- **ARM64 prebuilds**: macOS Apple Silicon and Windows ARM64 binaries
- **Tagged template literals**: `db.createTagStore()` for cached prepared statements (Node.js PR #58748)
- **Authorization API**: `db.setAuthorizer()` for security callbacks (Node.js PR #59928)
- **Standalone backup**: `backup(srcDb, destFile, options?)` for one-liner database backups with progress callbacks

### Fixed

- DataView parameter binding (previously returned garbage data)
- DataView and TypedArray return values in user-defined functions
- RETURNING clause metadata handling
- Null and empty values in user function return value conversion
- Native stability: N-API reference cleanup in aggregates/destructors, thread-local napi_env storage, statement-to-database reference tracking, deferred exception handling in authorizers

## [0.0.1] - 2025-06-13

### Added

- Initial release of `@photostructure/sqlite` - standalone SQLite for Node.js 20+
- Full compatibility with Node.js built-in SQLite module API
- Core SQLite operations with `DatabaseSync` and `StatementSync` classes
- User-defined scalar and aggregate functions with full window function support
- Database backup and restoration capabilities
- SQLite sessions and changesets for change tracking
- Extension loading support with automatic platform-specific file resolution
- TypeScript definitions with complete type coverage
- Cross-platform prebuilt binaries for Windows, macOS, and Linux (x64, ARM64)
- Comprehensive test suite with 89+ tests covering all functionality
- Memory safety validation with Valgrind and sanitizers
- Performance benchmarking suite comparing to better-sqlite3
- Automated synchronization from Node.js upstream SQLite implementation
- CI/CD pipeline with security scanning and multi-platform builds

### Features

- **Synchronous API**: Fast, blocking database operations ideal for scripts and tools
- **Parameter binding**: Support for all SQLite data types including BigInt
- **Error handling**: Detailed error messages with SQLite error codes
- **Resource limits**: Control memory usage and query complexity
- **Safe integer handling**: JavaScript-safe integer conversion with overflow detection
- **Multi-process support**: Safe concurrent access from multiple Node.js processes
- **Worker thread support**: Full functionality in worker threads
- **URI filename support**: Full SQLite URI syntax support for advanced database configuration
- **Strict tables**: Support for SQLite's strict table mode
- **Double-quoted strings**: Configurable SQL syntax compatibility

### Platform Support

- Node.js 20.0.0 and later
- Windows (x64, ARM64)
- macOS (x64, ARM64)
- Linux (x64, ARM64), (glibc 2.28+, musl)

[0.4.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.4.0
[0.3.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.3.0
[0.2.1]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.1
[0.2.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.0
[0.0.1]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.0.1
