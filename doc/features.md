# Features

Features and capabilities in @photostructure/sqlite.

## Core features

- **100% API Compatible** with Node.js built-in sqlite module
- **Synchronous Operations** - Fast, blocking database operations
- **Zero Dependencies** - Pure native implementation
- **Cross-Platform** - Windows, macOS, Linux (x64 and ARM64)
- **Node.js 22+** - No experimental flags required
- **TypeScript Support** - Complete type definitions included
- **Performance** - Matches leading SQLite libraries in benchmarks

## SQLite version

This package includes SQLite 3.53.4 with extensive compile-time options enabled. For complete build flag documentation, comparison with Node.js, and customization options, see [Build Flags & Configuration](./build-flags.md).

## Enabled SQLite features

### Full-text search

- `SQLITE_ENABLE_FTS3` - Full-text search version 3
- `SQLITE_ENABLE_FTS3_PARENTHESIS` - Enhanced FTS3 query syntax
- `SQLITE_ENABLE_FTS4` - Full-text search version 4
- `SQLITE_ENABLE_FTS5` - Full-text search version 5 (latest)

### JSON support

- `SQLITE_ENABLE_JSON1` - JSON functions and operators
- Full JSON path expressions
- JSON aggregation functions

### Advanced features

- `SQLITE_ENABLE_RTREE` - R\*Tree spatial indexing
- `SQLITE_ENABLE_GEOPOLY` - GeoJSON and polygon functions
- `SQLITE_ENABLE_MATH_FUNCTIONS` - Math functions (sin, cos, sqrt, etc.)
- `SQLITE_SOUNDEX` - Soundex algorithm

### Session extension

- `SQLITE_ENABLE_SESSION` - Session and changeset support
- `SQLITE_ENABLE_PREUPDATE_HOOK` - Pre-update hooks for sessions
- **Session class exposed** - Full access to SQLite sessions for advanced workflows
- Database replication capabilities
- Change tracking and synchronization

### Performance and statistics

- `SQLITE_ENABLE_STAT4` - Advanced query planner statistics
- `SQLITE_ENABLE_DBSTAT_VTAB` - Database statistics virtual table
- `SQLITE_ENABLE_RBU` - Resumable Bulk Update support

### Other features

- `SQLITE_ENABLE_COLUMN_METADATA` - Column metadata APIs
- `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` - LIMIT clause on UPDATE/DELETE
- `SQLITE_ENABLE_NORMALIZE` - Unicode normalization
- `SQLITE_ENABLE_SNAPSHOT` - Database snapshots
- `SQLITE_USE_URI` - URI filename support
- `SQLITE_DEFAULT_FOREIGN_KEYS=1` - Foreign keys enabled by default
- `SQLITE_THREADSAFE=2` - Multi-thread safe (serialized mode)

### Security and safety

- `SQLITE_DQS=0` - Double-quoted strings disabled by default
- `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` - Safe WAL mode defaults
- `SQLITE_OMIT_DEPRECATED` - Deprecated features removed
- `SQLITE_OMIT_SHARED_CACHE` - Shared cache mode disabled (deprecated)

### Default configuration

- `SQLITE_DEFAULT_CACHE_SIZE=-16000` - 16MB default cache
- Thread-safe multi-connection access
- Error handling with detailed error codes

## JavaScript/TypeScript features

### Database management

- In-memory databases (`:memory:`)
- File-based databases with full path support
- URI filenames with query parameters
- Read-only mode support
- Configurable busy timeout
- Foreign key constraint enforcement

### better-sqlite3 compatibility

- **`enhance()` function** - Adds `.pragma()` and `.transaction()` methods to any compatible database
- **Works with `node:sqlite`** - Enhance native `node:sqlite` DatabaseSync instances
- **Transaction helpers** - Automatic BEGIN/COMMIT/ROLLBACK with savepoint support for nested transactions
- **Pragma convenience** - Simple API for reading and setting SQLite pragmas

### Statement features

- Prepared statements with parameter binding
- Named and positional parameters
- Statement iteration support
- Expanded SQL for debugging
- Anonymous parameter support
- Automatic type conversions

### Custom functions

- Scalar function registration
- Aggregate function support
- Window function compatibility
- Deterministic function optimization
- Variable argument functions

### Advanced APIs

- Database backup with progress monitoring
- Session-based change tracking
- Changeset generation and application
- Conflict resolution callbacks
- Extension loading support

### Data type support

- INTEGER (number and BigInt, configurable via `readBigInts`)
- REAL (number)
- TEXT (string)
- BLOB (TypedArray/DataView/ArrayBuffer/SharedArrayBuffer input, Uint8Array output)
- NULL (null)

### Resource management

- **Automatic disposal** - DatabaseSync and StatementSync implement `Symbol.dispose` natively in C++
- **`using` statement support** - Automatic cleanup with explicit resource management
- **Manual cleanup** - Traditional close()/finalize() methods
- **Exception safety** - Resources cleaned up even when errors occur

### Error handling

- Enhanced error information
- SQLite error codes
- Extended error codes
- System error numbers
- Human-readable error descriptions

## Platform support

### Operating systems

- **Windows**: 10 and later (x64, ARM64)
- **macOS**: 10.15 and later (x64, Apple Silicon)
- **Linux**: GLIBC 2.31+ (Ubuntu 20.04+, Debian 11+, RHEL 8+)
- **Alpine Linux**: 3.21+ (musl libc)

### Node.js versions

- Node.js 22.0.0 and later
- Full worker thread support
- ESM and CommonJS compatibility

### Architecture

- x64 (Intel/AMD 64-bit)
- ARM64 (Apple Silicon, AWS Graviton, Raspberry Pi 4+)
- Prebuilt binaries for all platforms
- Automatic compilation fallback

## Not included

These SQLite features are not enabled in this build:

- `SQLITE_ENABLE_ICU` - International Components for Unicode
- `SQLITE_ENABLE_MEMSYS5` - Alternative memory allocator
- `SQLITE_ENABLE_MEMSYS3` - Alternative memory allocator
- `SQLITE_ENABLE_UNLOCK_NOTIFY` - Unlock notification
- `SQLITE_ENABLE_ATOMIC_WRITE` - Atomic write support

## Comparison with alternatives

See our [detailed comparison](./library-comparison.md) with:

- Node.js built-in sqlite module
- better-sqlite3
- node-sqlite3 (deprecated)

## Performance characteristics

- **Synchronous operations** eliminate async overhead
- **Direct SQLite C API** access
- **Minimal JavaScript wrapper** overhead
- **Efficient parameter binding**
- **Prepared statement caching**

## Security features

- **SQL injection protection** via prepared statements
- **Read-only database** support
- **URI filename sanitization**
- **Extension loading** disabled by default
- **Memory limits** configurable
- **Resource cleanup** on errors

## Next steps

- [Getting Started](./getting-started.md) - Installation and first database
- [Build Flags & Configuration](./build-flags.md) - Complete build flag documentation
- [API Reference](./api-reference.md) - Complete API documentation
- [Advanced Patterns](./advanced-patterns.md) - Performance optimization tips
