# SQLite Statement API Reference

This document covers SQLite's prepared statement APIs, parameter binding, and result retrieval.

## Table of Contents

1. [Prepared Statements](#prepared-statements)
2. [Parameter Binding](#parameter-binding)
3. [Result Retrieval](#result-retrieval)
4. [Statement Metadata](#statement-metadata)
5. [Data Types](#data-types)

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

int sqlite3_prepare16_v2(
  sqlite3 *db,            /* Database handle */
  const void *zSql,       /* SQL statement, UTF-16 encoded */
  int nByte,              /* Maximum length of zSql in bytes */
  sqlite3_stmt **ppStmt,  /* OUT: Statement handle */
  const void **pzTail     /* OUT: Pointer to unused portion of zSql */
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

### Clearing Bindings

```c
int sqlite3_clear_bindings(sqlite3_stmt*);
```

**Description**: Resets all parameter bindings to NULL.

**Reference**: https://sqlite.org/c3ref/clear_bindings.html

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
int sqlite3_bind_pointer(sqlite3_stmt*, int, void*, const char*,void(*)(void*));
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
const void *sqlite3_column_name16(sqlite3_stmt*, int N);
```

**Description**: Query result set structure.

**Reference**: https://sqlite.org/c3ref/column_count.html

### Extended Column Metadata

```c
const char *sqlite3_column_database_name(sqlite3_stmt*,int);
const void *sqlite3_column_database_name16(sqlite3_stmt*,int);
const char *sqlite3_column_table_name(sqlite3_stmt*,int);
const void *sqlite3_column_table_name16(sqlite3_stmt*,int);
const char *sqlite3_column_origin_name(sqlite3_stmt*,int);
const void *sqlite3_column_origin_name16(sqlite3_stmt*,int);
```

**Description**: Get source database, table, and column names for result columns.

**Note**: Requires `SQLITE_ENABLE_COLUMN_METADATA` compile option.

**Reference**: https://sqlite.org/c3ref/column_database_name.html

## Statement Metadata

### SQL Text

```c
const char *sqlite3_sql(sqlite3_stmt *pStmt);
char *sqlite3_expanded_sql(sqlite3_stmt *pStmt);
const char *sqlite3_normalized_sql(sqlite3_stmt *pStmt);
```

**Description**: Get SQL text of prepared statement.

- `sqlite3_sql()` - Original SQL text
- `sqlite3_expanded_sql()` - SQL with bound parameters expanded
- `sqlite3_normalized_sql()` - SQL with literals replaced by parameters

**Reference**: https://sqlite.org/c3ref/expanded_sql.html

### Statement Status

```c
int sqlite3_stmt_busy(sqlite3_stmt*);
int sqlite3_stmt_readonly(sqlite3_stmt*);
int sqlite3_stmt_isexplain(sqlite3_stmt*);
int sqlite3_stmt_status(sqlite3_stmt*, int op, int resetFlg);
```

**Status operations**:

- `SQLITE_STMTSTATUS_FULLSCAN_STEP` - Full table scan steps
- `SQLITE_STMTSTATUS_SORT` - Sort operations
- `SQLITE_STMTSTATUS_AUTOINDEX` - Automatic index created
- `SQLITE_STMTSTATUS_VM_STEP` - Virtual machine steps
- `SQLITE_STMTSTATUS_REPREPARE` - Statement re-prepares
- `SQLITE_STMTSTATUS_RUN` - Statement executions
- `SQLITE_STMTSTATUS_MEMUSED` - Memory used

**Reference**: https://sqlite.org/c3ref/stmt_busy.html

### Database Handle

```c
sqlite3 *sqlite3_db_handle(sqlite3_stmt*);
```

**Description**: Get the database connection that owns a prepared statement.

**Reference**: https://sqlite.org/c3ref/db_handle.html

## Data Types

### Type Constants

```c
#define SQLITE_INTEGER  1
#define SQLITE_FLOAT    2
#define SQLITE_TEXT     3
#define SQLITE_BLOB     4
#define SQLITE_NULL     5
```

### Text Encodings

```c
#define SQLITE_UTF8           1    /* IMP: R-37514-35566 */
#define SQLITE_UTF16LE        2    /* IMP: R-03371-37637 */
#define SQLITE_UTF16BE        3    /* IMP: R-51971-34154 */
#define SQLITE_UTF16          4    /* Use native byte order */
#define SQLITE_ANY            5    /* Deprecated */
#define SQLITE_UTF16_ALIGNED  8    /* sqlite3_create_collation only */
```

### Memory Management Constants

```c
#define SQLITE_STATIC      ((void(*)(void *))0)
#define SQLITE_TRANSIENT   ((void(*)(void *))-1)
```

## Value Object Functions

```c
const void *sqlite3_value_blob(sqlite3_value*);
double sqlite3_value_double(sqlite3_value*);
int sqlite3_value_int(sqlite3_value*);
sqlite3_int64 sqlite3_value_int64(sqlite3_value*);
void *sqlite3_value_pointer(sqlite3_value*, const char*);
const unsigned char *sqlite3_value_text(sqlite3_value*);
const void *sqlite3_value_text16(sqlite3_value*);
const void *sqlite3_value_text16le(sqlite3_value*);
const void *sqlite3_value_text16be(sqlite3_value*);
int sqlite3_value_bytes(sqlite3_value*);
int sqlite3_value_bytes16(sqlite3_value*);
int sqlite3_value_type(sqlite3_value*);
int sqlite3_value_numeric_type(sqlite3_value*);
int sqlite3_value_nochange(sqlite3_value*);
int sqlite3_value_frombind(sqlite3_value*);
int sqlite3_value_subtype(sqlite3_value*);
sqlite3_value *sqlite3_value_dup(const sqlite3_value*);
void sqlite3_value_free(sqlite3_value*);
```

**Reference**: https://sqlite.org/c3ref/value_blob.html

## Best Practices

1. **Always finalize statements** when done to avoid memory leaks
2. **Reset statements** for reuse instead of re-preparing
3. **Use parameter binding** instead of string concatenation to avoid SQL injection
4. **Check return codes** from all API calls
5. **Handle SQLITE_BUSY** by implementing retry logic
6. **Use sqlite3_prepare_v2** instead of the older sqlite3_prepare
7. **Bind parameters** starting at index 1, not 0

## References

- SQLite Prepared Statements: https://sqlite.org/c3ref/prepare.html
- SQLite Binding: https://sqlite.org/c3ref/bind_blob.html
- SQLite Column Access: https://sqlite.org/c3ref/column_blob.html
- SQLite Data Types: https://sqlite.org/datatype3.html
