# SQLite Core API Reference

This document covers the fundamental SQLite C/C++ APIs for database connections, basic operations, and error handling. This is a machine-generated summary of documentation found on sqlite.org used as a reference during development.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Database Connection](#database-connection)
3. [SQL Statement Execution](#sql-statement-execution)
4. [Error Handling](#error-handling)
5. [Transaction Control](#transaction-control)
6. [Utility Functions](#utility-functions)

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

## Utility Functions

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

### Library Version

```c
const char *sqlite3_libversion(void);
const char *sqlite3_sourceid(void);
int sqlite3_libversion_number(void);
```

### Randomness

```c
void sqlite3_randomness(int N, void *P);
```

### Status Information

```c
int sqlite3_status(int op, int *pCurrent, int *pHighwater, int resetFlag);
int sqlite3_status64(int op, sqlite3_int64 *pCurrent, sqlite3_int64 *pHighwater, int resetFlag);
```

## Important Constants

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

## References

- SQLite C/C++ Interface: https://sqlite.org/c3ref/intro.html
- SQLite Introduction: https://sqlite.org/cintro.html
- Result Codes: https://sqlite.org/rescode.html
- SQL Syntax: https://sqlite.org/lang.html
