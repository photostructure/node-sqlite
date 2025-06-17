# SQLite Extension API Reference

This document covers SQLite's extension APIs including user-defined functions, aggregate functions, collations, and virtual tables. This is a machine-generated summary of documentation found on sqlite.org used as a reference during development.

## Table of Contents

1. [User-Defined Functions](#user-defined-functions)
2. [Aggregate Functions](#aggregate-functions)
3. [Window Functions](#window-functions)
4. [Collations](#collations)
5. [Virtual Tables](#virtual-tables)
6. [Auxiliary Data](#auxiliary-data)

## User-Defined Functions

### Function Registration

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

- `db`: Database connection
- `zFunctionName`: Function name (max 255 UTF-8 bytes)
- `nArg`: Number of arguments (-1 for variable arguments)
- `eTextRep`: Text encoding and flags (can be ORed together):
  - `SQLITE_UTF8` - UTF-8 encoding (default)
  - `SQLITE_UTF16` - UTF-16 encoding (native endianness)
  - `SQLITE_UTF16BE` - UTF-16 big-endian
  - `SQLITE_UTF16LE` - UTF-16 little-endian
  - `SQLITE_DETERMINISTIC` - Function always returns same result for same inputs
  - `SQLITE_DIRECTONLY` - Function cannot be used in triggers, views, CHECK constraints
  - `SQLITE_INNOCUOUS` - Function has no side effects
  - `SQLITE_SUBTYPE` - Function may use sqlite3_result_subtype()
- `pApp`: User data pointer accessible via sqlite3_user_data()
- `xFunc`: Scalar function implementation (NULL for aggregates)
- `xStep`/`xFinal`: Aggregate function implementation (NULL for scalar functions)
- `xDestroy`: Destructor for pApp (called when function is deleted)

**Reference**: https://sqlite.org/c3ref/create_function.html

### Function Context

```c
// Get user data passed during registration
void *sqlite3_user_data(sqlite3_context*);

// Get database connection from context
sqlite3 *sqlite3_context_db_handle(sqlite3_context*);
```

### Setting Function Results

```c
// Basic result setters
void sqlite3_result_null(sqlite3_context*);
void sqlite3_result_int(sqlite3_context*, int);
void sqlite3_result_int64(sqlite3_context*, sqlite3_int64);
void sqlite3_result_double(sqlite3_context*, double);

// Text results
void sqlite3_result_text(sqlite3_context*, const char*, int n, void(*)(void*));
void sqlite3_result_text16(sqlite3_context*, const void*, int n, void(*)(void*));
void sqlite3_result_text16le(sqlite3_context*, const void*, int n, void(*)(void*));
void sqlite3_result_text16be(sqlite3_context*, const void*, int n, void(*)(void*));
void sqlite3_result_text64(sqlite3_context*, const char*, sqlite3_uint64, void(*)(void*), unsigned char encoding);

// Blob results
void sqlite3_result_blob(sqlite3_context*, const void*, int n, void(*)(void*));
void sqlite3_result_blob64(sqlite3_context*, const void*, sqlite3_uint64 n, void(*)(void*));
void sqlite3_result_zeroblob(sqlite3_context*, int n);
void sqlite3_result_zeroblob64(sqlite3_context*, sqlite3_uint64 n);

// Error results
void sqlite3_result_error(sqlite3_context*, const char*, int);
void sqlite3_result_error16(sqlite3_context*, const void*, int);
void sqlite3_result_error_toobig(sqlite3_context*);
void sqlite3_result_error_nomem(sqlite3_context*);
void sqlite3_result_error_code(sqlite3_context*, int);

// Special results
void sqlite3_result_subtype(sqlite3_context*, unsigned int);
void sqlite3_result_pointer(sqlite3_context*, void*, const char*, void(*)(void*));
```

**Memory Management**: For text and blob results, the last parameter specifies:

- `SQLITE_STATIC` - Data is static and won't change
- `SQLITE_TRANSIENT` - SQLite should make its own copy (safest)
- Custom destructor function pointer

**Reference**: https://sqlite.org/c3ref/result_blob.html

### Type Constants

```c
#define SQLITE_INTEGER  1
#define SQLITE_FLOAT    2
#define SQLITE_TEXT     3
#define SQLITE_BLOB     4
#define SQLITE_NULL     5
```

These constants are returned by `sqlite3_value_type()` and are used to identify the datatype of a value object.

### Value Extraction

```c
// Type checking
int sqlite3_value_type(sqlite3_value*);        // Returns one of the type constants above
int sqlite3_value_numeric_type(sqlite3_value*); // Type after numeric conversion

// Value extraction
int sqlite3_value_int(sqlite3_value*);
sqlite3_int64 sqlite3_value_int64(sqlite3_value*);
double sqlite3_value_double(sqlite3_value*);
const unsigned char *sqlite3_value_text(sqlite3_value*);
const void *sqlite3_value_text16(sqlite3_value*);
const void *sqlite3_value_blob(sqlite3_value*);
void *sqlite3_value_pointer(sqlite3_value*, const char*);
int sqlite3_value_bytes(sqlite3_value*);
int sqlite3_value_bytes16(sqlite3_value*);

// Special value checks
int sqlite3_value_subtype(sqlite3_value*);
int sqlite3_value_nochange(sqlite3_value*);
int sqlite3_value_frombind(sqlite3_value*);
```

**Reference**: https://sqlite.org/c3ref/value_blob.html

## Aggregate Functions

Aggregate functions are created using the same `sqlite3_create_function` APIs but with both `xStep` and `xFinal` callbacks.

### Step Function

Called once for each row in the group:

```c
void xStep(sqlite3_context *ctx, int argc, sqlite3_value **argv);
```

### Final Function

Called once after all rows have been processed:

```c
void xFinal(sqlite3_context *ctx);
```

### Aggregate Context

Use `sqlite3_aggregate_context()` to maintain state between calls:

```c
void *sqlite3_aggregate_context(sqlite3_context*, int nBytes);
```

**Important Notes**:

- SQLite allocates the memory and zeros it on first call with nBytes > 0
- Subsequent calls return the same memory pointer
- Memory is automatically freed after xFinal is called
- Pass 0 for nBytes in xFinal to get existing context without allocation

**Example**:

```c
typedef struct {
    int count;
    double sum;
} AggregateData;

void myStep(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
    AggregateData *data = (AggregateData*)sqlite3_aggregate_context(ctx, sizeof(AggregateData));
    if (data) {
        // First call: data is zero-initialized by SQLite
        data->count++;
        data->sum += sqlite3_value_double(argv[0]);
    }
}

void myFinal(sqlite3_context *ctx) {
    AggregateData *data = (AggregateData*)sqlite3_aggregate_context(ctx, 0);
    if (data && data->count > 0) {
        sqlite3_result_double(ctx, data->sum / data->count);
    } else {
        sqlite3_result_null(ctx);
    }
}
```

**C++ Object Initialization**:

For C++ objects that need proper construction, use placement new:

```cpp
struct ComplexAggregateData {
    std::vector<double> values;
    ComplexAggregateData() : values() {}
};

void cppStep(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
    void *buffer = sqlite3_aggregate_context(ctx, sizeof(ComplexAggregateData));
    if (buffer) {
        ComplexAggregateData *data = static_cast<ComplexAggregateData*>(buffer);

        // First time: construct the object in-place
        if (data->values.empty() && sqlite3_value_type(argv[0]) != SQLITE_NULL) {
            new (data) ComplexAggregateData();
        }

        data->values.push_back(sqlite3_value_double(argv[0]));
    }
}
```

## Window Functions

Window functions extend aggregate functions with additional callbacks:

```c
int sqlite3_create_window_function(
  sqlite3 *db,
  const char *zFunctionName,
  int nArg,
  int eTextRep,
  void *pApp,
  void (*xStep)(sqlite3_context*,int,sqlite3_value**),
  void (*xFinal)(sqlite3_context*),
  void (*xValue)(sqlite3_context*),
  void (*xInverse)(sqlite3_context*,int,sqlite3_value**),
  void(*xDestroy)(void*)
);
```

**Additional callbacks**:

- `xValue`: Get current aggregate value without finalizing
- `xInverse`: Remove a row from the window (for sliding windows)

**Reference**: https://sqlite.org/windowfunctions.html

## Collations

### Creating Collations

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

**Compare function signature**:

```c
int xCompare(
  void *pArg,          /* User data from registration */
  int nKey1,           /* Length of first string */
  const void *pKey1,   /* First string */
  int nKey2,           /* Length of second string */
  const void *pKey2    /* Second string */
);
```

**Returns**:

- Negative if pKey1 < pKey2
- Zero if pKey1 == pKey2
- Positive if pKey1 > pKey2

**Reference**: https://sqlite.org/c3ref/create_collation.html

### Collation Needed Callback

```c
int sqlite3_collation_needed(
  sqlite3*,
  void*,
  void(*)(void*,sqlite3*,int eTextRep,const char*)
);
```

**Description**: Register a callback to be invoked when an unknown collation is needed.

## Virtual Tables

Virtual tables allow custom data sources to appear as regular SQLite tables.

### Module Registration

```c
int sqlite3_create_module(
  sqlite3 *db,               /* Database connection */
  const char *zName,         /* Name of the module */
  const sqlite3_module *p,   /* Methods for the module */
  void *pClientData          /* Client data for xCreate/xConnect */
);

int sqlite3_create_module_v2(
  sqlite3 *db,               /* Database connection */
  const char *zName,         /* Name of the module */
  const sqlite3_module *p,   /* Methods for the module */
  void *pClientData,         /* Client data for xCreate/xConnect */
  void(*xDestroy)(void*)     /* Destructor for pClientData */
);
```

### Module Structure

```c
struct sqlite3_module {
  int iVersion;
  int (*xCreate)(sqlite3*, void *pAux, int argc, const char *const*argv,
                 sqlite3_vtab **ppVTab, char**);
  int (*xConnect)(sqlite3*, void *pAux, int argc, const char *const*argv,
                  sqlite3_vtab **ppVTab, char**);
  int (*xBestIndex)(sqlite3_vtab *pVTab, sqlite3_index_info*);
  int (*xDisconnect)(sqlite3_vtab *pVTab);
  int (*xDestroy)(sqlite3_vtab *pVTab);
  int (*xOpen)(sqlite3_vtab *pVTab, sqlite3_vtab_cursor **ppCursor);
  int (*xClose)(sqlite3_vtab_cursor*);
  int (*xFilter)(sqlite3_vtab_cursor*, int idxNum, const char *idxStr,
                 int argc, sqlite3_value **argv);
  int (*xNext)(sqlite3_vtab_cursor*);
  int (*xEof)(sqlite3_vtab_cursor*);
  int (*xColumn)(sqlite3_vtab_cursor*, sqlite3_context*, int);
  int (*xRowid)(sqlite3_vtab_cursor*, sqlite3_int64 *pRowid);
  int (*xUpdate)(sqlite3_vtab *, int, sqlite3_value **, sqlite3_int64 *);
  int (*xBegin)(sqlite3_vtab *pVTab);
  int (*xSync)(sqlite3_vtab *pVTab);
  int (*xCommit)(sqlite3_vtab *pVTab);
  int (*xRollback)(sqlite3_vtab *pVTab);
  int (*xFindFunction)(sqlite3_vtab *pVtab, int nArg, const char *zName,
                       void (**pxFunc)(sqlite3_context*,int,sqlite3_value**),
                       void **ppArg);
  int (*xRename)(sqlite3_vtab *pVtab, const char *zNew);
  /* Version 2 and later */
  int (*xSavepoint)(sqlite3_vtab *pVTab, int);
  int (*xRelease)(sqlite3_vtab *pVTab, int);
  int (*xRollbackTo)(sqlite3_vtab *pVTab, int);
  /* Version 3 and later */
  int (*xShadowName)(const char*);
};
```

**Reference**: https://sqlite.org/vtab.html

## Auxiliary Data

Auxiliary data allows caching expensive computations in user-defined functions:

```c
void *sqlite3_get_auxdata(sqlite3_context*, int N);
void sqlite3_set_auxdata(sqlite3_context*, int N, void*, void (*)(void*));
```

**Parameters**:

- `N`: Argument index for which to store auxiliary data
- `void*`: Auxiliary data pointer
- `void (*)(void*)`: Destructor for auxiliary data

**Example use case**: Caching compiled regular expressions

## Function Flags

```c
#define SQLITE_DETERMINISTIC    0x000000800
#define SQLITE_DIRECTONLY       0x000080000
#define SQLITE_SUBTYPE          0x000100000
#define SQLITE_INNOCUOUS        0x000200000
```

**Descriptions**:

- `SQLITE_DETERMINISTIC`: Function always produces same output for same input
- `SQLITE_DIRECTONLY`: Function can only be invoked from top-level SQL
- `SQLITE_SUBTYPE`: Function distinguishes between TEXT subtypes
- `SQLITE_INNOCUOUS`: Function has no side effects

## JavaScript/N-API Specific Considerations

When implementing SQLite functions using Node.js N-API:

### HandleScope Management

**Critical**: SQLite callbacks are invoked from SQLite's context, not directly from JavaScript. This affects V8 HandleScope lifetime:

```cpp
// DON'T do this - HandleScope will be destroyed before value is used:
Napi::Value GetValue() {
  Napi::HandleScope scope(env_);  // Scope destroyed when function returns!
  return Napi::Number::New(env_, 42);
}

// DO this instead - let the caller manage the scope:
Napi::Value GetValue() {
  // No HandleScope here
  return Napi::Number::New(env_, 42);
}
```

### BigInt Support

For handling large integers beyond JavaScript's safe integer range:

```cpp
// Check if using BigInt arguments
if (use_bigint_args_) {
  return Napi::BigInt::New(env_, static_cast<int64_t>(sqlite_int64_value));
} else if (sqlite_int64_value >= INT32_MIN && sqlite_int64_value <= INT32_MAX) {
  return Napi::Number::New(env_, static_cast<int32_t>(sqlite_int64_value));
} else {
  // Handle as double or throw error
}
```

### Exception Handling

Convert JavaScript exceptions to SQLite errors:

```cpp
try {
  // Call JavaScript function
  Napi::Value result = js_function.Call(args);

  if (env_.IsExceptionPending()) {
    Napi::Error error = env_.GetAndClearPendingException();
    sqlite3_result_error(ctx, error.Message().c_str(), -1);
    return;
  }
} catch (const Napi::Error& e) {
  sqlite3_result_error(ctx, e.Message().c_str(), -1);
} catch (...) {
  sqlite3_result_error(ctx, "Unknown error in user-defined function", -1);
}
```

### Thread Safety

- SQLite may call functions from different threads
- Ensure N-API calls are thread-safe
- Use `napi_threadsafe_function` for callbacks if needed

## Function Name Constraints

- **Maximum length**: 255 UTF-8 bytes (not characters!)
- **Return value**: SQLITE_MISUSE if name exceeds limit
- **Character encoding**: Name length is measured in UTF-8 bytes
- **Example**: A name with 100 emojis (4 bytes each) would exceed the limit

## Best Practices

1. **Use SQLITE_TRANSIENT** when setting text/blob results unless certain the memory won't change
2. **Check types** before extracting values from sqlite3_value
3. **Handle NULL** inputs explicitly
4. **Use SQLITE_DETERMINISTIC** when appropriate for query optimization
5. **Catch exceptions** in C++ implementations and convert to SQLite errors
6. **Zero-initialize** aggregate context memory
7. **Document argument expectations** clearly
8. **Test with various data types** including NULL, empty strings, and edge cases
9. **Manage HandleScope** carefully in N-API implementations
10. **Support BigInt** for large integer values when interfacing with JavaScript

## Implementation Validation Checklist

For validating user function implementations in N-API/Node.js context:

### src/user_function.h/.cpp Validation

- [ ] Proper handling of all SQLite value types (INTEGER, FLOAT, TEXT, BLOB, NULL)
- [ ] Correct memory management with SQLITE_TRANSIENT for all string/blob results
- [ ] Exception handling with conversion to SQLite errors via sqlite3_result_error()
- [ ] Support for both scalar and aggregate functions
- [ ] Proper use of sqlite3_user_data() for accessing user data
- [ ] BigInt support for JavaScript interop (use*bigint_args* flag)
- [ ] No HandleScope creation in value conversion methods
- [ ] Thread safety considerations for N-API calls
- [ ] Proper cleanup in destructor (xDestroy callback)
- [ ] SafeCastToInt for size parameters to prevent overflow

### test/user-functions.test.ts Validation

- [ ] Test scalar functions with various argument counts
- [ ] Test aggregate functions with proper state management
- [ ] Test NULL handling in both inputs and outputs
- [ ] Test error propagation from JavaScript to SQLite
- [ ] Test type conversions (number, string, boolean, buffer)
- [ ] Test BigInt arguments with useBigIntArguments option
- [ ] Test deterministic vs non-deterministic functions
- [ ] Test variadic functions with varargs option
- [ ] Test memory management (no leaks)
- [ ] Test edge cases (empty strings, large numbers, special characters)

## Common Pitfalls

1. **Memory leaks**: Forgetting to use proper destructors
2. **Type mismatches**: Not checking value types before extraction
3. **Exception safety**: Not catching all exceptions in callbacks
4. **Aggregate state**: Incorrect initialization of aggregate context
5. **Thread safety**: Assuming single-threaded execution
6. **Invalid pointers**: Using stale pointers after SQLite frees memory

## References

- SQLite User Functions: https://sqlite.org/c3ref/create_function.html
- SQLite Value Objects: https://sqlite.org/c3ref/value_blob.html
- SQLite Result Values: https://sqlite.org/c3ref/result_blob.html
- SQLite Virtual Tables: https://sqlite.org/vtab.html
- SQLite Window Functions: https://sqlite.org/windowfunctions.html
