# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is @photostructure/sqlite - a standalone npm package that extracts the experimental SQLite implementation from Node.js core. The goal is to make Node.js's native SQLite functionality available to all Node.js versions, not just those with the experimental flag enabled.

### Key Features

- **Node.js API Compatible**: Exact same interface as Node.js built-in SQLite module
- **better-sqlite3 Drop-in Replacement**: Goal to provide API compatibility with better-sqlite3 for easy migration
- **Synchronous Operations**: DatabaseSync and StatementSync classes for blocking database operations
- **Full SQLite Feature Set**: Includes FTS, JSON functions, math functions, spatial extensions, and session support
- **Native Performance**: Direct SQLite C library integration without additional overhead
- **TypeScript Support**: Complete type definitions for all APIs
- **Cross-Platform**: Support for Windows, macOS, and Linux on x64 and ARM64

### Project Status

✅ **Core and Advanced Functionality Complete** - As per TODO.md, core SQLite functionality and most advanced features are now working with 89 tests passing.

**What Works:**

- ✅ Core SQLite operations (CREATE, INSERT, SELECT, UPDATE, DELETE)
- ✅ DatabaseSync and StatementSync classes fully functional
- ✅ Parameter binding and data type handling
- ✅ Error handling and memory management
- ✅ Build system and native addon compilation
- ✅ Package structure and TypeScript setup
- ✅ Automated sync from Node.js source
- ✅ Multi-platform CI/CD with prebuilds
- ✅ Comprehensive test coverage (89 tests passing)
- ✅ User-defined functions with all options
- ✅ Aggregate functions with window function support
- ✅ Statement iterator implementation with full protocol

**What's Missing:**

- 🚧 SQLite sessions and changesets
- 🚧 Backup functionality
- 🚧 Extension loading

## Architecture Overview

### File Structure

```
node-sqlite/
├── src/
│   ├── index.ts              # Main TypeScript interface and exports
│   ├── binding.cpp           # Native addon entry point (minimal wrapper)
│   ├── sqlite_impl.{h,cpp}   # Main SQLite implementation (ported from Node.js)
│   ├── user_function.{h,cpp} # User-defined function support (new feature)
│   ├── upstream/             # Files synced from Node.js repo
│   │   ├── sqlite.js         # Original Node.js JavaScript interface
│   │   ├── node_sqlite.{h,cc} # Node.js C++ SQLite implementation
│   │   ├── sqlite3.{c,h}     # SQLite library source (amalgamation)
│   │   └── sqlite.gyp        # Original Node.js build config
│   └── shims/                # Node.js internal API compatibility layer
│       ├── base_object.h     # BaseObject class implementation
│       ├── node_mem.h        # Memory management utilities
│       ├── util.h            # Node.js utility functions
│       └── ...               # Other Node.js internal headers
├── vendored/                 # Reference implementations for compatibility
│   ├── node/                 # Complete Node.js repository (source of upstream/)
│   ├── better-sqlite3/       # better-sqlite3 package for API reference
│   └── node-sqlite3/         # node-sqlite3 package for compatibility testing
├── scripts/
│   └── sync-from-node.js     # Automated sync from Node.js repository
├── test/                     # Test suite with comprehensive coverage
│   ├── basic.test.ts         # Basic functionality tests
│   ├── database.test.ts      # Core database operation tests
│   └── user-functions.test.ts # User-defined function tests
├── binding.gyp               # Native build configuration
├── package.json              # Package configuration and dependencies
└── TODO.md                   # Remaining tasks and roadmap
```

### Core Components

**Native Addon Layer** (`src/binding.cpp`, `src/sqlite_impl.{h,cpp}`):

- Entry point for Node.js addon with minimal wrapper in binding.cpp
- Main implementation in sqlite_impl.cpp (ported from Node.js node_sqlite.cc)
- Full DatabaseSync and StatementSync implementations working
- User-defined functions support in user_function.{h,cpp}

**Node.js Compatibility Shims** (`src/shims/`):

