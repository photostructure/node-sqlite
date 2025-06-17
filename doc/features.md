# Features

Comprehensive list of features and capabilities in @photostructure/sqlite.

## Core Features

- **100% API Compatible** with Node.js built-in sqlite module
- **Synchronous Operations** - Fast, blocking database operations
- **Zero Dependencies** - Pure native implementation
- **Cross-Platform** - Windows, macOS, Linux (x64 and ARM64)
- **Node.js 20+** - No experimental flags required
- **TypeScript Support** - Complete type definitions included
- **Performance** - Matches leading SQLite libraries in benchmarks

## SQLite Version

This package includes SQLite 3.46.1 (or later) with the following compile-time options enabled:

## Enabled SQLite Features

### Full-Text Search
- `SQLITE_ENABLE_FTS3` - Full-text search version 3
- `SQLITE_ENABLE_FTS3_PARENTHESIS` - Enhanced FTS3 query syntax
- `SQLITE_ENABLE_FTS4` - Full-text search version 4
- `SQLITE_ENABLE_FTS5` - Full-text search version 5 (latest)

### JSON Support
- `SQLITE_ENABLE_JSON1` - JSON functions and operators
- Full JSON path expressions
- JSON aggregation functions

### Advanced Features
- `SQLITE_ENABLE_RTREE` - R*Tree spatial indexing
- `SQLITE_ENABLE_GEOPOLY` - GeoJSON and polygon functions
- `SQLITE_ENABLE_MATH_FUNCTIONS` - Math functions (sin, cos, sqrt, etc.)
- `SQLITE_ENABLE_REGEXP` - REGEXP operator support
- `SQLITE_ENABLE_SOUNDEX` - Soundex algorithm

### Session Extension
- `SQLITE_ENABLE_SESSION` - Session and changeset support
- `SQLITE_ENABLE_PREUPDATE_HOOK` - Pre-update hooks for sessions
- Database replication capabilities
- Change tracking and synchronization

### Performance & Statistics
- `SQLITE_ENABLE_STAT4` - Advanced query planner statistics
- `SQLITE_ENABLE_DBSTAT_VTAB` - Database statistics virtual table
- `SQLITE_ENABLE_RBU` - Resumable Bulk Update support

### Other Features
- `SQLITE_ENABLE_COLUMN_METADATA` - Column metadata APIs
- `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` - LIMIT clause on UPDATE/DELETE
- `SQLITE_ENABLE_NORMALIZE` - Unicode normalization
- `SQLITE_ENABLE_SNAPSHOT` - Database snapshots
- `SQLITE_USE_URI` - URI filename support
- `SQLITE_DEFAULT_FOREIGN_KEYS=1` - Foreign keys enabled by default
- `SQLITE_THREADSAFE=2` - Multi-thread safe (serialized mode)

### Security & Safety
- `SQLITE_DQS=0` - Double-quoted strings disabled by default
- `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` - Safe WAL mode defaults
- `SQLITE_OMIT_DEPRECATED` - Deprecated features removed
- `SQLITE_OMIT_SHARED_CACHE` - Shared cache mode disabled (deprecated)

### Default Configuration
- `SQLITE_DEFAULT_CACHE_SIZE=-16000` - 16MB default cache
- Thread-safe multi-connection access
- Robust error handling with detailed error codes

## JavaScript/TypeScript Features

### Database Management
- In-memory databases (`:memory:`)
- File-based databases with full path support
- URI filenames with query parameters
- Read-only mode support
- Configurable busy timeout
- Foreign key constraint enforcement

### Statement Features
- Prepared statements with parameter binding
- Named and positional parameters
- Statement iteration support
- Expanded SQL for debugging
- Anonymous parameter support
- Automatic type conversions

### Custom Functions
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

### Data Type Support
- INTEGER (number and BigInt)
- REAL (number)
- TEXT (string)
- BLOB (Buffer)
- NULL (null)
- Automatic BigInt for large integers

### Error Handling
- Enhanced error information
- SQLite error codes
- Extended error codes
- System error numbers
- Human-readable error descriptions

## Platform Support

### Operating Systems
- **Windows**: 10 and later (x64, ARM64)
- **macOS**: 10.15 and later (x64, Apple Silicon)
- **Linux**: GLIBC 2.31+ (Ubuntu 20.04+, Debian 11+, RHEL 8+)
- **Alpine Linux**: 3.21+ (musl libc)

### Node.js Versions
- Node.js 20.0.0 and later
- Full worker thread support
- ESM and CommonJS compatibility

### Architecture
- x64 (Intel/AMD 64-bit)
- ARM64 (Apple Silicon, AWS Graviton, Raspberry Pi 4+)
- Prebuilt binaries for all platforms
- Automatic compilation fallback

## Not Included

These SQLite features are not enabled in this build:

- `SQLITE_ENABLE_ICU` - International Components for Unicode
- `SQLITE_ENABLE_MEMSYS5` - Alternative memory allocator
- `SQLITE_ENABLE_MEMSYS3` - Alternative memory allocator
- `SQLITE_ENABLE_UNLOCK_NOTIFY` - Unlock notification
- `SQLITE_ENABLE_ATOMIC_WRITE` - Atomic write support

## Comparison with Alternatives

See our [detailed comparison](./library-comparison.md) with:
- Node.js built-in sqlite module
- better-sqlite3
- node-sqlite3

## Performance Characteristics

- **Synchronous operations** eliminate async overhead
- **Direct SQLite C API** access
- **Minimal JavaScript wrapper** overhead
- **Efficient parameter binding**
- **Prepared statement caching**
- **Native performance** matching C applications

## Security Features

- **SQL injection protection** via prepared statements
- **Read-only database** support
- **URI filename sanitization**
- **Extension loading** disabled by default
- **Memory limits** configurable
- **Resource cleanup** on errors

## Next Steps

- [Getting Started](./getting-started.md) - Installation and first database
- [API Reference](./api-reference.md) - Complete API documentation
- [Advanced Patterns](./advanced-patterns.md) - Performance optimization tips