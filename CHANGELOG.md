# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-01-06

### Added

- Initial release of `@photostructure/sqlite` - standalone SQLite for Node.js 20+
- Full compatibility with Node.js built-in SQLite module API
- Core SQLite operations with `DatabaseSync` and `StatementSync` classes
- User-defined scalar and aggregate functions with full window function support
- Database backup and restoration capabilities
- SQLite sessions and changesets for change tracking
- Extension loading support with automatic platform-specific file resolution
- TypeScript definitions with complete type coverage
- Cross-platform prebuilt binaries for Windows, macOS, and Linux (x64, ARM64)
- Comprehensive test suite with 89+ tests covering all functionality
- Memory safety validation with Valgrind and sanitizers
- Performance benchmarking suite comparing to better-sqlite3
- Automated synchronization from Node.js upstream SQLite implementation
- CI/CD pipeline with security scanning and multi-platform builds

### Features

- **Synchronous API**: Fast, blocking database operations ideal for scripts and tools
- **Parameter binding**: Support for all SQLite data types including BigInt
- **Error handling**: Detailed error messages with SQLite error codes
- **Resource limits**: Control memory usage and query complexity
- **Safe integer handling**: JavaScript-safe integer conversion with overflow detection
- **Multi-process support**: Safe concurrent access from multiple Node.js processes
- **Worker thread support**: Full functionality in worker threads
- **Strict tables**: Support for SQLite's strict table mode
- **Double-quoted strings**: Configurable SQL syntax compatibility

### Platform Support

- Node.js 20.0.0 and later
- Windows (x64, ARM64)
- macOS (x64, ARM64)
- Linux (x64, ARM64), (glibc 2.28+, musl)

[0.1.0]: https://github.com/PhotoStructure/node-sqlite/releases/tag/v0.1.0
