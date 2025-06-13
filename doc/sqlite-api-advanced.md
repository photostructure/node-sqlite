# SQLite Advanced Features API Reference

This document covers SQLite's advanced APIs including backup operations, blob I/O, sessions, and threading features. This is a machine-generated summary of documentation found on sqlite.org used as a reference during development.

## Table of Contents

1. [Backup API](#backup-api)
2. [Blob I/O](#blob-io)
3. [Session Extension](#session-extension)
4. [Threading and Concurrency](#threading-and-concurrency)
5. [Hooks and Callbacks](#hooks-and-callbacks)
6. [Extension Loading](#extension-loading)
7. [WAL Mode Operations](#wal-mode-operations)

## Backup API

The backup API allows copying database content between two databases while they are in use.

### Backup Functions

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

**Usage**:

1. Call `sqlite3_backup_init()` to create backup object
2. Call `sqlite3_backup_step()` repeatedly to copy pages
3. Call `sqlite3_backup_finish()` to clean up

**Parameters**:

- `nPage`: Number of pages to copy (-1 for all)
- Database names: "main", "temp", or attached database name

**Example**:

```c
sqlite3_backup *pBackup = sqlite3_backup_init(pDestDb, "main", pSrcDb, "main");
if (pBackup) {
    sqlite3_backup_step(pBackup, -1);  // Copy entire database
    sqlite3_backup_finish(pBackup);
}
```

**Reference**: https://sqlite.org/c3ref/backup_finish.html

## Blob I/O

Blob I/O provides incremental read/write access to blob values without loading entire blobs into memory.

### Opening Blobs

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
```

**Parameters**:

- `zDb`: Database name ("main", "temp", or attached name)
- `zTable`: Table name
- `zColumn`: Column name
- `iRow`: Row ID
- `flags`: 0 for read-only, 1 for read-write

### Blob Operations

```c
int sqlite3_blob_reopen(sqlite3_blob *, sqlite3_int64);
int sqlite3_blob_close(sqlite3_blob *);
int sqlite3_blob_bytes(sqlite3_blob *);
int sqlite3_blob_read(sqlite3_blob *, void *Z, int N, int iOffset);
int sqlite3_blob_write(sqlite3_blob *, const void *z, int n, int iOffset);
```

**Example**:

```c
sqlite3_blob *pBlob;
int rc = sqlite3_blob_open(db, "main", "mytable", "data", rowid, 0, &pBlob);
if (rc == SQLITE_OK) {
    int size = sqlite3_blob_bytes(pBlob);
    char *buffer = malloc(size);
    sqlite3_blob_read(pBlob, buffer, size, 0);
    sqlite3_blob_close(pBlob);
    free(buffer);
}
```

**Reference**: https://sqlite.org/c3ref/blob_open.html

## Session Extension

The session extension provides change tracking and conflict resolution capabilities.

### Session Objects

```c
int sqlite3session_create(
  sqlite3 *db,                    /* Database handle */
  const char *zDb,                /* Database name */
  sqlite3_session **ppSession     /* OUT: New session object */
);

void sqlite3session_delete(sqlite3_session *pSession);
```

### Tracking Changes

```c
int sqlite3session_attach(
  sqlite3_session *pSession,      /* Session object */
  const char *zTab                /* Table name or NULL for all */
);

int sqlite3session_changeset(
  sqlite3_session *pSession,      /* Session object */
  int *pnChangeset,               /* OUT: Size of changeset */
  void **ppChangeset              /* OUT: Changeset blob */
);

int sqlite3session_patchset(
  sqlite3_session *pSession,      /* Session object */
  int *pnPatchset,                /* OUT: Size of patchset */
  void **ppPatchset               /* OUT: Patchset blob */
);
```

### Applying Changes

```c
int sqlite3changeset_apply(
  sqlite3 *db,                    /* Apply changes to this db */
  int nChangeset,                 /* Size of changeset */
  void *pChangeset,               /* Changeset blob */
  int(*xFilter)(void *pCtx, const char *zTab),
  int(*xConflict)(void *pCtx, int eConflict, sqlite3_changeset_iter *p),
  void *pCtx                      /* First argument to callbacks */
);
```

**Reference**: https://sqlite.org/sessionintro.html

## Threading and Concurrency

### Thread Safety

```c
int sqlite3_threadsafe(void);
```

**Returns**:

- 0 - Thread safety disabled
- 1 - Serialized mode
- 2 - Multi-thread mode

### Mutex Functions

```c
sqlite3_mutex *sqlite3_db_mutex(sqlite3*);
void sqlite3_mutex_enter(sqlite3_mutex*);
int sqlite3_mutex_try(sqlite3_mutex*);
void sqlite3_mutex_leave(sqlite3_mutex*);
```

### Busy Handler

```c
int sqlite3_busy_handler(sqlite3*, int(*)(void*,int), void*);
int sqlite3_busy_timeout(sqlite3*, int ms);
```

**Description**: Set handler for locked database situations.

**Example**:

```c
// Simple timeout
sqlite3_busy_timeout(db, 5000);  // 5 second timeout

// Custom handler
int busyHandler(void *pArg, int count) {
    if (count < 10) {
        usleep(100000);  // Sleep 100ms
        return 1;        // Try again
    }
    return 0;            // Give up
}
sqlite3_busy_handler(db, busyHandler, NULL);
```

**Reference**: https://sqlite.org/c3ref/busy_handler.html

### Unlock Notification

```c
int sqlite3_unlock_notify(
  sqlite3 *pBlocked,
  void (*xNotify)(void **apArg, int nArg),
  void *pNotifyArg
);
```

**Description**: Request notification when database is unlocked.

**Reference**: https://sqlite.org/unlock_notify.html

## Hooks and Callbacks

### Update Hook

```c
void *sqlite3_update_hook(
  sqlite3*,
  void(*)(void *,int ,char const *,char const *,sqlite3_int64),
  void*
);
```

**Callback parameters**:

- User data pointer
- Operation: SQLITE_INSERT, SQLITE_DELETE, or SQLITE_UPDATE
- Database name
- Table name
- Row ID

### Commit and Rollback Hooks

```c
void *sqlite3_commit_hook(sqlite3*, int(*)(void*), void*);
void *sqlite3_rollback_hook(sqlite3*, void(*)(void *), void*);
```

### WAL Hook

```c
void *sqlite3_wal_hook(
  sqlite3*,
  int(*)(void *,sqlite3*,const char*,int),
  void*
);
```

**Callback parameters**:

- User data pointer
- Database connection
- Database name
- Number of pages in WAL

### Authorizer

```c
int sqlite3_set_authorizer(
  sqlite3*,
  int (*xAuth)(void*,int,const char*,const char*,const char*,const char*),
  void *pUserData
);
```

**Action codes include**:

- `SQLITE_CREATE_TABLE`
- `SQLITE_INSERT`
- `SQLITE_UPDATE`
- `SQLITE_DELETE`
- `SQLITE_SELECT`
- `SQLITE_PRAGMA`

**Return values**:

- `SQLITE_OK` - Allow
- `SQLITE_DENY` - Deny with error
- `SQLITE_IGNORE` - Silently ignore

**Reference**: https://sqlite.org/c3ref/set_authorizer.html

### Progress Handler

```c
void sqlite3_progress_handler(sqlite3*, int, int(*)(void*), void*);
```

**Parameters**:

- Database connection
- Number of VM instructions between callbacks
- Callback function (return non-zero to interrupt)
- User data

## Extension Loading

### Loading Extensions

```c
int sqlite3_load_extension(
  sqlite3 *db,
  const char *zFile,
  const char *zProc,
  char **pzErrMsg
);

int sqlite3_enable_load_extension(sqlite3 *db, int onoff);
```

**Parameters**:

- `zFile`: Extension filename
- `zProc`: Entry point (NULL for default)
- `pzErrMsg`: Error message pointer

### Auto-loading Extensions

```c
int sqlite3_auto_extension(void(*xEntryPoint)(void));
int sqlite3_cancel_auto_extension(void(*xEntryPoint)(void));
void sqlite3_reset_auto_extension(void);
```

**Reference**: https://sqlite.org/loadext.html

## WAL Mode Operations

### Checkpoint

```c
int sqlite3_wal_checkpoint_v2(
  sqlite3 *db,
  const char *zDb,
  int eMode,
  int *pnLog,
  int *pnCkpt
);
```

**Checkpoint modes**:

- `SQLITE_CHECKPOINT_PASSIVE` - Checkpoint as much as possible
- `SQLITE_CHECKPOINT_FULL` - Wait for writers, checkpoint all
- `SQLITE_CHECKPOINT_RESTART` - Like FULL, also wait for readers
- `SQLITE_CHECKPOINT_TRUNCATE` - Like RESTART, also truncate WAL

### WAL Filename

```c
const char *sqlite3_filename_database(const char*);
const char *sqlite3_filename_journal(const char*);
const char *sqlite3_filename_wal(const char*);
```

## Database Status

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

## Best Practices

1. **Backup operations**: Use small page counts for responsive UI
2. **Blob I/O**: Use for large blobs to reduce memory usage
3. **Threading**: Choose appropriate threading mode at compile time
4. **Busy handling**: Always set a busy handler or timeout
5. **Hooks**: Return quickly from hook callbacks
6. **WAL mode**: Use checkpoints during idle time
7. **Extensions**: Validate extensions before loading

## References

- SQLite Backup API: https://sqlite.org/backup.html
- SQLite Blob I/O: https://sqlite.org/c3ref/blob_open.html
- SQLite Session Extension: https://sqlite.org/sessionintro.html
- SQLite Threading: https://sqlite.org/threadsafe.html
- SQLite WAL Mode: https://sqlite.org/wal.html
