# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is @photostructure/sqlite - a standalone npm package that extracts the experimental SQLite implementation from Node.js core. The goal is to make Node.js's native SQLite functionality available to all Node.js versions, not just those with the experimental flag enabled.

### Key Features
- **Node.js API Compatible**: Exact same interface as Node.js built-in SQLite module
- **Synchronous Operations**: DatabaseSync and StatementSync classes for blocking database operations
- **Full SQLite Feature Set**: Includes FTS, JSON functions, math functions, spatial extensions, and session support
- **Native Performance**: Direct SQLite C library integration without additional overhead
- **TypeScript Support**: Complete type definitions for all APIs
- **Cross-Platform**: Support for Windows, macOS, and Linux on x64 and ARM64

### Project Status
🚧 **In Development** - Core infrastructure is complete, but SQLite functionality is currently stubbed out.

**What Works:**
- ✅ Build system and native addon compilation
- ✅ Package structure and TypeScript setup
- ✅ Automated sync from Node.js source
- ✅ Basic module loading and class instantiation
- ✅ Test framework and CI foundation

**What's Missing:**
- 🚧 Actual SQLite functionality (currently stub implementation)
- 🚧 Complete Node.js internal API shimming
- 🚧 Comprehensive test coverage
- 🚧 Automated prebuilds and CI

## Architecture Overview

### File Structure
```
sqlite/
├── src/
│   ├── index.ts              # Main TypeScript interface and exports
│   ├── binding.cpp           # Native addon entry point (currently stubs)
│   ├── upstream/             # Files synced from Node.js repo
│   │   ├── sqlite.js         # Original Node.js JavaScript interface  
│   │   ├── node_sqlite.{h,cc} # Node.js C++ SQLite implementation
│   │   ├── sqlite3.{c,h}     # SQLite library source (amalgamation)
│   │   └── sqlite.gyp        # Original Node.js build config
│   └── shims/                # Node.js internal API compatibility layer
│       ├── base_object.h     # BaseObject class stub
│       ├── node_mem.h        # Memory management utilities
│       ├── util.h            # Node.js utility functions
│       └── ...               # Other Node.js internal headers
├── scripts/
│   └── sync-from-node.js     # Automated sync from Node.js repository
├── test/                     # Test suite
├── binding.gyp               # Native build configuration
├── package.json              # Package configuration and dependencies
└── TODO.md                   # Remaining tasks and roadmap
```

### Core Components

**Native Addon Layer** (`src/binding.cpp`):
- Entry point for Node.js addon
- Currently contains stub implementations of DatabaseSync and StatementSync
- Needs to be replaced with actual Node.js SQLite implementation

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

## Common Commands

### Development Workflow
```bash
# Sync latest Node.js SQLite implementation
npm run sync

# Build native addon
npm run node-gyp-rebuild

# Compile TypeScript and create bundles
npm run bundle

# Run tests
npm test

# Full build and test
npm run build
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
- The actual SQLite implementation is in `src/upstream/node_sqlite.cc` (28,000+ lines)
- Node.js uses many internal APIs that need to be shimmed
- Key dependencies: BaseObject, Environment, memory tracking, error handling
- V8 APIs are used extensively and need to be adapted to N-API

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

## Current Implementation Status

### ✅ Completed
- Package structure and build system
- Node.js file synchronization automation
- Basic N-API wrapper structure
- TypeScript interfaces and type definitions
- Test framework setup
- SQLite library integration (compiles but not connected)

### 🚧 In Progress
- Node.js internal API shimming (partial)
- Basic stub implementation (functional but incomplete)

### ❌ Not Started
- Actual SQLite functionality implementation
- Complete Node.js compatibility layer
- Comprehensive test coverage
- CI/CD and prebuilds
- Performance optimization
- Documentation

## Key Challenges

### Node.js Internal Dependencies
- Heavy use of Node.js internal headers and utilities
- BaseObject lifecycle management
- Environment and context handling
- Memory tracking and cleanup

### V8 to N-API Translation
- Node.js code uses V8 APIs directly
- Need to translate to N-API equivalents
- Handle differences in memory management and error handling

### Threading and Async Operations
- Node.js uses internal ThreadPoolWork
- May need to adapt to standard libuv or N-API async patterns
- Maintain synchronous API while handling blocking operations

## Example Usage (Target API)

```typescript
import { DatabaseSync } from '@photostructure/sqlite';

// Create database
const db = new DatabaseSync(':memory:');

// Execute SQL
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');

// Prepare statements
const insert = db.prepare('INSERT INTO users (name) VALUES (?)');
const select = db.prepare('SELECT * FROM users WHERE id = ?');

// Execute with parameters
const result = insert.run('Alice');
console.log('Inserted ID:', result.lastInsertRowid);

// Query data
const user = select.get(result.lastInsertRowid);
console.log('User:', user);

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

## References

- [Node.js SQLite Documentation](https://nodejs.org/api/sqlite.html)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [Node-API Documentation](https://nodejs.org/api/n-api.html)
- [Node.js Source: lib/sqlite.js](https://github.com/nodejs/node/blob/main/lib/sqlite.js)
- [Node.js Source: src/node_sqlite.cc](https://github.com/nodejs/node/blob/main/src/node_sqlite.cc)