- Provides compatibility layer for Node.js internal APIs
- Allows Node.js C++ code to compile in standalone environment
- Key shims: BaseObject, Environment, memory management, error handling

**Upstream Sync** (`src/upstream/`):

- Contains exact copies of Node.js SQLite implementation files
- Automatically synced using `scripts/sync-from-node.js`
- Should not be manually edited (changes will be overwritten)

**TypeScript Interface** (`src/index.ts`):

- Public API that matches Node.js SQLite exactly
- Loads native binding and exports typed interfaces
- Handles Symbol.dispose integration

**Vendored Reference Implementations** (`vendored/`):

- **`vendored/node/`**: Complete Node.js repository used as source for `src/upstream/` sync
- **`vendored/better-sqlite3/`**: Reference implementation for better-sqlite3 API compatibility
  - Contains full source code, documentation, and comprehensive test suite
  - Used for API reference when implementing better-sqlite3 drop-in replacement features
  - Test suite provides validation that our implementation matches expected behavior
- **`vendored/node-sqlite3/`**: node-sqlite3 package for additional compatibility testing
  - Provides reference for async SQLite patterns and additional API coverage

## npm Script Naming Conventions

This project follows consistent naming patterns for npm scripts to improve discoverability and maintainability:

### Action:Target Format

Scripts follow an `action:target` pattern where:

- **action**: The operation being performed (`build`, `clean`, `lint`, `test`, `fmt`)
- **target**: What the action operates on (`native`, `ts`, `dist`)

Examples:

- `build:native` - Build native C++ code
- `build:ts` - Type-check TypeScript for production
- `build:dist` - Bundle TypeScript to distribution files
- `lint:ts` - Lint TypeScript/JavaScript code
- `lint:native` - Lint C++ code with clang-tidy
- `fmt:ts` - Format TypeScript/JavaScript/JSON/Markdown files
- `fmt:native` - Format C++ files with clang-format

### Parallel Execution

Actions that have multiple targets can be run in parallel using wildcards:

- `npm run build` runs all `build:*` scripts in sequence
- `npm run lint` runs all `lint:*` scripts in parallel
- `npm run fmt` runs all `fmt:*` scripts in parallel
- Uses `run-s` (sequential) or `run-p` (parallel) from npm-run-all

### Special Namespaces

- **memory:\*** - Memory testing scripts that should not run automatically with `test:*`
  - `memory:test` - JavaScript memory leak tests
  - `memory:suite` - Comprehensive memory testing suite (valgrind, ASAN, etc.)
  - `memory:asan` - AddressSanitizer specific tests
  - Run with `ENABLE_ASAN=1` to include sanitizer tests

### Naming Guidelines

- Use explicit names to avoid ambiguity (e.g., `build:native` instead of just `prebuild`)
- Group related scripts by action prefix for easy wildcard execution
- Avoid names that could cause npm lifecycle conflicts
- Use descriptive suffixes that clearly indicate the target or purpose

## Common Commands

### Development Workflow

```bash
# Run all tests
npm test

# Run all tests including ESM
npm run tests

# Build everything (native, TypeScript, distribution)
npm run build

# Build individual components
npm run build:native     # Native C++ prebuilds
npm run build:ts         # Type-check TypeScript
npm run build:dist       # Bundle for distribution

# Memory testing
npm run memory:test      # JavaScript memory tests
npm run memory:suite     # Full memory test suite
npm run memory:asan      # AddressSanitizer tests

# Sync latest Node.js SQLite implementation
npm run sync:node
```

### Build System

```bash
# Clean build artifacts
npm run clean

# Rebuild from scratch
npm run clean && npm install

# Create prebuilds for distribution
npm run prebuild

# Format code
npm run fmt

# Lint code
npm run lint
```

### Sync from Node.js Repository

```bash
# Sync from default location (../node)
npm run sync

# Sync from specific path
node scripts/sync-from-node.js /path/to/node/repo
```

## Development Notes

### Working with Node.js C++ Code

