# SQLite build flags and configuration

**TL;DR**: We include 8 additional SQLite features beyond Node.js (JSON, FTS4, Unicode normalization, etc.) plus security-hardened defaults (foreign keys enabled, stricter SQL parsing, larger cache). The API remains fully compatible.

This document describes the SQLite build flags used in @photostructure/sqlite, compares them with Node.js's configuration, and explains the rationale behind our choices.

## Overview

Our SQLite build enables a broad set of features while maintaining security and performance. This configuration differs from Node.js's more conservative approach by including FTS4, NORMALIZE, and stricter security settings.

## Build configuration files

- **Our build configuration**: [`binding.gyp`](https://github.com/photostructure/node-sqlite/blob/main/binding.gyp) (lines 22-54)
- **Node.js SQLite configuration**: [`sqlite.gyp`](https://github.com/nodejs/node/blob/main/deps/sqlite/sqlite.gyp) (lines 15-28)

## Complete build flags comparison

### Core features present in both

| Flag                             | Purpose                               | @photostructure/sqlite | Node.js | Notes                                                                            |
| -------------------------------- | ------------------------------------- | :--------------------: | :-----: | -------------------------------------------------------------------------------- |
| `SQLITE_ENABLE_COLUMN_METADATA`  | Column metadata APIs                  |           ✅           |   ✅    | Required for schema introspection                                                |
| `SQLITE_ENABLE_DBSTAT_VTAB`      | Database statistics virtual table     |           ✅           |   ✅    | Performance monitoring                                                           |
| `SQLITE_ENABLE_FTS3`             | Full-text search version 3            |           ✅           |   ✅    | Basic FTS support                                                                |
| `SQLITE_ENABLE_FTS3_PARENTHESIS` | Enhanced FTS3 query syntax            |           ✅           |   ✅    | Improved query capabilities                                                      |
| `SQLITE_ENABLE_FTS5`             | Full-text search version 5            |           ✅           |   ✅    | Latest FTS with best performance                                                 |
| `SQLITE_ENABLE_GEOPOLY`          | GeoJSON and polygon functions         |           ✅           |   ✅    | Spatial data support                                                             |
| `SQLITE_ENABLE_MATH_FUNCTIONS`   | Math functions (sin, cos, sqrt, etc.) |           ✅           |   ✅    | Mathematical operations                                                          |
| `SQLITE_ENABLE_PREUPDATE_HOOK`   | Pre-update hooks for sessions         |           ✅           |   ✅    | Change tracking support                                                          |
| `SQLITE_ENABLE_RBU`              | Resumable Bulk Update support         |           ✅           |   ✅    | Incremental database updates                                                     |
| `SQLITE_ENABLE_RTREE`            | R\*Tree spatial indexing              |           ✅           |   ✅    | Spatial indexing capabilities                                                    |
| `SQLITE_ENABLE_SESSION`          | Session and changeset support         |           ✅           |   ✅    | Database replication features                                                    |
| `SQLITE_DEFAULT_MEMSTATUS=0`     | Disabled memory usage tracking        |           ✅           |   ✅    | `sqlite3_malloc()` routines run much faster                                      |
| `SQLITE_ENABLE_JSON1`            | JSON functions and operators          |           ✅           |   ✅    | Modern web development requires JSON support, defaults to enabled since v3.38.0+ |

### Additional features we include

| Flag                                | Purpose                           | @photostructure/sqlite | Node.js | Rationale                                           |
| ----------------------------------- | --------------------------------- | :--------------------: | :-----: | --------------------------------------------------- |
| `SQLITE_ENABLE_FTS4`                | Full-text search version 4        |           ✅           |   ❌    | Bridge between FTS3 and FTS5, broader compatibility |
| `SQLITE_ENABLE_NORMALIZE`           | Unicode normalization             |           ✅           |   ❌    | Proper Unicode handling for international apps      |
| `SQLITE_ENABLE_SNAPSHOT`            | Database snapshots                |           ✅           |   ❌    | Advanced backup and point-in-time recovery          |
| `SQLITE_ENABLE_STAT4`               | Advanced query planner statistics |           ✅           |   ❌    | Better query optimization                           |
| `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` | LIMIT clause on UPDATE/DELETE     |           ✅           |   ❌    | SQL standard compliance                             |
| `SQLITE_SOUNDEX`                    | Soundex algorithm                 |           ✅           |   ❌    | Fuzzy string matching capabilities                  |
| `SQLITE_USE_URI=1`                  | URI filename support              |           ✅           |   ❌    | Advanced database configuration via URIs            |

### Security and safety configurations

These include the majority of [SQLite's recommended compile options](https://sqlite.org/compile.html#recommended_compile_time_options)

| Flag                               | Purpose                                                                                                | @photostructure/sqlite | Node.js | Notes                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | :--------------------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_DEFAULT_FOREIGN_KEYS=1`    | [Foreign keys enabled by default](https://sqlite.org/compile.html#:~:text=SQLITE_DEFAULT_FOREIGN_KEYS) |           ✅           |   ❌    | Data integrity by default                                                                                                                |
| `SQLITE_DQS=0`                     | [Double-quoted strings disabled](https://sqlite.org/compile.html#:~:text=SQLITE_DQS%3D0)               |           ✅           |   ❌    | Prevents SQL ambiguity                                                                                                                   |
| `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` | [Safe WAL mode defaults](https://sqlite.org/compile.html#:~:text=SQLITE_DEFAULT_WAL_SYNCHRONOUS%3D1)   |           ✅           |   ❌    | Durability vs performance balance                                                                                                        |
| `SQLITE_OMIT_DEPRECATED`           | [Remove deprecated features](https://sqlite.org/compile.html#:~:text=SQLITE_OMIT_DEPRECATED)           |           ✅           |   ❌    | Smaller, more secure API surface                                                                                                         |
| `SQLITE_OMIT_SHARED_CACHE`         | [Disable shared cache mode](https://sqlite.org/compile.html#:~:text=SQLITE_OMIT_SHARED_CACHE)          |           ✅           |   ❌    | Shared cache is deprecated                                                                                                               |
| `SQLITE_LIKE_DOESNT_MATCH_BLOBS`   | [LIKE doesn't match BLOB data](https://sqlite.org/compile.html#:~:text=SQLITE_LIKE_DOESNT_MATCH_BLOBS) |           ✅           |   ❌    | LIKE and GLOB operators always return FALSE if either operand is a BLOB                                                                  |
| `SQLITE_ENABLE_API_ARMOR`          | [Validate C-API arguments](https://sqlite.org/compile.html#enable_api_armor)                           |           ✅           |   ❌    | Misused API calls return `SQLITE_MISUSE` instead of risking undefined behavior; defense-in-depth for hosted extensions (e.g. sqlite-vec) |

### Platform-specific build settings

#### Standard build flags (all platforms)

| Flag                  | Purpose                          | Notes                              |
| --------------------- | -------------------------------- | ---------------------------------- |
| `NAPI_CPP_EXCEPTIONS` | N-API C++ exception support      | Required for proper error handling |
| `HAVE_STDINT_H=1`     | Standard integer types available | Cross-platform compatibility       |
| `HAVE_USLEEP=1`       | usleep() function available      | Sleep functionality                |

#### Windows-specific security settings

For Windows builds, we include extensive security features:

**x64 Windows**:

- `/Qspectre` - Spectre variant 1 mitigations
- `/guard:cf` - Control Flow Guard
- `/ZH:SHA_256` - SHA-256 source file checksums
- `/sdl` - Security Development Lifecycle checks
- `/DYNAMICBASE` - Address Space Layout Randomization
- `/CETCOMPAT` - Control-flow Enforcement Technology

**ARM64 Windows**:

- Similar security flags minus `/Qspectre` (not available for ARM64)
- `/CETCOMPAT` not included (platform limitation)

## Rationale for extra features

### 1. JSON support (`SQLITE_ENABLE_JSON1`)

- Modern web applications use JSON extensively
- Enables efficient JSON storage and querying
- Faster than external JSON parsing
- Many other SQLite distributions include this

### 2. FTS4 (`SQLITE_ENABLE_FTS4`)

- Bridge between FTS3 and FTS5 for broader compatibility
- Supports applications migrating from older FTS versions
- Minimal overhead when not used

### 3. Unicode normalization (`SQLITE_ENABLE_NORMALIZE`)

- Proper Unicode handling for international applications
- Prevents Unicode-related data corruption
- Required for applications with non-ASCII text

### 4. Security defaults

- **Foreign Keys**: Enabled by default to prevent data integrity issues
- **DQS=0**: Prevents ambiguous SQL parsing
- **WAL Synchronous**: Balanced durability and performance

### 5. Performance features

- **STAT4**: Better query optimization with column statistics
- **16MB Cache**: Larger default cache for better performance
- **Multi-thread Mode**: Optimized for Node.js worker threads

## Features intentionally omitted

These SQLite features are available but not enabled in our build:

| Feature                       | Reason for omission                          |
| ----------------------------- | -------------------------------------------- |
| `SQLITE_ENABLE_ICU`           | Adds large ICU dependency, platform-specific |
| `SQLITE_ENABLE_MEMSYS3/5`     | Alternative allocators not needed            |
| `SQLITE_ENABLE_UNLOCK_NOTIFY` | Primarily for embedded systems               |
| `SQLITE_ENABLE_ATOMIC_WRITE`  | Platform-specific, limited benefit           |

## Security implications

### Enabled security features

1. **Foreign Key Enforcement**: Prevents referential integrity violations
2. **DQS=0**: Eliminates double-quoted string ambiguity
3. **Deprecated Feature Removal**: Reduces attack surface
4. **Safe WAL Defaults**: Balances performance with data durability

### Potential security considerations

1. **JSON Functions**: Could potentially be used for data exfiltration (mitigated by proper application design)
2. **Extension Loading**: Disabled by default in our implementation
3. **User-Defined Functions**: Properly sandboxed in our implementation

## Performance implications

### Performance benefits

1. **Larger Cache**: 16MB default vs 2MB improves read performance
2. **STAT4**: Better query optimization with advanced statistics
3. **Multi-thread Mode**: Optimized for concurrent access patterns
4. **JSON Functions**: Faster than external JSON parsing

### Performance considerations

1. **Binary Size**: Additional features increase library size by ~200KB
2. **Memory Usage**: More features mean higher base memory consumption
3. **Compilation Time**: More features extend build time
4. **API Armor**: `SQLITE_ENABLE_API_ARMOR` adds argument-validation checks at the C-API boundary. Benchmarking it on vs. off across `SELECT`/`INSERT`/`BLOB` workloads (30 trials each) showed all differences within run-to-run noise (~1–2%, with no consistent direction) — i.e. **no measurable runtime cost**, since the checks are never-taken branches on well-formed calls.

## Customizing build flags

To modify build flags for your specific use case:

### 1. Fork and modify

```bash
# Clone the repository
git clone https://github.com/photostructure/node-sqlite.git
cd node-sqlite

# Edit binding.gyp - modify the "defines" array
# Lines 22-54 contain the SQLite build flags

# Rebuild
npm run clean
npm run build:native
```

### 2. Common customizations

**Minimal build** (remove features):

```gyp
# Remove optional features for smaller binary
# Comment out or remove these lines:
"SQLITE_ENABLE_FTS4",
"SQLITE_ENABLE_JSON1",
"SQLITE_SOUNDEX",
"SQLITE_ENABLE_NORMALIZE",
```

**Maximum features** (add more features):

```gyp
# Add these to the defines array:
"SQLITE_ENABLE_ICU",           # Requires ICU library
"SQLITE_ENABLE_ATOMIC_WRITE",  # Platform-specific
```

**Performance tuning**:

```gyp
# Larger cache for memory-rich environments
"SQLITE_DEFAULT_CACHE_SIZE=-32000",  # 32MB cache

# Or smaller cache for memory-constrained environments
"SQLITE_DEFAULT_CACHE_SIZE=-4000",   # 4MB cache
```

## Maintenance and sync

### Keeping documentation in sync

When modifying build flags in `binding.gyp`:

1. **Update this document** with new flags and rationale
2. **Update [`features.md`](./features.md)** with user-facing feature descriptions
3. **Test thoroughly** to ensure new flags work correctly
4. **Update comparison tables** with any Node.js changes

### Monitoring upstream changes

We regularly check Node.js's `sqlite.gyp` for changes:

1. **Automated sync**: `scripts/sync-from-node.ts` monitors Node.js changes
2. **Manual review**: Quarterly review of Node.js SQLite configuration
3. **Issue tracking**: GitHub issues track when Node.js adds new flags

### Links for reference

- **SQLite Compile-Time Options**: https://sqlite.org/compile.html
- **SQLite Build Configuration**: https://sqlite.org/howtocompile.html
- **Node.js SQLite Source**: https://github.com/nodejs/node/tree/main/deps/sqlite
- **Our Build Configuration**: https://github.com/photostructure/node-sqlite/blob/main/binding.gyp
