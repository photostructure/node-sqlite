# SQLite Test Extension

This directory contains a simple SQLite extension used for testing the extension loading functionality of the node-sqlite module.

## Overview

The test extension provides three custom SQL functions:

1. **`test_extension_version()`** - Returns the version string "test-extension-1.0.0"
2. **`test_extension_add(a, b)`** - Adds two numbers together
3. **`test_extension_reverse(str)`** - Reverses an ASCII string (Unicode is not properly handled for simplicity)

## Building

The extension is automatically built when running the extension loading tests. To manually build:

```bash
node build.js
```

This will compile the extension and place it in the current directory with the appropriate platform-specific extension:

- Linux: `test_extension.so`
- macOS: `test_extension.dylib`
- Windows: `test_extension.dll`

## Files

- `test_extension.c` - The C source code for the extension
- `binding.gyp` - Node.js native build configuration
- `build.js` - Build script that compiles and copies the extension
- `.gitignore` - Ignores build artifacts

## Usage

The extension is loaded in tests using:

```javascript
const db = new DatabaseSync(":memory:", { allowExtension: true });
db.enableLoadExtension(true);
db.loadExtension("./test_extension"); // SQLite adds platform-specific extension automatically
```

## Security Note

Extension loading is disabled by default in SQLite for security reasons. The test demonstrates the two-step security process required:

1. Enable extension loading at database creation with `allowExtension: true`
2. Explicitly enable loading with `enableLoadExtension(true)`

This ensures extensions can only be loaded when explicitly allowed by the application.
