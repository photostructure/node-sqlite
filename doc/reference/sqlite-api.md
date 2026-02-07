# SQLite C/C++ API reference - index

> **Important:** This documentation describes the **underlying SQLite C library API**, not the JavaScript API exposed by `@photostructure/sqlite`. Most functions documented here (like `sqlite3_config()`, `sqlite3_limit()`, `sqlite3_blob_open()`) are **not directly callable from JavaScript**.
>
> For the JavaScript API, see [API Reference](../api-reference.md).
>
> This reference is for understanding the underlying SQLite capabilities and for developers working on the native bindings.

Main index for the SQLite C/C++ API documentation. The API is organized into logical sections for navigation. This is a machine-generated summary of documentation found on sqlite.org, used as a reference during development.

## Overview

The SQLite C/C++ API provides low-level access to all SQLite functionality. This documentation covers the essential APIs needed for building SQLite library implementations.

## API documentation sections

### 1. [Core API](sqlite-api-core.md)

**Foundation APIs for basic database operations**

- Database connections (opening, closing)
- Basic SQL execution
- Error handling and result codes
- Transaction control
- Utility functions (version, randomness, etc.)

### 2. [Statement API](sqlite-api-statements.md)

**Prepared statement and data handling**

- Compiling and preparing SQL statements
- Parameter binding
- Result retrieval and column access
- Statement metadata
- Data types and encodings

### 3. [Extension API](sqlite-api-extensions.md)

**Custom functionality extensions**

- User-defined scalar functions
- Aggregate functions
- Window functions
- Custom collations
- Virtual tables
- Auxiliary data management

### 4. [Advanced features](sqlite-api-advanced.md)

**Specialized APIs for advanced use cases**

- Backup API for live database copying
- Blob I/O for incremental access
- Session extension for change tracking
- Threading and concurrency features
- Hooks and callbacks
- Extension loading
- WAL mode operations

### 5. [Memory & configuration](sqlite-api-memory-config.md)

**System configuration and resource management**

- Memory allocation and management
- Global configuration options
- Per-database configuration
- Runtime limits
- Compile-time options
- Status and statistics monitoring

## Quick reference

### Essential functions by category

**Getting started**

- `sqlite3_open()` - Open database
- `sqlite3_close()` - Close database
- `sqlite3_exec()` - Execute SQL directly
- `sqlite3_errmsg()` - Get error message

**Prepared Statements**

- `sqlite3_prepare_v2()` - Compile SQL
- `sqlite3_step()` - Execute statement
- `sqlite3_bind_*()` - Bind parameters
- `sqlite3_column_*()` - Get results
- `sqlite3_finalize()` - Clean up statement

**Extensions**

- `sqlite3_create_function_v2()` - Create custom function
- `sqlite3_create_collation_v2()` - Create custom collation
- `sqlite3_create_module_v2()` - Create virtual table

**Configuration**

- `sqlite3_config()` - Global configuration
- `sqlite3_db_config()` - Database configuration
- `sqlite3_limit()` - Set runtime limits

## Additional resources

### Related documentation

- [SQLite Extensions API](sqlite-api-extensions.md) - Extension and user-defined function APIs

### External references

- [Official SQLite C/C++ Interface](https://sqlite.org/c3ref/intro.html)
- [SQLite Introduction to C Interface](https://sqlite.org/cintro.html)
- [SQLite Architecture](https://sqlite.org/arch.html)

## Usage notes

1. **API stability**: SQLite maintains strong backward compatibility. Functions are rarely deprecated.

2. **Thread safety**: Configure threading mode with `sqlite3_config()` before using SQLite.

3. **Error checking**: Always check return codes. Most functions return `SQLITE_OK` on success.

4. **Memory management**: Understand ownership rules for strings and memory passed to/from SQLite.

5. **Version compatibility**: Use `sqlite3_libversion()` to check SQLite version at runtime.

## Implementation checklist

When implementing a SQLite wrapper or binding:

- [ ] Core database operations (open, close, exec)
- [ ] Prepared statement support
- [ ] Proper error handling and reporting
- [ ] Parameter binding for all data types
- [ ] User-defined function support
- [ ] Transaction management
- [ ] Thread safety configuration
- [ ] Memory management and limits
- [ ] Status and statistics reporting

## Navigation tips

- Each section builds on previous ones; read in order if new to SQLite
- Use your editor's search across all files to find specific functions
- Function names in code blocks can be searched in official SQLite docs
- Examples show common usage patterns
