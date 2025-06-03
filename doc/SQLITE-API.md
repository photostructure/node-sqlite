# SQLite C/C++ API Reference

This document contains the essential SQLite C/C++ API documentation necessary for building a SQLite library implementation. All information is derived from official SQLite documentation.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Database Connection](#database-connection)
3. [SQL Statement Execution](#sql-statement-execution)
4. [Prepared Statements](#prepared-statements)
5. [Parameter Binding](#parameter-binding)
6. [Result Retrieval](#result-retrieval)
7. [Error Handling](#error-handling)
8. [Memory Management](#memory-management)
9. [Configuration](#configuration)
10. [Extension Functions](#extension-functions)
11. [Threading and Concurrency](#threading-and-concurrency)
12. [Backup API](#backup-api)
13. [Blob I/O](#blob-io)
14. [Important Constants](#important-constants)
15. [Data Types](#data-types)

## Core Concepts

SQLite uses several key objects:

- **sqlite3**: A database connection handle
- **sqlite3_stmt**: A prepared statement object
- **sqlite3_value**: A protected value object
- **sqlite3_context**: Function context for user-defined functions

## Database Connection

### Opening a Database

```c
int sqlite3_open(
  const char *filename,   /* Database filename (UTF-8) */
  sqlite3 **ppDb          /* OUT: SQLite db handle */
);

int sqlite3_open16(
  const void *filename,   /* Database filename (UTF-16) */
  sqlite3 **ppDb          /* OUT: SQLite db handle */
);

int sqlite3_open_v2(
  const char *filename,   /* Database filename (UTF-8) */
  sqlite3 **ppDb,         /* OUT: SQLite db handle */
  int flags,              /* Flags */
  const char *zVfs        /* Name of VFS module to use */
);
```

**Description**: Opens a connection to an SQLite database file.

**Special filenames**:

- `:memory:` - Creates a private, temporary in-memory database
- `""` (empty string) - Creates a private, temporary on-disk database

**Flags for sqlite3_open_v2**:

- `SQLITE_OPEN_READONLY` - Open in read-only mode
- `SQLITE_OPEN_READWRITE` - Open for reading and writing
- `SQLITE_OPEN_CREATE` - Create if doesn't exist
- `SQLITE_OPEN_URI` - Interpret filename as URI
- `SQLITE_OPEN_MEMORY` - Use in-memory database
- `SQLITE_OPEN_NOMUTEX` - No mutex (multi-thread unsafe)
- `SQLITE_OPEN_FULLMUTEX` - Full mutex (serialized)
- `SQLITE_OPEN_SHAREDCACHE` - Enable shared cache
- `SQLITE_OPEN_PRIVATECACHE` - Disable shared cache

**Returns**: `SQLITE_OK` on success, error code otherwise

**Reference**: https://sqlite.org/c3ref/open.html

### Closing a Database

```c
int sqlite3_close(sqlite3*);
int sqlite3_close_v2(sqlite3*);
```

**Description**: Closes a database connection and releases resources.

**Difference**:

- `sqlite3_close()` - Returns `SQLITE_BUSY` if resources not freed
- `sqlite3_close_v2()` - Marks connection as zombie, closes when possible

**Reference**: https://sqlite.org/c3ref/close.html

## SQL Statement Execution

### One-Step Query Execution

```c
int sqlite3_exec(
  sqlite3*,                                  /* Database handle */
  const char *sql,                           /* SQL to be evaluated */
  int (*callback)(void*,int,char**,char**),  /* Callback function */
  void *,                                    /* 1st argument to callback */
  char **errmsg                              /* Error msg written here */
);
```

**Description**: Convenience wrapper that executes SQL without preparing statements.

**Callback parameters**:

- First: User data pointer
- Second: Number of columns
- Third: Array of column values (as strings)
- Fourth: Array of column names

**Reference**: https://sqlite.org/c3ref/exec.html

## Prepared Statements

### Compiling SQL Statements

```c
int sqlite3_prepare_v2(
  sqlite3 *db,            /* Database handle */
  const char *zSql,       /* SQL statement, UTF-8 encoded */
  int nByte,              /* Maximum length of zSql in bytes. */
  sqlite3_stmt **ppStmt,  /* OUT: Statement handle */
  const char **pzTail     /* OUT: Pointer to unused portion of zSql */
);

int sqlite3_prepare_v3(
  sqlite3 *db,            /* Database handle */
  const char *zSql,       /* SQL statement, UTF-8 encoded */
  int nByte,              /* Maximum length of zSql in bytes. */
  unsigned int prepFlags, /* Zero or more SQLITE_PREPARE_ flags */
  sqlite3_stmt **ppStmt,  /* OUT: Statement handle */
  const char **pzTail     /* OUT: Pointer to unused portion of zSql */
);
```

**Description**: Compiles SQL text into a prepared statement.

**Parameters**:

- `nByte`: Number of bytes in zSql (-1 to read to first null terminator)
- `prepFlags`: Preparation flags (e.g., `SQLITE_PREPARE_PERSISTENT`)

**Reference**: https://sqlite.org/c3ref/prepare.html

### Executing Prepared Statements

```c
int sqlite3_step(sqlite3_stmt*);
```

**Description**: Evaluates a prepared statement.

**Returns**:

- `SQLITE_ROW` - Another row of data is available
- `SQLITE_DONE` - Statement has finished executing
- `SQLITE_BUSY` - Database is locked
- Error codes on failure

**Reference**: https://sqlite.org/c3ref/step.html

### Resetting Statements

```c
int sqlite3_reset(sqlite3_stmt *pStmt);
```

**Description**: Resets a prepared statement to its initial state.

**Note**: Does not clear parameter bindings (use `sqlite3_clear_bindings()` for that)

**Reference**: https://sqlite.org/c3ref/reset.html

### Finalizing Statements

```c
int sqlite3_finalize(sqlite3_stmt *pStmt);
```

**Description**: Destroys a prepared statement object.

**Reference**: https://sqlite.org/c3ref/finalize.html

## Parameter Binding

### Binding Functions

```c
int sqlite3_bind_blob(sqlite3_stmt*, int, const void*, int n, void(*)(void*));
int sqlite3_bind_blob64(sqlite3_stmt*, int, const void*, sqlite3_uint64, void(*)(void*));
int sqlite3_bind_double(sqlite3_stmt*, int, double);
int sqlite3_bind_int(sqlite3_stmt*, int, int);
int sqlite3_bind_int64(sqlite3_stmt*, int, sqlite3_int64);
int sqlite3_bind_null(sqlite3_stmt*, int);
int sqlite3_bind_text(sqlite3_stmt*,int,const char*,int,void(*)(void*));
int sqlite3_bind_text16(sqlite3_stmt*, int, const void*, int, void(*)(void*));
int sqlite3_bind_text64(sqlite3_stmt*, int, const char*, sqlite3_uint64, void(*)(void*), unsigned char encoding);
int sqlite3_bind_value(sqlite3_stmt*, int, const sqlite3_value*);
int sqlite3_bind_zeroblob(sqlite3_stmt*, int, int n);
int sqlite3_bind_zeroblob64(sqlite3_stmt*, int, sqlite3_uint64);
```

**Description**: Binds values to parameters in prepared statements.

**Parameters**:

- First: Statement handle
- Second: Parameter index (1-based)
- Third: Value to bind
- Fourth: Size in bytes (for blob/text)
- Fifth: Destructor function or special constant:
  - `SQLITE_STATIC` - Data is static, won't change
  - `SQLITE_TRANSIENT` - SQLite should make its own copy

**Reference**: https://sqlite.org/c3ref/bind_blob.html

### Parameter Information

```c
int sqlite3_bind_parameter_count(sqlite3_stmt*);
const char *sqlite3_bind_parameter_name(sqlite3_stmt*, int);
int sqlite3_bind_parameter_index(sqlite3_stmt*, const char *zName);
```

**Description**: Query information about statement parameters.

**Reference**: https://sqlite.org/c3ref/bind_parameter_count.html

## Result Retrieval

### Column Value Functions

```c
const void *sqlite3_column_blob(sqlite3_stmt*, int iCol);
double sqlite3_column_double(sqlite3_stmt*, int iCol);
int sqlite3_column_int(sqlite3_stmt*, int iCol);
sqlite3_int64 sqlite3_column_int64(sqlite3_stmt*, int iCol);
const unsigned char *sqlite3_column_text(sqlite3_stmt*, int iCol);
const void *sqlite3_column_text16(sqlite3_stmt*, int iCol);
sqlite3_value *sqlite3_column_value(sqlite3_stmt*, int iCol);
int sqlite3_column_bytes(sqlite3_stmt*, int iCol);
int sqlite3_column_bytes16(sqlite3_stmt*, int iCol);
int sqlite3_column_type(sqlite3_stmt*, int iCol);
```

**Description**: Extract column values from result rows.

**Note**: Column indices are 0-based

**Reference**: https://sqlite.org/c3ref/column_blob.html

### Column Metadata

```c
int sqlite3_column_count(sqlite3_stmt *pStmt);
const char *sqlite3_column_name(sqlite3_stmt*, int N);
```

**Description**: Query result set structure.

**Reference**: https://sqlite.org/c3ref/column_count.html

## Error Handling

### Error Code Functions

```c
int sqlite3_errcode(sqlite3 *db);
int sqlite3_extended_errcode(sqlite3 *db);
const char *sqlite3_errmsg(sqlite3*);
const void *sqlite3_errmsg16(sqlite3*);
const char *sqlite3_errstr(int);
```

**Description**: Retrieve error information.

**Reference**: https://sqlite.org/c3ref/errcode.html

### Result Codes

Primary result codes:

- `SQLITE_OK` (0) - Success
- `SQLITE_ERROR` (1) - Generic error
- `SQLITE_INTERNAL` (2) - Internal logic error
- `SQLITE_PERM` (3) - Access permission denied
- `SQLITE_ABORT` (4) - Callback requested abort
- `SQLITE_BUSY` (5) - Database file is locked
- `SQLITE_LOCKED` (6) - Table is locked
- `SQLITE_NOMEM` (7) - Memory allocation failed
- `SQLITE_READONLY` (8) - Attempt to write readonly database
- `SQLITE_INTERRUPT` (9) - Interrupted by sqlite3_interrupt()
- `SQLITE_IOERR` (10) - Disk I/O error
- `SQLITE_CORRUPT` (11) - Database disk image malformed
- `SQLITE_FULL` (13) - Database is full
- `SQLITE_CANTOPEN` (14) - Unable to open database file
- `SQLITE_CONSTRAINT` (19) - Constraint violation
- `SQLITE_MISMATCH` (20) - Data type mismatch
- `SQLITE_MISUSE` (21) - Library used incorrectly
- `SQLITE_ROW` (100) - Row ready
- `SQLITE_DONE` (101) - No more rows

**Reference**: https://sqlite.org/rescode.html

## Memory Management

### Memory Allocation

```c
void *sqlite3_malloc(int);
void *sqlite3_malloc64(sqlite3_uint64);
void *sqlite3_realloc(void*, int);
void *sqlite3_realloc64(void*, sqlite3_uint64);
void sqlite3_free(void*);
```

**Description**: SQLite memory allocation routines.

**Reference**: https://sqlite.org/c3ref/free.html

### Memory Statistics

```c
sqlite3_int64 sqlite3_memory_used(void);
sqlite3_int64 sqlite3_memory_highwater(int resetFlag);
```

**Description**: Query memory usage.

**Reference**: https://sqlite.org/c3ref/memory_highwater.html

## Configuration

### Global Configuration

```c
int sqlite3_config(int, ...);
```

**Configuration options**:

- `SQLITE_CONFIG_SINGLETHREAD` - Single-threaded mode
- `SQLITE_CONFIG_MULTITHREAD` - Multi-threaded mode
- `SQLITE_CONFIG_SERIALIZED` - Serialized mode
- `SQLITE_CONFIG_MALLOC` - Custom memory allocator
- `SQLITE_CONFIG_GETMALLOC` - Retrieve memory allocator
- `SQLITE_CONFIG_SCRATCH` - Scratch memory (deprecated)
- `SQLITE_CONFIG_PAGECACHE` - Page cache memory
- `SQLITE_CONFIG_HEAP` - Heap memory
- `SQLITE_CONFIG_MEMSTATUS` - Memory status tracking
- `SQLITE_CONFIG_MUTEX` - Custom mutex implementation
- `SQLITE_CONFIG_GETMUTEX` - Retrieve mutex implementation
- `SQLITE_CONFIG_LOOKASIDE` - Lookaside memory allocator
- `SQLITE_CONFIG_PCACHE2` - Page cache implementation
- `SQLITE_CONFIG_LOG` - Error logging callback
- `SQLITE_CONFIG_URI` - Enable URI filenames
- `SQLITE_CONFIG_COVERING_INDEX_SCAN` - Covering index scans
- `SQLITE_CONFIG_SQLLOG` - SQL logging
- `SQLITE_CONFIG_MMAP_SIZE` - Memory-mapped I/O size
- `SQLITE_CONFIG_STMTJRNL_SPILL` - Statement journal spill threshold
- `SQLITE_CONFIG_SMALL_MALLOC` - Optimize for small allocations
- `SQLITE_CONFIG_SORTERREF_SIZE` - Sorter reference size

**Reference**: https://sqlite.org/c3ref/config.html

### Database Configuration

```c
int sqlite3_db_config(sqlite3*, int op, ...);
```

**Database config options**:

- `SQLITE_DBCONFIG_MAINDBNAME` - Main database name
- `SQLITE_DBCONFIG_LOOKASIDE` - Lookaside memory
- `SQLITE_DBCONFIG_ENABLE_FKEY` - Foreign keys
- `SQLITE_DBCONFIG_ENABLE_TRIGGER` - Triggers
- `SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER` - FTS3 tokenizer
- `SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION` - Load extensions
- `SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE` - No checkpoint on close
- `SQLITE_DBCONFIG_ENABLE_QPSG` - Query planner stability guarantee
- `SQLITE_DBCONFIG_TRIGGER_EQP` - Trigger explain query plan
- `SQLITE_DBCONFIG_RESET_DATABASE` - Reset database
- `SQLITE_DBCONFIG_DEFENSIVE` - Defensive mode
- `SQLITE_DBCONFIG_WRITABLE_SCHEMA` - Writable schema
- `SQLITE_DBCONFIG_LEGACY_ALTER_TABLE` - Legacy ALTER TABLE
- `SQLITE_DBCONFIG_DQS_DML` - Double-quoted strings in DML
- `SQLITE_DBCONFIG_DQS_DDL` - Double-quoted strings in DDL
- `SQLITE_DBCONFIG_ENABLE_VIEW` - Views
- `SQLITE_DBCONFIG_LEGACY_FILE_FORMAT` - Legacy file format
- `SQLITE_DBCONFIG_TRUSTED_SCHEMA` - Trusted schema
- `SQLITE_DBCONFIG_STMT_SCANSTATUS` - Statement scan status
- `SQLITE_DBCONFIG_REVERSE_SCANORDER` - Reverse scan order

**Reference**: https://sqlite.org/c3ref/db_config.html

### Runtime Limits

```c
int sqlite3_limit(sqlite3*, int id, int newVal);
```

**Limit identifiers**:

- `SQLITE_LIMIT_LENGTH` - Max string/blob length
- `SQLITE_LIMIT_SQL_LENGTH` - Max SQL statement length
- `SQLITE_LIMIT_COLUMN` - Max columns in table/view/index/select/order-by
- `SQLITE_LIMIT_EXPR_DEPTH` - Max expression tree depth
- `SQLITE_LIMIT_COMPOUND_SELECT` - Max compound SELECT terms
- `SQLITE_LIMIT_VDBE_OP` - Max VM instructions
- `SQLITE_LIMIT_FUNCTION_ARG` - Max function arguments
- `SQLITE_LIMIT_ATTACHED` - Max attached databases
- `SQLITE_LIMIT_LIKE_PATTERN_LENGTH` - Max LIKE/GLOB pattern length
- `SQLITE_LIMIT_VARIABLE_NUMBER` - Max variables in SQL
- `SQLITE_LIMIT_TRIGGER_DEPTH` - Max trigger recursion depth
- `SQLITE_LIMIT_WORKER_THREADS` - Max auxiliary worker threads

**Reference**: https://sqlite.org/c3ref/limit.html

## Extension Functions

### User-Defined Functions

```c
int sqlite3_create_function(
  sqlite3 *db,
  const char *zFunctionName,
  int nArg,
  int eTextRep,
  void *pApp,
  void (*xFunc)(sqlite3_context*,int,sqlite3_value**),
  void (*xStep)(sqlite3_context*,int,sqlite3_value**),
  void (*xFinal)(sqlite3_context*)
);

int sqlite3_create_function_v2(
  sqlite3 *db,
  const char *zFunctionName,
  int nArg,
  int eTextRep,
  void *pApp,
  void (*xFunc)(sqlite3_context*,int,sqlite3_value**),
  void (*xStep)(sqlite3_context*,int,sqlite3_value**),
  void (*xFinal)(sqlite3_context*),
  void(*xDestroy)(void*)
);
```

**Parameters**:

- `nArg`: Number of arguments (-1 for variable)
- `eTextRep`: Text encoding and flags:
  - `SQLITE_UTF8` - UTF-8 encoding
  - `SQLITE_UTF16` - UTF-16 native byte order
  - `SQLITE_UTF16BE` - UTF-16 big-endian
  - `SQLITE_UTF16LE` - UTF-16 little-endian
  - `SQLITE_DETERMINISTIC` - Function is deterministic
  - `SQLITE_DIRECTONLY` - Function can only be used in top-level SQL
  - `SQLITE_INNOCUOUS` - Function is innocuous
- `pApp`: User data pointer
- `xFunc`: Scalar function implementation
- `xStep`/`xFinal`: Aggregate function implementation
- `xDestroy`: Destructor for pApp

**Reference**: https://sqlite.org/c3ref/create_function.html

### Function Context

```c
void *sqlite3_aggregate_context(sqlite3_context*, int nBytes);
void *sqlite3_get_auxdata(sqlite3_context*, int N);
void sqlite3_set_auxdata(sqlite3_context*, int N, void*, void (*)(void*));
void sqlite3_result_blob(sqlite3_context*, const void*, int, void(*)(void*));
void sqlite3_result_double(sqlite3_context*, double);
void sqlite3_result_error(sqlite3_context*, const char*, int);
void sqlite3_result_error_toobig(sqlite3_context*);
void sqlite3_result_error_nomem(sqlite3_context*);
void sqlite3_result_error_code(sqlite3_context*, int);
void sqlite3_result_int(sqlite3_context*, int);
void sqlite3_result_int64(sqlite3_context*, sqlite3_int64);
void sqlite3_result_null(sqlite3_context*);
void sqlite3_result_text(sqlite3_context*, const char*, int, void(*)(void*));
void sqlite3_result_value(sqlite3_context*, sqlite3_value*);
void sqlite3_result_zeroblob(sqlite3_context*, int n);
```

**Description**: Functions for working with user-defined function contexts.

**Reference**: https://sqlite.org/c3ref/aggregate_context.html

### Collations

```c
int sqlite3_create_collation(
  sqlite3*,
  const char *zName,
  int eTextRep,
  void *pArg,
  int(*xCompare)(void*,int,const void*,int,const void*)
);

int sqlite3_create_collation_v2(
  sqlite3*,
  const char *zName,
  int eTextRep,
  void *pArg,
  int(*xCompare)(void*,int,const void*,int,const void*),
  void(*xDestroy)(void*)
);
```

**Description**: Create custom text collation sequences.

**Reference**: https://sqlite.org/c3ref/create_collation.html

## Threading and Concurrency

### Thread Safety

```c
int sqlite3_threadsafe(void);
```

**Returns**:

- 0 - Thread safety disabled
- 1 - Serialized mode
- 2 - Multi-thread mode

**Reference**: https://sqlite.org/c3ref/threadsafe.html

### Busy Handler

```c
int sqlite3_busy_handler(sqlite3*,int(*)(void*,int),void*);
int sqlite3_busy_timeout(sqlite3*, int ms);
```

**Description**: Set handler for locked database situations.

**Reference**: https://sqlite.org/c3ref/busy_handler.html

### Database Status

```c
int sqlite3_db_status(sqlite3*, int op, int *pCur, int *pHiwtr, int resetFlg);
```

**Status operations**:

- `SQLITE_DBSTATUS_LOOKASIDE_USED` - Lookaside memory used
- `SQLITE_DBSTATUS_CACHE_USED` - Page cache memory used
- `SQLITE_DBSTATUS_SCHEMA_USED` - Schema memory used
- `SQLITE_DBSTATUS_STMT_USED` - Statement memory used
- `SQLITE_DBSTATUS_LOOKASIDE_HIT` - Lookaside hits
- `SQLITE_DBSTATUS_LOOKASIDE_MISS_SIZE` - Lookaside miss due to size
- `SQLITE_DBSTATUS_LOOKASIDE_MISS_FULL` - Lookaside miss due to full
- `SQLITE_DBSTATUS_CACHE_HIT` - Page cache hits
- `SQLITE_DBSTATUS_CACHE_MISS` - Page cache misses
- `SQLITE_DBSTATUS_CACHE_WRITE` - Page cache writes
- `SQLITE_DBSTATUS_DEFERRED_FKS` - Deferred foreign key constraints
- `SQLITE_DBSTATUS_CACHE_USED_SHARED` - Shared cache memory
- `SQLITE_DBSTATUS_CACHE_SPILL` - Cache spills

**Reference**: https://sqlite.org/c3ref/db_status.html

## Backup API

```c
sqlite3_backup *sqlite3_backup_init(
  sqlite3 *pDest,                        /* Destination database handle */
  const char *zDestName,                 /* Destination database name */
  sqlite3 *pSource,                      /* Source database handle */
  const char *zSourceName                /* Source database name */
);
int sqlite3_backup_step(sqlite3_backup *p, int nPage);
int sqlite3_backup_finish(sqlite3_backup *p);
int sqlite3_backup_remaining(sqlite3_backup *p);
int sqlite3_backup_pagecount(sqlite3_backup *p);
```

**Description**: Online backup interface for copying databases.

**Reference**: https://sqlite.org/c3ref/backup_finish.html

## Blob I/O

```c
int sqlite3_blob_open(
  sqlite3*,
  const char *zDb,
  const char *zTable,
  const char *zColumn,
  sqlite3_int64 iRow,
  int flags,
  sqlite3_blob **ppBlob
);
int sqlite3_blob_reopen(sqlite3_blob *, sqlite3_int64);
int sqlite3_blob_close(sqlite3_blob *);
int sqlite3_blob_bytes(sqlite3_blob *);
int sqlite3_blob_read(sqlite3_blob *, void *Z, int N, int iOffset);
int sqlite3_blob_write(sqlite3_blob *, const void *z, int n, int iOffset);
```

**Description**: Incremental I/O for database blobs.

**Reference**: https://sqlite.org/c3ref/blob_open.html

## Important Constants

### Text Encodings

```c
#define SQLITE_UTF8           1    /* IMP: R-37514-35566 */
#define SQLITE_UTF16LE        2    /* IMP: R-03371-37637 */
#define SQLITE_UTF16BE        3    /* IMP: R-51971-34154 */
#define SQLITE_UTF16          4    /* Use native byte order */
#define SQLITE_ANY            5    /* Deprecated */
#define SQLITE_UTF16_ALIGNED  8    /* sqlite3_create_collation only */
```

### Function Flags

```c
#define SQLITE_DETERMINISTIC    0x000000800
#define SQLITE_DIRECTONLY       0x000080000
#define SQLITE_SUBTYPE          0x000100000
#define SQLITE_INNOCUOUS        0x000200000
```

### Open Flags

```c
#define SQLITE_OPEN_READONLY         0x00000001  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_READWRITE        0x00000002  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_CREATE           0x00000004  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_DELETEONCLOSE    0x00000008  /* VFS only */
#define SQLITE_OPEN_EXCLUSIVE        0x00000010  /* VFS only */
#define SQLITE_OPEN_AUTOPROXY        0x00000020  /* VFS only */
#define SQLITE_OPEN_URI              0x00000040  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_MEMORY           0x00000080  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_MAIN_DB          0x00000100  /* VFS only */
#define SQLITE_OPEN_TEMP_DB          0x00000200  /* VFS only */
#define SQLITE_OPEN_TRANSIENT_DB     0x00000400  /* VFS only */
#define SQLITE_OPEN_MAIN_JOURNAL     0x00000800  /* VFS only */
#define SQLITE_OPEN_TEMP_JOURNAL     0x00001000  /* VFS only */
#define SQLITE_OPEN_SUBJOURNAL       0x00002000  /* VFS only */
#define SQLITE_OPEN_SUPER_JOURNAL    0x00004000  /* VFS only */
#define SQLITE_OPEN_NOMUTEX          0x00008000  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_FULLMUTEX        0x00010000  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_SHAREDCACHE      0x00020000  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_PRIVATECACHE     0x00040000  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_WAL              0x00080000  /* VFS only */
#define SQLITE_OPEN_NOFOLLOW         0x01000000  /* Ok for sqlite3_open_v2() */
#define SQLITE_OPEN_EXRESCODE        0x02000000  /* Extended result codes */
```

### Sync Flags

```c
#define SQLITE_SYNC_NORMAL        0x00002
#define SQLITE_SYNC_FULL          0x00003
#define SQLITE_SYNC_DATAONLY      0x00010
```

## Data Types

```c
#define SQLITE_INTEGER  1
#define SQLITE_FLOAT    2
#define SQLITE_TEXT     3
#define SQLITE_BLOB     4
#define SQLITE_NULL     5
```

## Transaction Control

SQLite transactions are controlled using SQL statements executed through the API:

```sql
BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE] [TRANSACTION]
COMMIT [TRANSACTION]
ROLLBACK [TRANSACTION]
SAVEPOINT savepoint_name
RELEASE [SAVEPOINT] savepoint_name
ROLLBACK TO [SAVEPOINT] savepoint_name
```

To check if a database is in autocommit mode:

```c
int sqlite3_get_autocommit(sqlite3*);
```

To set up commit and rollback hooks:

```c
void *sqlite3_commit_hook(sqlite3*, int(*)(void*), void*);
void *sqlite3_rollback_hook(sqlite3*, void(*)(void *), void*);
```

**Reference**: https://sqlite.org/lang_transaction.html

## Additional Information

### Row ID Functions

```c
sqlite3_int64 sqlite3_last_insert_rowid(sqlite3*);
void sqlite3_set_last_insert_rowid(sqlite3*,sqlite3_int64);
```

### Change Counting

```c
int sqlite3_changes(sqlite3*);
int sqlite3_total_changes(sqlite3*);
```

### Interrupt Operations

```c
void sqlite3_interrupt(sqlite3*);
```

### Value Object Functions

```c
const void *sqlite3_value_blob(sqlite3_value*);
double sqlite3_value_double(sqlite3_value*);
int sqlite3_value_int(sqlite3_value*);
sqlite3_int64 sqlite3_value_int64(sqlite3_value*);
const unsigned char *sqlite3_value_text(sqlite3_value*);
const void *sqlite3_value_text16(sqlite3_value*);
int sqlite3_value_bytes(sqlite3_value*);
int sqlite3_value_bytes16(sqlite3_value*);
int sqlite3_value_type(sqlite3_value*);
int sqlite3_value_numeric_type(sqlite3_value *);
sqlite3_value *sqlite3_value_dup(const sqlite3_value*);
void sqlite3_value_free(sqlite3_value*);
```

**Reference**: https://sqlite.org/c3ref/value_blob.html

## References

- SQLite C/C++ Interface: https://sqlite.org/c3ref/intro.html
- SQLite Introduction: https://sqlite.org/cintro.html
- Result Codes: https://sqlite.org/rescode.html
- SQL Syntax: https://sqlite.org/lang.html
- Pragma Statements: https://sqlite.org/pragma.html
- Compile-time Options: https://sqlite.org/compile.html
- SQLite Architecture: https://sqlite.org/arch.html

This document covers the essential SQLite C/C++ API functions needed to implement a SQLite library. For complete details on any function, refer to the official SQLite documentation at the provided URLs.
