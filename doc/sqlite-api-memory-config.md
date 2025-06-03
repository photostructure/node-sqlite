# SQLite Memory Management and Configuration API Reference

This document covers SQLite's memory management, configuration options, and runtime limits.

## Table of Contents

1. [Memory Management](#memory-management)
2. [Global Configuration](#global-configuration)
3. [Database Configuration](#database-configuration)
4. [Runtime Limits](#runtime-limits)
5. [Compile-Time Options](#compile-time-options)
6. [Status and Statistics](#status-and-statistics)

## Memory Management

### Memory Allocation Functions

```c
void *sqlite3_malloc(int);
void *sqlite3_malloc64(sqlite3_uint64);
void *sqlite3_realloc(void*, int);
void *sqlite3_realloc64(void*, sqlite3_uint64);
void sqlite3_free(void*);
sqlite3_uint64 sqlite3_msize(void*);
```

**Description**: SQLite memory allocation routines that track memory usage.

**Note**: These functions are thread-safe and include internal bookkeeping.

**Reference**: https://sqlite.org/c3ref/free.html

### Memory Statistics

```c
sqlite3_int64 sqlite3_memory_used(void);
sqlite3_int64 sqlite3_memory_highwater(int resetFlag);
```

**Description**: Query global memory usage.

**Parameters**:

- `resetFlag`: If true, reset high-water mark after reading

### Soft Heap Limit

```c
sqlite3_int64 sqlite3_soft_heap_limit64(sqlite3_int64 N);
```

**Description**: Set a soft limit on heap size. SQLite tries to keep heap usage below this limit.

**Parameters**:

- `N`: New limit in bytes (-1 to query current limit)

**Reference**: https://sqlite.org/c3ref/soft_heap_limit64.html

### Memory Debugging

```c
void sqlite3_mem_debug(int);
void sqlite3_mem_trace(int);
```

**Description**: Enable memory debugging and tracing (requires special build).

## Global Configuration

### sqlite3_config()

```c
int sqlite3_config(int, ...);
```

**Must be called**: Before any other SQLite functions (except sqlite3_initialize).

### Memory Configuration Options

#### Custom Memory Allocator

```c
sqlite3_mem_methods mem = {
    myMalloc,     /* xMalloc */
    myFree,       /* xFree */
    myRealloc,    /* xRealloc */
    mySize,       /* xSize */
    myRoundup,    /* xRoundup */
    myInit,       /* xInit */
    myShutdown,   /* xShutdown */
    0             /* pAppData */
};
sqlite3_config(SQLITE_CONFIG_MALLOC, &mem);
```

#### Static Memory

```c
static char heap[8192000];
sqlite3_config(SQLITE_CONFIG_HEAP, heap, sizeof(heap), 64);
```

**Parameters**:

- Memory buffer
- Buffer size
- Minimum allocation size

#### Lookaside Memory

```c
sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 512, 128);
```

**Parameters**:

- Slot size
- Number of slots

### Threading Configuration

```c
sqlite3_config(SQLITE_CONFIG_SINGLETHREAD);
sqlite3_config(SQLITE_CONFIG_MULTITHREAD);
sqlite3_config(SQLITE_CONFIG_SERIALIZED);
```

**Modes**:

- `SINGLETHREAD`: No mutexes, not thread-safe
- `MULTITHREAD`: Thread-safe for separate connections
- `SERIALIZED`: Fully thread-safe

### Other Global Options

```c
// Enable/disable memory status tracking
sqlite3_config(SQLITE_CONFIG_MEMSTATUS, 0);  // 0=disable, 1=enable

// Set page cache
sqlite3_config(SQLITE_CONFIG_PAGECACHE, pBuf, sz, N);

// Enable URI filenames
sqlite3_config(SQLITE_CONFIG_URI, 1);

// Set error log callback
sqlite3_config(SQLITE_CONFIG_LOG, errorLogCallback, pArg);

// Configure mmap size
sqlite3_config(SQLITE_CONFIG_MMAP_SIZE, defaultSize, maxSize);

// Set mutex implementation
sqlite3_config(SQLITE_CONFIG_MUTEX, &myMutexMethods);

// Configure scratch memory (deprecated)
sqlite3_config(SQLITE_CONFIG_SCRATCH, 0, 0, 0);

// Set SQL log callback
sqlite3_config(SQLITE_CONFIG_SQLLOG, sqlLogCallback, pArg);

// Configure covering index scan
sqlite3_config(SQLITE_CONFIG_COVERING_INDEX_SCAN, 1);

// Set statement journal spill threshold
sqlite3_config(SQLITE_CONFIG_STMTJRNL_SPILL, nByte);

// Optimize for small malloc
sqlite3_config(SQLITE_CONFIG_SMALL_MALLOC, 1);

// Set sorter reference size
sqlite3_config(SQLITE_CONFIG_SORTERREF_SIZE, nByte);
```

**Reference**: https://sqlite.org/c3ref/config.html

## Database Configuration

### sqlite3_db_config()

```c
int sqlite3_db_config(sqlite3*, int op, ...);
```

**Can be called**: On open database connections.

### Security and Safety Options

```c
// Enable/disable foreign key constraints
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_FKEY, 1, &oldVal);

// Enable/disable triggers
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_TRIGGER, 1, &oldVal);

// Enable/disable views
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_VIEW, 1, &oldVal);

// Enable defensive mode (prevents corruption from app bugs)
sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, &oldVal);

// Enable writable schema
sqlite3_db_config(db, SQLITE_DBCONFIG_WRITABLE_SCHEMA, 1, &oldVal);

// Trust schema (skip some safety checks)
sqlite3_db_config(db, SQLITE_DBCONFIG_TRUSTED_SCHEMA, 1, &oldVal);
```

### Performance Options

```c
// Configure lookaside memory for this connection
sqlite3_db_config(db, SQLITE_DBCONFIG_LOOKASIDE, pBuf, sz, cnt);

// Disable checkpoint on close
sqlite3_db_config(db, SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, 1, &oldVal);

// Enable query planner stability guarantee
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_QPSG, 1, &oldVal);

// Trigger explain query plan
sqlite3_db_config(db, SQLITE_DBCONFIG_TRIGGER_EQP, 1, &oldVal);

// Enable statement scan status
sqlite3_db_config(db, SQLITE_DBCONFIG_STMT_SCANSTATUS, 1, &oldVal);

// Reverse scan order
sqlite3_db_config(db, SQLITE_DBCONFIG_REVERSE_SCANORDER, 1, &oldVal);
```

### Compatibility Options

```c
// Legacy ALTER TABLE behavior
sqlite3_db_config(db, SQLITE_DBCONFIG_LEGACY_ALTER_TABLE, 1, &oldVal);

// Double-quoted string literals in DML
sqlite3_db_config(db, SQLITE_DBCONFIG_DQS_DML, 1, &oldVal);

// Double-quoted string literals in DDL
sqlite3_db_config(db, SQLITE_DBCONFIG_DQS_DDL, 1, &oldVal);

// Legacy file format
sqlite3_db_config(db, SQLITE_DBCONFIG_LEGACY_FILE_FORMAT, 1, &oldVal);

// Enable FTS3 tokenizer
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER, 1, &oldVal);

// Enable load extension
sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, &oldVal);
```

### Database Name

```c
// Set main database name
sqlite3_db_config(db, SQLITE_DBCONFIG_MAINDBNAME, "main");
```

### Reset Database

```c
// Reset database file (dangerous!)
sqlite3_db_config(db, SQLITE_DBCONFIG_RESET_DATABASE, 1, 0);
```

**Reference**: https://sqlite.org/c3ref/db_config.html

## Runtime Limits

### sqlite3_limit()

```c
int sqlite3_limit(sqlite3*, int id, int newVal);
```

**Description**: Set or query per-connection limits.

**Parameters**:

- `id`: Limit identifier
- `newVal`: New limit (-1 to query only)

**Returns**: Previous limit value

### Limit Identifiers

```c
// Maximum string/blob length (default: 1000000000)
sqlite3_limit(db, SQLITE_LIMIT_LENGTH, 1000000);

// Maximum SQL statement length (default: 1000000000)
sqlite3_limit(db, SQLITE_LIMIT_SQL_LENGTH, 100000);

// Maximum columns (default: 2000)
sqlite3_limit(db, SQLITE_LIMIT_COLUMN, 100);

// Maximum expression tree depth (default: 1000)
sqlite3_limit(db, SQLITE_LIMIT_EXPR_DEPTH, 500);

// Maximum compound SELECT terms (default: 500)
sqlite3_limit(db, SQLITE_LIMIT_COMPOUND_SELECT, 50);

// Maximum VDBE instructions (default: 1000000000)
sqlite3_limit(db, SQLITE_LIMIT_VDBE_OP, 25000);

// Maximum function arguments (default: 127)
sqlite3_limit(db, SQLITE_LIMIT_FUNCTION_ARG, 8);

// Maximum attached databases (default: 125)
sqlite3_limit(db, SQLITE_LIMIT_ATTACHED, 10);

// Maximum LIKE pattern length (default: 50000)
sqlite3_limit(db, SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 1000);

// Maximum variable number (default: 999)
sqlite3_limit(db, SQLITE_LIMIT_VARIABLE_NUMBER, 99);

// Maximum trigger recursion depth (default: 1000)
sqlite3_limit(db, SQLITE_LIMIT_TRIGGER_DEPTH, 10);

// Maximum auxiliary worker threads (default: 0)
sqlite3_limit(db, SQLITE_LIMIT_WORKER_THREADS, 4);
```

**Reference**: https://sqlite.org/c3ref/limit.html

## Compile-Time Options

Important compile-time options that affect API behavior:

### Feature Toggles

```c
#define SQLITE_ENABLE_FTS5              // Full-text search v5
#define SQLITE_ENABLE_JSON1             // JSON functions
#define SQLITE_ENABLE_RTREE             // R-tree indexes
#define SQLITE_ENABLE_GEOPOLY           // Geopoly extension
#define SQLITE_ENABLE_SESSION           // Session extension
#define SQLITE_ENABLE_PREUPDATE_HOOK    // Pre-update hook
#define SQLITE_ENABLE_COLUMN_METADATA   // Column metadata APIs
#define SQLITE_ENABLE_STAT4             // Advanced query planner stats
#define SQLITE_ENABLE_UPDATE_DELETE_LIMIT // LIMIT on UPDATE/DELETE
```

### Security Options

```c
#define SQLITE_SECURE_DELETE            // Overwrite deleted content
#define SQLITE_ENABLE_CRYPTO            // Encryption support
#define SQLITE_ENABLE_SEE               // SQLite Encryption Extension
```

### Performance Options

```c
#define SQLITE_DEFAULT_CACHE_SIZE=-2000 // 2MB page cache
#define SQLITE_DEFAULT_PAGE_SIZE=4096   // 4KB pages
#define SQLITE_MAX_PAGE_SIZE=65536      // 64KB max page size
#define SQLITE_DEFAULT_WAL_AUTOCHECKPOINT=1000
#define SQLITE_ENABLE_SORTER_REFERENCES // Sorter optimization
#define SQLITE_MAX_WORKER_THREADS=8     // Worker thread limit
```

### Memory Options

```c
#define SQLITE_DEFAULT_MEMSTATUS=0      // Disable memory tracking
#define SQLITE_DEFAULT_LOOKASIDE=1200,100 // Lookaside configuration
#define SQLITE_ENABLE_MEMSYS3           // Alternative memory allocator
#define SQLITE_ENABLE_MEMSYS5           // Alternative memory allocator
#define SQLITE_ZERO_MALLOC              // Omit memory allocator
```

## Status and Statistics

### Global Status

```c
int sqlite3_status(int op, int *pCurrent, int *pHighwater, int resetFlag);
int sqlite3_status64(int op, sqlite3_int64 *pCurrent,
                     sqlite3_int64 *pHighwater, int resetFlag);
```

**Status operations**:

- `SQLITE_STATUS_MEMORY_USED` - Current memory in use
- `SQLITE_STATUS_PAGECACHE_USED` - Page cache memory
- `SQLITE_STATUS_PAGECACHE_OVERFLOW` - Page cache overflows
- `SQLITE_STATUS_SCRATCH_USED` - Scratch memory (deprecated)
- `SQLITE_STATUS_MALLOC_SIZE` - Largest malloc request
- `SQLITE_STATUS_PARSER_STACK` - Parser stack depth
- `SQLITE_STATUS_PAGECACHE_SIZE` - Page cache allocation size
- `SQLITE_STATUS_SCRATCH_SIZE` - Scratch allocation size
- `SQLITE_STATUS_MALLOC_COUNT` - Number of mallocs

### Database Status

```c
int sqlite3_db_status(sqlite3*, int op, int *pCur, int *pHiwtr, int resetFlg);
```

**Operations** (see Advanced Features document for full list)

### Statement Status

```c
int sqlite3_stmt_status(sqlite3_stmt*, int op, int resetFlg);
```

**Operations**:

- `SQLITE_STMTSTATUS_FULLSCAN_STEP` - Full table scan steps
- `SQLITE_STMTSTATUS_SORT` - Sort operations
- `SQLITE_STMTSTATUS_AUTOINDEX` - Automatic indexes created
- `SQLITE_STMTSTATUS_VM_STEP` - Virtual machine steps
- `SQLITE_STMTSTATUS_REPREPARE` - Statement re-preparations
- `SQLITE_STMTSTATUS_RUN` - Times statement has been run
- `SQLITE_STMTSTATUS_MEMUSED` - Memory used by statement

## Best Practices

1. **Configure early**: Call sqlite3_config() before any other SQLite functions
2. **Set appropriate limits**: Use sqlite3_limit() to prevent resource exhaustion
3. **Monitor memory**: Use status functions to track memory usage
4. **Choose threading mode**: Select appropriate threading model at startup
5. **Enable only needed features**: Use compile-time options to reduce size
6. **Test configuration**: Verify settings work correctly in your environment
7. **Document settings**: Keep track of non-default configurations

## Common Configuration Patterns

### Low Memory Environment

```c
// Use static memory allocation
static char heap[2048000];
sqlite3_config(SQLITE_CONFIG_HEAP, heap, sizeof(heap), 64);
sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 128, 32);
sqlite3_config(SQLITE_CONFIG_PAGECACHE, pageCache, 1024, 100);
```

### High Performance

```c
// Increase cache sizes
sqlite3_db_config(db, SQLITE_DBCONFIG_LOOKASIDE, NULL, 512, 200);
sqlite3_exec(db, "PRAGMA cache_size=10000", 0, 0, 0);
sqlite3_exec(db, "PRAGMA temp_store=MEMORY", 0, 0, 0);
sqlite3_limit(db, SQLITE_LIMIT_WORKER_THREADS, 4);
```

### Maximum Safety

```c
// Enable all safety features
sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
sqlite3_db_config(db, SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, NULL);
sqlite3_exec(db, "PRAGMA synchronous=FULL", 0, 0, 0);
sqlite3_exec(db, "PRAGMA foreign_keys=ON", 0, 0, 0);
```

## References

- SQLite Configuration: https://sqlite.org/c3ref/config.html
- SQLite Limits: https://sqlite.org/limits.html
- SQLite Compile Options: https://sqlite.org/compile.html
- SQLite Memory: https://sqlite.org/malloc.html
- SQLite Status: https://sqlite.org/c3ref/status.html
