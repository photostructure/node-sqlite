# SQLite C/C++ API Reference - Index

This is the main index for the SQLite C/C++ API documentation. The API has been organized into logical sections for easier navigation and understanding.

## Overview

The SQLite C/C++ API is extensive and provides low-level access to all SQLite functionality. This documentation set covers the essential APIs needed for building SQLite library implementations, organized into digestible sections.

## API Documentation Sections

### 1. [Core API](sqlite-api-core.md)

**Foundation APIs for basic database operations**

- Database connections (opening, closing)
- Basic SQL execution
- Error handling and result codes
- Transaction control
- Utility functions (version, randomness, etc.)

### 2. [Statement API](sqlite-api-statements.md)

**Prepared statements and data handling**

- Compiling and preparing SQL statements
- Parameter binding
- Result retrieval and column access
- Statement metadata
- Data types and encodings

### 3. [Extension API](sqlite-api-extensions.md)

**Extending SQLite with custom functionality**

- User-defined scalar functions
- Aggregate functions
- Window functions
- Custom collations
- Virtual tables
- Auxiliary data management

### 4. [Advanced Features](sqlite-api-advanced.md)

**Specialized APIs for advanced use cases**

- Backup API for live database copying
- Blob I/O for incremental access
- Session extension for change tracking
- Threading and concurrency features
- Hooks and callbacks
- Extension loading
- WAL mode operations

### 5. [Memory & Configuration](sqlite-api-memory-config.md)

**System configuration and resource management**

- Memory allocation and management
- Global configuration options
- Per-database configuration
- Runtime limits
- Compile-time options
- Status and statistics monitoring

## Quick Reference

### Essential Functions by Category

**Getting Started**

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

## Additional Resources

### Related Documentation

- [SQLite User Functions Guide](SQLITE-USER-FUNCTIONS.md) - Detailed guide for implementing user-defined functions

### External References

- [Official SQLite C/C++ Interface](https://sqlite.org/c3ref/intro.html)
- [SQLite Introduction to C Interface](https://sqlite.org/cintro.html)
- [SQLite Architecture](https://sqlite.org/arch.html)

## Usage Notes

1. **API Stability**: SQLite maintains excellent backward compatibility. Functions are rarely deprecated.

2. **Thread Safety**: Configure threading mode appropriately using `sqlite3_config()` before using SQLite.

3. **Error Checking**: Always check return codes. Most functions return `SQLITE_OK` on success.

4. **Memory Management**: Understand ownership rules for strings and memory passed to/from SQLite.

5. **Version Compatibility**: Use `sqlite3_libversion()` to check SQLite version at runtime.

## Implementation Checklist

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

## Navigation Tips

- Each section builds on previous ones - read in order if new to SQLite
- Use your editor's search across all files to find specific functions
- Function names in code blocks can be searched in official SQLite docs
- Examples show common usage patterns
