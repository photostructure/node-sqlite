# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] (2026-02-06)

### Added

- **Statement modes via `enhance()`**: `stmt.pluck()`, `stmt.raw()`, `stmt.expand()` for better-sqlite3 compatibility
  - `.pluck()` returns only the first column value from queries
  - `.raw()` returns rows as arrays instead of objects
  - `.expand()` returns rows namespaced by table, correctly handling duplicate column names across JOINs
  - All three modes are mutually exclusive, matching better-sqlite3's toggle semantics
- **`stmt.database`**: Back-reference from prepared statements to their parent database instance
- **`EnhancedStatementMethods` type**: TypeScript interface for `pluck()`, `raw()`, `expand()`, and `database`

## [0.4.0] (2026-02-04)

API compatible with `node:sqlite` from Node.js v25.6.1.

### Added

- **`enhance()` function**: Adds better-sqlite3-style `.pragma()` and `.transaction()` methods to any compatible database instance
- **`isEnhanced()` type guard**: Check if a database has enhanced methods
- **Transaction helper**: Automatic BEGIN/COMMIT/ROLLBACK with savepoint support for nested transactions
- **Pragma convenience method**: Simple API for reading and setting SQLite pragmas with `simple` option
- **Node.js test sync script**: `npm run sync:tests` downloads and adapts upstream Node.js SQLite tests
- **Percentile extension**: `SQLITE_ENABLE_PERCENTILE` now enabled, adding `percentile()`, `median()`, `percentile_cont()`, `percentile_disc()` SQL functions (Node.js v25+)
- **Prepare options**: `db.prepare(sql, options)` now accepts per-statement options (`readBigInts`, `returnArrays`, `allowBareNamedParameters`, `allowUnknownNamedParameters`) to override database-level defaults. This is a Node.js v25+ feature; `node:sqlite` on v24 and earlier silently ignores these options.
- **StatementColumnMetadata type**: `stmt.columns()` now returns richer metadata including `column`, `database`, `table`, and `type` properties alongside `name`
- **SQLite 3.51.2**: Updated from 3.51.1

### Changed

- **BREAKING**: Removed API extensions to achieve exact parity with `node:sqlite`:
  - Removed `stmt.finalize()` method (use database close for cleanup)
  - Removed `stmt.finalized` property
  - Removed `stmt[Symbol.dispose]` (still available on `DatabaseSync` and `Session`)
  - Removed `db.backup()` instance method (use standalone `backup(db, path)` function instead)
- **BREAKING**: `Session.changeset()` and `Session.patchset()` now return `Uint8Array` instead of `Buffer` to match `node:sqlite` API
- **BREAKING**: Defensive mode now defaults to `true` instead of `false` to match Node.js v25+ behavior. Use `{ defensive: false }` to restore old behavior.

### Fixed

- **Alpine Linux / musl stability**: Fixed native crashes by removing N-API reference cleanup from destructors that corrupted V8 JIT state
- **Session lifecycle management**: Fixed use-after-free, double-free, and mutex deadlock when databases are garbage collected before their sessions
- **Worker thread stability**: Added cleanup hooks and exception handling for worker thread termination
- **Callback error preservation**: `applyChangeset()` now preserves the original error message when JavaScript callbacks throw
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
- **SQLite error properties**: `sqliteCode`, `sqliteExtendedCode`, `code`, `sqliteErrorString`, `systemErrno`
- **ARM64 prebuilds**: macOS Apple Silicon and Windows ARM64 binaries
- **Tagged template literals**: `db.createTagStore()` for cached prepared statements (Node.js PR #58748)
- **Authorization API**: `db.setAuthorizer()` for security callbacks (Node.js PR #59928)
- **Standalone backup**: `backup(srcDb, destFile, options?)` for database backups with progress callbacks

### Fixed

- DataView parameter binding (previously returned garbage data)
- DataView and TypedArray return values in user-defined functions
- RETURNING clause metadata handling
- Null and empty values in user function return value conversion
- Native stability: N-API reference cleanup in aggregates/destructors, thread-local napi_env storage, statement-to-database reference tracking, deferred exception handling in authorizers

## [0.0.1] - 2025-06-13

### Added

- Initial release of `@photostructure/sqlite`, standalone SQLite for Node.js 20+
- Compatible with Node.js built-in SQLite module API
- Core SQLite operations with `DatabaseSync` and `StatementSync` classes
- User-defined scalar and aggregate functions with window function support
- Database backup and restoration
- SQLite sessions and changesets for change tracking
- Extension loading with automatic platform-specific file resolution
- TypeScript definitions
- Cross-platform prebuilt binaries for Windows, macOS, and Linux (x64, ARM64)
- Test suite with 89+ tests
- Memory safety validation with Valgrind and sanitizers
- Performance benchmarking suite comparing to better-sqlite3
- Automated synchronization from Node.js upstream SQLite implementation
- CI/CD pipeline with security scanning and multi-platform builds

### Features

- **Synchronous API**: Blocking database operations for scripts and tools
- **Parameter binding**: All SQLite data types including BigInt
- **Error handling**: Detailed error messages with SQLite error codes
- **Resource limits**: Control memory usage and query complexity
- **Safe integer handling**: JavaScript-safe integer conversion with overflow detection
- **Multi-process support**: Concurrent access from multiple Node.js processes
- **Worker thread support**: Works in worker threads
- **URI filename support**: SQLite URI syntax for advanced database configuration
- **Strict tables**: SQLite strict table mode
- **Double-quoted strings**: Configurable SQL syntax compatibility

### Platform Support

- Node.js 20.0.0 and later
- Windows (x64, ARM64)
- macOS (x64, ARM64)
- Linux (x64, ARM64), (glibc 2.28+, musl)

[0.5.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.5.0
[0.4.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.4.0
[0.3.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.3.0
[0.2.1]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.1
[0.2.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.0
[0.0.1]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.0.1