- The SQLite implementation has been ported from `src/upstream/node_sqlite.cc` to `src/sqlite_impl.cpp`
- Node.js internal APIs are shimmed in `src/shims/` directory
- Key shims implemented: BaseObject, Environment, memory tracking, error handling
- V8 APIs have been successfully adapted to N-API equivalents

### Key Differences from Node.js

- **Module Loading**: Uses `node-gyp-build` instead of `internalBinding()`
- **Memory Management**: Simplified compared to Node.js internal tracking
- **Error Handling**: Uses N-API error throwing instead of Node.js internal utilities
- **Threading**: May need to adapt Node.js's ThreadPoolWork to standard async patterns

### Testing Strategy

- **Unit Tests**: Basic functionality and API surface
- **Integration Tests**: Real SQLite operations and data manipulation
- **Compatibility Tests**: Compare behavior with Node.js built-in SQLite
- **Memory Tests**: Ensure no leaks in native code
- **Platform Tests**: Multi-platform and multi-architecture validation

### Upstream Synchronization

- Node.js SQLite is experimental and may change frequently
- `sync-from-node.js` script maintains file synchronization
- Changes should be reviewed for compatibility impact
- Version tracking needed to correlate with Node.js releases

## Current Implementation Status (Updated per TODO.md)

### ✅ Completed

- ✅ **Core SQLite functionality** - All basic operations working
- ✅ **DatabaseSync and StatementSync classes** - Fully implemented
- ✅ **Parameter binding and data types** - All SQLite types supported
- ✅ **Error handling and memory management** - Proper cleanup implemented
- ✅ **Multi-platform CI/CD** - GitHub Actions with prebuilds
- ✅ **Comprehensive test coverage** - 13+ tests covering core functionality
- ✅ **Package structure and build system**
- ✅ **Node.js file synchronization automation**
- ✅ **TypeScript interfaces and type definitions**

### ✅ Recently Completed

- ✅ **User-defined functions** - Full implementation with all options
- ✅ **Aggregate functions** - Complete with window function support
- ✅ **Statement iterator** - Full JavaScript iterator protocol
- ✅ **File-based database testing** - 11 comprehensive tests

### ❌ Future Features

- ❌ **Backup functionality** - Low priority
- ❌ **Extension loading** - Advanced feature
- ❌ **Automated upstream sync** - Nice to have

## Key Development Guidelines

### Code Organization

- **Never modify `src/upstream/` files** - they are auto-synced from Node.js
- **Main implementation** is in `src/sqlite_impl.{h,cpp}` (ported from Node.js)
- **Shims** in `src/shims/` provide Node.js internal API compatibility
- **User functions** are implemented in `src/user_function.{h,cpp}`
- **Use `vendored/better-sqlite3/` for API reference** when implementing better-sqlite3 compatibility
- **Validate against `vendored/better-sqlite3/test/`** to ensure drop-in replacement behavior

### Testing Requirements

- **Always run tests** before submitting changes: `npm test`
- **Add tests** for any new functionality
- **Test on multiple platforms** via CI/CD when possible
- **Focus on compatibility** with Node.js SQLite behavior

### Build and Dependencies

- **Use `npm run build`** to compile TypeScript and create bundles
- **Run `npm run lint`** to check code quality
- **Native rebuilds** use `npm run node-gyp-rebuild`
- **Multi-platform prebuilds** are generated via GitHub Actions

## Example Usage (Target API)

```typescript
import { DatabaseSync } from "@photostructure/sqlite";

// Create database
const db = new DatabaseSync(":memory:");

// Execute SQL
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

// Prepare statements
const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
const select = db.prepare("SELECT * FROM users WHERE id = ?");

// Execute with parameters
const result = insert.run("Alice");
console.log("Inserted ID:", result.lastInsertRowid);

// Query data
const user = select.get(result.lastInsertRowid);
console.log("User:", user);

// Cleanup
db.close();
```

## Contributing Guidelines

1. **Never modify `src/upstream/` files** - they are auto-synced from Node.js
2. **Update shims in `src/shims/`** when Node.js APIs are missing
3. **Maintain exact API compatibility** with Node.js SQLite module
4. **Add tests for all new functionality**
5. **Update TODO.md** when completing tasks
6. **Run full test suite** before submitting changes

