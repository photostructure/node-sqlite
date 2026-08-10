# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

API compatible with `node:sqlite` from Node.js v26.7.0, plus three APIs landed upstream but not yet in a Node.js release line. SQLite is unchanged at 3.53.4.

### Added

- **`StatementSync.prototype.close()`**: Finalizes a prepared statement deterministically instead of waiting for garbage collection or database close. Throws `ERR_INVALID_STATE` if the statement is already finalized, if it is currently executing, or if called from inside an authorizer callback — `sqlite3_finalize()` modifies the connection, which SQLite forbids there, so `close()` joins the same guard the other statement methods use. Ported from [Node.js PR #64232](https://github.com/nodejs/node/pull/64232).
- **`StatementSync.prototype[Symbol.dispose]()`**: Enables `using stmt = db.prepare(...)`. Unlike `close()`, it is idempotent and never throws; the two cases `close()` rejects for safety become no-ops, leaving the statement to be finalized later by GC or database close. Also from [Node.js PR #64232](https://github.com/nodejs/node/pull/64232).
- **`ArrayBuffer` and `SharedArrayBuffer` parameter binding**: Both now bind as BLOBs, matching [Node.js PR #62061](https://github.com/nodejs/node/pull/62061). Previously only `ArrayBufferView`s (Buffer, TypedArray, DataView) were accepted.

These three landed on `nodejs/node@main` but are not in the `v26.x-staging` line this package syncs from, so they ship here ahead of their Node.js release. They are covered by this package's own tests; the corresponding upstream tests will arrive with a future sync.

### Fixed

- **Use-after-free when a session outlives its database**: `Session` holds a raw `DatabaseSync *`, and N-API finalization order between the two wrappers is unspecified. If the database was finalized first, every surviving session was left pointing at freed memory and the next session method dereferenced it. Both sides now clear the link, and an orphaned session reports `database is not open`. Confirmed with Valgrind before and after. Ports [Node.js PR #63797](https://github.com/nodejs/node/pull/63797) and [#64783](https://github.com/nodejs/node/pull/64783) in the shape our N-API port allows — upstream keeps the database alive with a strong reference, which we cannot do: a `Napi::Reference` member on a GC-finalized `ObjectWrap` corrupts V8 JIT pages on Alpine/musl (see commit 4da0638).
- **`ArrayBuffer` bound as SQL `NULL`**: An `ArrayBuffer` or `SharedArrayBuffer` passed as the sole argument to `run()`/`get()`/`all()` was treated as a named-parameter object rather than a value, leaving the real parameter unbound. The insert silently stored `NULL` instead of the blob.

### Changed

- **Smaller published tarball**: a `files` allowlist in `package.json` replaces `.npmignore`, dropping the package from 78 files to 46. Everything `binding.gyp` compiles still ships, so `node-gyp-build`'s source fallback is unaffected on platforms without a prebuild. Gone are the TypeScript sources (the published source maps already embed `sourcesContent`), the reference copies of Node.js's own `node_sqlite.cc`/`.h`, `Makefile`, `SECURITY.md`, and `osv-scanner.toml`.
- **Releases are staged for approval instead of published directly** (release process): `Build & Release` now signs and pushes the version commit and tag, then dispatches a tag-bound `Stage npm Release` workflow that rebuilds all eight prebuilds from the tag, packs one tarball, installs and loads it on every supported platform, and stages it on npm for a maintainer to approve with 2FA. Only the staging job holds npm publishing authority: it checks out no source, installs no dependencies, and runs no third-party action. See [RELEASE.md](RELEASE.md).
- **Upstream sync**: Node.js `v26.x-staging@68dc114` → `v26.x-staging@079339a`. Beyond the session lifetime fix above, this range adds `IsOpen()` guards to `enableLoadExtension()` and `setAuthorizer()` ([Node.js PR #64812](https://github.com/nodejs/node/pull/64812)) and marks the statement iterator done at exhaustion — all three already matched our port, which had them first. Upstream's `BaseObjectPtr` guards in `Exec()`/`applyChangeset()` ([Node.js PR #64535](https://github.com/nodejs/node/pull/64535)) do not apply: an N-API `ObjectWrap` receiver is rooted by the handle scope for the whole synchronous call, verified under Valgrind.
- **Close-inside-callback error message**: now `database cannot be closed while in a callback`, matching the wording upstream adopted in [Node.js PR #64743](https://github.com/nodejs/node/pull/64743). Previously `database cannot be closed inside a user-defined function callback`. The error `code` (`ERR_INVALID_STATE`) is unchanged; only the message text differs, so any test matching the old string needs updating.
- **Node.js compatibility tests sync from the same branch as the sources**: `sync:tests` defaulted to `main` while `sync:node` tracks `vNN.x-staging`, so the suite ran the next major's tests against current-line sources and reported failures for APIs that did not exist in the baseline. Both now resolve the same staging branch. `test-sqlite-udf-close.js` had also been downloaded but never adapted, so its four cases — the ones that pin the close-inside-callback message below — were absent from `npm run test:node`; the adapted file is now generated, and `sync-node-tests.ts` only runs its sync when invoked directly, so its exports can be reused without triggering one.
- **`memory:check` runs again** (developer tooling): the sanitizer harness had three independent faults, each masking the next. It exported `LD_PRELOAD` for the whole script, so `binding.gyp`'s `node -p` helper ran under LeakSanitizer, exited non-zero on an unrelated leak, and failed `configure`; it drove the build through `npx node-gyp`, which races on creating the `.deps` directories; and it preloaded only an ASan runtime, so the UBSan `*_abort` handlers were missing at load. The preload is now applied to the test command alone, the build goes through `npm run build:native:rebuild`, and both runtimes are preloaded. It also probes candidate ASan runtimes and skips any that cannot complete a leak check — clang's compiler-rt runtime wedges in LSan's `StopTheWorld` on clang 21 + Linux 7.x, where GCC's libasan works.
- **Benchmark comparison refreshed** (developer tooling): pinned `better-sqlite3` 13.0.3 and regenerated the published throughput table and charts.

## [2.2.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v2.2.0) (2026-07-25)

No API changes. Upstream refresh and dependency updates.

### Changed

- **SQLite 3.53.4**: Updated from 3.53.3. A bug-fix release addressing defects found in 3.53.0–3.53.3, largely by automated analysis — bounds hardening in the JSON/JSONB parsers plus fixes in the session and RBU modules ([release notes](https://www.sqlite.org/releaselog/3_53_4.html)). No API changes, but the amalgamation is compiled into the shipped binary, so any SQLite bump gets a minor release: consumers choose when to take it.
- **Upstream sync**: Node.js `v26.x-staging@955e669` → `v26.x-staging@68dc114`, now API compatible with `node:sqlite` from Node.js v26.5.0. The only `node_sqlite.cc` change in this range reads the column count after the first `step()` in `StatementSync.all()` ([Node.js PR #64219](https://github.com/nodejs/node/pull/64219)); our port already resolved column metadata lazily on the first row, so no change was needed.
- **TypeScript held at 6.x**: `.ncurc.cjs` now pins `typescript` to the 6.x line. TypeScript 7 is not yet supported by `typedoc` (0.28.20 peers `<= 6.0.x`) or `typescript-eslint` (8.63.0 peers `< 6.1.0`).

## [2.1.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v2.1.0) (2026-07-13)

No API changes. Build hardening, supply-chain verification, and one undefined-behavior fix.

### Changed

- **Compiler and linker hardening**: POSIX builds now follow the [OpenSSF hardening baseline](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html) — stack protector, `_FORTIFY_SOURCE=2`, format-string hardening, full RELRO, non-executable stack, and arch-gated control-flow integrity (Intel CET on x64, PAC/BTI on arm64). Windows ARM64 gains `/Qspectre` and `/guard:signret`, the backward-edge protection it previously lacked.
- **Vendored SQLite integrity**: the amalgamation sync now verifies the download against a SHA3-256 pinned in-tree and refuses to vendor a mismatch, instead of compiling whatever it fetched.

### Fixed

- **Empty changeset undefined behavior**: `session.changeset()` / `.patchset()` on a session with no recorded changes called `memcpy(NULL, NULL, 0)`, which is undefined behavior even at zero length. Results are unchanged (still a zero-length `Uint8Array`); the UB is gone. Surfaced by the new UndefinedBehaviorSanitizer pass in CI.

## [2.0.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v2.0.0) (2026-07-11)

API compatible with `node:sqlite` from Node.js v26.4.0.

### Added

- **`DatabaseSync.prototype.serialize([dbName])`** and **`DatabaseSync.prototype.deserialize(buffer, [options])`**: Serialize a database to a `Uint8Array` and load one back, matching the `node:sqlite` APIs added in Node.js [PR #59967](https://github.com/nodejs/node/pull/59967). Wraps `sqlite3_serialize` / `sqlite3_deserialize` and finalizes any open prepared statements before replacing database content.

### Changed

- **BREAKING**: Dropped support for Node.js 20 (end-of-life April 2026); `@photostructure/sqlite` now requires Node.js 22 or newer (`package.json` `engines` is `>=22`). This is why this release is 2.0.0 rather than a 1.x minor.
- **SQLite 3.53.3**: Updated from 3.53.0. Three patch releases (3.53.1–3.53.3), bug fixes only, no API impact ([release notes](https://www.sqlite.org/releaselog/3_53_3.html)).
- **Upstream sync**: Node.js `v25.x-staging@ffa9b8f` → `v26.x-staging@c96c838`. Beyond `serialize()`/`deserialize()`, upstream added a column-name caching path and a `simdutf` fast path for ASCII column text in `StatementSync` — both V8/internal-only optimizations with no N-API equivalent, so not ported. Subsequent `node:sqlite` bug fixes — closing the connection after a failed `open()`, changeset `xFilter`/callback-lifetime hardening, and reading the column count after the first `step()` in `all()` — are already covered by our port's structure and needed no change.
- **Statement finalization on `db.close()`**: Live `StatementSync` instances are now eagerly detached when their database closes, so further method calls throw `ERR_INVALID_STATE` with `"statement has been finalized"` (matching `node:sqlite`) instead of `"Database connection is closed"`. Statement error messages were also normalized to lowercase `"statement has been finalized"` throughout.
- **Build hardening (`SQLITE_ENABLE_API_ARMOR`)**: The bundled SQLite is now compiled with [API armor](https://sqlite.org/compile.html#enable_api_armor), so misuse of the C API — for example by a loaded extension such as [sqlite-vec](https://github.com/asg017/sqlite-vec) — returns `SQLITE_MISUSE` instead of risking undefined behavior or a process abort the caller cannot catch. Negligible runtime cost; the public JavaScript API is unaffected.
- **Callback reentrancy hardening**: operations SQLite forbids from inside its own callbacks (notably `close`/`deserialize`, plus `prepare`/`exec`/`step`/`serialize`/`setAuthorizer` from an authorizer) now throw `ERR_INVALID_STATE` instead of corrupting connection state. Intentional divergence from `node:sqlite` ([nodejs/node#63207](https://github.com/nodejs/node/issues/63207)).
- **Config setters frozen mid-step**: `setReadBigInts`, `setReturnArrays`, and the `setAllow*` parameter setters throw `ERR_INVALID_STATE` if called while the statement is executing.

### Fixed

- **Backup teardown stability**: In-flight `backup()` operations are now safe when a Node environment is shutting down. Backup jobs avoid resolving/rejecting promises or routing expected SQLite failures through node-addon-api's async worker error path after teardown begins.
- **Authorizer error identity**: the exact value thrown by an authorizer callback (subclass, `code`, message, thrown primitives) now propagates unchanged through prepare/exec/step/serialize/deserialize/changeset/extension load, instead of being replaced by a generic error.
- **TEXT with embedded NUL bytes**: returned in full via byte-length conversion instead of being truncated at the first NUL.

### Performance

- Faster multi-row reads: per-statement column-key caching, byte-length string conversion, per-column exception checks removed from the row builder, and a native iterator fast path for flat/raw modes.
- `-fno-plt` on Linux removes PLT indirection from Node-API calls in the hot path.

### Internal

- Docs: bulk-read performance tradeoff documented honestly; Node 22 requirement propagated across docs and examples.
- Benchmark suite reworked for fair, reproducible driver comparison (deterministic workloads, median confidence intervals, per-scenario ratios, SVG charts) plus correlation-gated memory-leak detection.
- Dependencies: node-addon-api 8.9.0, TypeScript 6, ESLint 10, prettier 3.8.5, `@types/node` 26.
- CI: pinned-action updates (CodeQL, TruffleHog, OSV-Scanner, actions/checkout).

## [1.2.1](https://github.com/PhotoStructure/node-sqlite/releases/tag/v1.2.1) (2026-04-27)

### Fixed

- **Packaging**: Excluded test extension artifact (`test_extension.so`) from published npm tarball. The CI pipeline's `download-artifact` steps lacked a `pattern` filter, causing the musl test fixture to be merged into `prebuilds/` alongside production binaries.

## [1.2.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v1.2.0) (2026-04-15)

API compatible with `node:sqlite` from Node.js v25.9.0.

### Changed

- **SQLite 3.53.0**: Updated from 3.52.0. Adds `json_array_insert()` / `jsonb_array_insert()` SQL functions, `ALTER TABLE` support for adding/removing `NOT NULL` and `CHECK` constraints, `REINDEX EXPRESSIONS` to rebuild expression indexes, `VACUUM INTO` `reserve=N` URI parameter, and new C APIs (`sqlite3_str_truncate`, `sqlite3_str_free`, `sqlite3_carray_bind_v2`, `SQLITE_PREPARE_FROM_DDL`, `SQLITE_DBCONFIG_FP_DIGITS`). Floating-point text conversion default changed from 15 to 17 significant digits. [Full release notes](https://www.sqlite.org/releaselog/3_53_0.html).
- **Upstream sync**: Node.js `v25.x-staging@ca2d6ea` → `ffa9b8f` (includes content through Node.js v25.9.0). Upstream made a cosmetic lambda-capture fix in `ApplyChangeset`'s filter callback; our port already used equivalent by-value captures.

### Fixed

- **Docs**: corrected stale "DataView parameter binding is not currently supported" note; `BLOB` binding accepts `TypedArray` or `DataView` input and returns `Uint8Array`.

### Internal

- **Test sync**: skip `test-sqlite-serialize.js` — Node.js `DatabaseSync.prototype.serialize()` / `deserialize()` APIs are not yet ported.

## [1.1.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v1.1.0) (2026-03-13)

### Changed

- **SQLite 3.51.3**: Reverted from 3.52.0 (retracted by the SQLite team)

## [1.0.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v1.0.0) (2026-03-07)

Promotion to v1.0.0 following API stabilization and 0.5.0 release.

API compatible with `node:sqlite` from Node.js v25.8.0.

### Added

- **`db.limits` property**: Get and set SQLite limits (length, sqlLength, column, exprDepth, compoundSelect, vdbeOp, functionArg, attach, likePatternLength, variableNumber, triggerDepth) at runtime. Supports `Infinity` to reset to compile-time maximum. Also accepts `limits` option in `DatabaseSync` constructor.
- **Statement iterator invalidation**: Calling `stmt.run()`, `stmt.get()`, `stmt.all()`, or `stmt.iterate()` now invalidates any active iterator on the same statement, throwing `ERR_INVALID_STATE`

### Changed

- **SQLite 3.52.0**: Updated from 3.51.2

## [0.5.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.5.0) (2026-02-06)

### Added

- **Statement modes via `enhance()`**: `stmt.pluck()`, `stmt.raw()`, `stmt.expand()` for better-sqlite3 compatibility
  - `.pluck()` returns only the first column value from queries
  - `.raw()` returns rows as arrays instead of objects
  - `.expand()` returns rows namespaced by table, correctly handling duplicate column names across JOINs
  - All three modes are mutually exclusive, matching better-sqlite3's toggle semantics
- **`stmt.database`**: Back-reference from prepared statements to their parent database instance
- **`EnhancedStatementMethods` type**: TypeScript interface for `pluck()`, `raw()`, `expand()`, and `database`

## [0.4.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.4.0) (2026-02-04)

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

## [0.3.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.3.0) (2025-12-17)

### Changed

- **BREAKING**: `SQLTagStore.size` changed from method to getter for Node.js API parity ([Node.js PR #60246](https://github.com/nodejs/node/pull/60246))
  - Before: `sql.size()`
  - After: `sql.size`
  - **Note**: This change was merged into Node.js main on December 11, 2025 and will appear in a future Node.js release. Current Node.js v24.x still uses `sql.size()` as a method.

## [0.2.1](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.1) (2025-12-01)

### Added

- Windows ARM64 prebuilt binaries

### Fixed

- Error message handling on Windows ARM64 (ABI compatibility)
- Error handling consistency across platforms

## [0.2.0](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.2.0) (2025-12-01)

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

## [0.0.1](https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.0.1) (2025-06-13)

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