## Important Implementation Notes

### Aggregate Functions and V8 HandleScope

**Problem**: When implementing SQLite aggregate functions, we encountered "Invalid argument" errors that were caused by V8 HandleScope lifetime issues.

**Root Cause**: SQLite aggregate callbacks (`xStep`, `xFinal`) are called from SQLite's context, not directly from JavaScript. Creating a HandleScope in helper methods like `GetStartValue()` or `SqliteValueToJS()` caused the scope to be destroyed before the JavaScript values were used, resulting in values becoming `<the_hole_value>`.

**Solution**:

1. Don't create HandleScope in methods that return JavaScript values - let the caller manage the scope
2. Store aggregate values as raw C++ data instead of JavaScript objects to avoid cross-context issues
3. Use placement new for proper C++ object initialization in SQLite-allocated memory

**Key Code Pattern**:

```cpp
// DON'T do this:
Napi::Value GetStartValue() {
  Napi::HandleScope scope(env_);  // This scope will be destroyed before value is used!
  return Napi::Number::New(env_, 0);
}

// DO this instead:
Napi::Value GetStartValue() {
  // No HandleScope - let the caller manage it
  return Napi::Number::New(env_, 0);
}
```

### Aggregate Function Argument Count

**Problem**: SQLite determines the number of arguments for aggregate functions based on the JavaScript function's `length` property.

**Key Behavior**:

- For a step function `(acc) => acc + 1`, length is 1, so SQLite expects 0 SQL arguments
- For a step function `(acc, value) => acc + value`, length is 2, so SQLite expects 1 SQL argument
- The first parameter is always the accumulator, additional parameters map to SQL arguments

**Example**:

```javascript
// This expects my_count() with no arguments
db.aggregate("my_count", {
  start: 0,
  step: (acc) => acc + 1,
});

// This expects my_sum(value) with one argument
db.aggregate("my_sum", {
  start: 0,
  step: (acc, value) => acc + value,
});
```

### Async Cleanup Anti-Patterns

**IMPORTANT**: The following approaches are NOT valid solutions for async cleanup issues:

```javascript
// BAD: Arbitrary timeouts in tests
await new Promise((resolve) => setTimeout(resolve, 100));

// BAD: Forcing garbage collection
if (global.gc) {
  global.gc();
}
```

**Why these are problematic:**

1. **Arbitrary timeouts** are race conditions waiting to happen. They might work on fast machines but fail on slower CI runners.
2. **Forcing GC** should never be required for correct behavior. If your code depends on GC for correctness, it has a fundamental design flaw.
3. These approaches mask the real problem instead of fixing it.

**Note**: This is different from legitimate uses of timeouts, such as:

- Waiting for time to pass to test timestamp changes
- Rate limiting or throttling tests
- Testing timeout behavior itself

The anti-pattern is using timeouts to "fix" async cleanup issues.

**Root Cause**: The current BackupJob implementation uses detached threads that cannot be joined. When Jest tries to exit, these threads are still running, causing the "worker process has failed to exit gracefully" warning.

**Proper Solutions**:

1. Use Node.js's built-in AsyncWorker pattern instead of custom ThreadPoolWork
2. Implement proper thread joining in the finalizer
3. Track all async operations and ensure they complete before process exit
4. Use proper RAII patterns to ensure cleanup happens deterministically

**Current Status**: The BackupJob implementation needs to be refactored to use joinable threads or Node.js's AsyncWorker pattern. The current detached thread approach is fundamentally incompatible with clean process shutdown.

## References

- [Node.js SQLite Documentation](https://nodejs.org/api/sqlite.html)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [Node-API Documentation](https://nodejs.org/api/n-api.html)
- [Node.js Source: lib/sqlite.js](https://github.com/nodejs/node/blob/main/lib/sqlite.js)
- [Node.js Source: src/node_sqlite.cc](https://github.com/nodejs/node/blob/main/src/node_sqlite.cc)
