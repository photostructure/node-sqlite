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

- **action**: The operation being performed (`setup`, `build`, `clean`, `lint`, `test`, `fmt`)
- **target**: What the action operates on (`native`, `ts`, `dist`)

### Naming Guidelines

- Use explicit names to avoid ambiguity (e.g., `build:native` instead of just `prebuild`)
- Group related scripts by action prefix for easy wildcard execution
- Avoid names that could cause npm lifecycle conflicts
- Use descriptive suffixes that clearly indicate the target or purpose

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

// BAD: Adding setImmediate in afterAll to "fix" hanging tests
afterAll(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});
```

**Why these are problematic:**

1. **Arbitrary timeouts** are race conditions waiting to happen. They might work on fast machines but fail on slower CI runners.
2. **Forcing GC** should never be required for correct behavior. If your code depends on GC for correctness, it has a fundamental design flaw.
3. **setImmediate/nextTick delays** in cleanup hooks don't fix the root cause - they just paper over the real issue.
4. These approaches mask the real problem instead of fixing it.

**Note**: This is different from legitimate uses of timeouts, such as:

- Waiting for time to pass to test timestamp changes
- Rate limiting or throttling tests
- Testing timeout behavior itself

The anti-pattern is using timeouts or GC to "fix" async cleanup issues.

**What to do instead:**

1. Find the actual resource that's keeping the process alive (use `--detectOpenHandles`)
2. Ensure all database connections are properly closed
3. Ensure all file handles are closed
4. Cancel or await all pending async operations
5. Use proper resource management patterns (RAII, try-finally, using statements)

**Root Cause**: When async operations are not properly cleaned up, Jest may display the "worker process has failed to exit gracefully" warning.

**Proper Solutions**:

1. Use Node.js's built-in AsyncWorker pattern (which BackupJob already uses via `Napi::AsyncProgressWorker`)
2. Ensure all async operations complete before process exit
3. Track all async operations and clean them up properly
4. Use proper RAII patterns to ensure cleanup happens deterministically

**Current Status**: The BackupJob implementation correctly uses `Napi::AsyncProgressWorker`, which is the proper Node.js async pattern. This ensures threads are properly managed and cleaned up.

## Windows-Compatible Directory Cleanup

**IMPORTANT**: Never use `fs.rmSync()` or `fs.rm()` without proper Windows retry logic for directory cleanup in tests.

**Problem**: On Windows, SQLite database files can remain locked longer than on Unix systems, causing `EBUSY` errors during cleanup.

**Proper Solution**: Use `fsp.rm()` (async) with retry options:

```typescript
await fsp.rm(tempDir, {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 3 : 1,
  retryDelay: process.platform === "win32" ? 100 : 0,
});
```

**Best Practice**: Use the existing test utilities (`useTempDir`, `useTempDirSuite`) which already handle Windows-compatible cleanup. Don't manually clean up temp directories - let the test framework handle it.

## Robust Testing Guidelines

Based on analysis of CI failures, these guidelines ensure tests are reliable across all platforms and environments.

### Common Flaky Test Patterns and Solutions

#### 1. Timeout Failures

**Pattern**: Tests failing with "Exceeded timeout of 10000 ms for a test" especially in memory tests and backup tests.

**Root Causes**:

- Fixed timeouts don't account for slower CI environments
- Alpine Linux (musl libc) is 2x slower than glibc
- ARM64 emulation on x64 runners is 5x slower
- Windows process forking is 4x slower
- macOS VMs are 4x slower

**Solutions**:

```typescript
// DON'T: Use fixed timeouts
test("my test", async () => {
  // Test code
}, 10000);

// DO: Use adaptive timeouts
import { getTestTimeout } from "./test-timeout-config.cjs";

test(
  "my test",
  async () => {
    // Test code
  },
  getTestTimeout(10000),
);

// DO: Use the benchmark harness for memory tests
import { testMemoryBenchmark } from "./benchmark-harness";

testMemoryBenchmark(
  "memory test",
  () => {
    // Test code
  },
  { maxTimeoutMs: 60000 },
);
```

#### 2. Database Locking Race Conditions

**Pattern**: Multi-process tests expecting `DATABASE_LOCKED` errors but getting `WRITE_SUCCESS`.

**Root Cause**: The timing between establishing a lock and attempting concurrent access varies by platform.

**Solutions**:

```typescript
// DON'T: Assume immediate locking
const lockHolder = spawn(nodeCmd, [lockScript]);
const writer = spawn(nodeCmd, [writerScript]);
expect(writer.stdout).toBe("DATABASE_LOCKED"); // May succeed on fast systems!

// DO: Ensure lock is established first
const lockHolder = spawn(nodeCmd, [lockScript]);
// Wait for lock confirmation
await waitForOutput(lockHolder, "LOCK_ACQUIRED");
// Now attempt concurrent access
const writer = spawn(nodeCmd, [writerScript]);
expect(writer.stdout).toBe("DATABASE_LOCKED");
```

#### 3. Jest Not Exiting Cleanly

**Pattern**: "Jest did not exit one second after the test run has completed" warnings.

**Root Causes**:

- Unclosed database connections
- Active async operations
- Console logs after test completion

**Solutions**:

```typescript
// DON'T: Leave resources open
test("my test", async () => {
  const db = new DatabaseSync("test.db");
  // Test code but forget to close
});

// DO: Always clean up resources
test("my test", async () => {
  const db = new DatabaseSync("test.db");
  try {
    // Test code
  } finally {
    db.close();
  }
});

// DO: Use test utilities that handle cleanup
test("my test", async () => {
  using tempDir = useTempDir();
  const db = tempDir.newDatabase();
  // db is automatically closed when tempDir is disposed
});

// DO: Cancel async operations in afterEach/afterAll
let asyncOperation: Promise<void> | null = null;

afterEach(() => {
  if (asyncOperation) {
    // Cancel or wait for completion
    asyncOperation = null;
  }
});
```

#### 4. Platform-Specific Failures

**Pattern**: Tests failing only on specific platforms (Alpine ARM64, Windows).

**Root Causes**:

- Platform timing differences
- File system behavior variations
- Process spawning differences

**Solutions**:

```typescript
// DON'T: Assume uniform platform behavior
expect(error.message).toBe("SQLITE_BUSY: database is locked");

// DO: Handle platform variations
expect(error.message).toMatch(/SQLITE_BUSY|database is locked/);

// DO: Use platform-aware utilities
import { getTestTimeout, getTimingMultiplier } from "./test-timeout-config.cjs";

// DO: Add platform-specific retry logic
async function waitForCondition(check: () => boolean, options = {}) {
  const { maxAttempts = 10, delay = 100 } = options;
  const multiplier = getTimingMultiplier();

  for (let i = 0; i < maxAttempts * multiplier; i++) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}
```

### Best Practices for Reliable Tests

1. **Use Adaptive Timeouts**: Always use `getTestTimeout()` for Jest timeouts and `getTimingMultiplier()` for custom timing logic.

2. **Explicit Resource Management**: Use `using` declarations or try/finally blocks to ensure cleanup.

3. **Wait for Conditions**: Don't assume timing - explicitly wait for conditions to be met.

4. **Platform-Aware Expectations**: Account for platform differences in error messages and behavior.

5. **Avoid Console Logs in Async Code**: Ensure all logging happens before test completion.

6. **Use Test Utilities**: Leverage `useTempDir`, `useTempDirSuite`, and other utilities that handle platform differences.

7. **Benchmark Harness for Performance Tests**: Use the adaptive benchmark harness that accounts for environment performance.

### Memory Test Guidelines

Memory tests are particularly prone to flakiness due to:

- GC timing variations
- Platform memory management differences
- CI environment resource constraints

**Best Practices**:

```typescript
// Use the memory benchmark harness
testMemoryBenchmark(
  "test name",
  async () => {
    // Operation to test
  },
  {
    maxMemoryGrowthKBPerSecond: 500, // Adjust based on operation
    minRSquaredForLeak: 0.5, // Statistical confidence
    forceGC: true, // Consistent GC behavior
    maxTimeoutMs: 60000, // Generous timeout
  },
);
```

### Multi-Process Test Guidelines

Multi-process tests need careful synchronization:

```typescript
// Use explicit synchronization
const script = `
  const db = new DatabaseSync(process.argv[2]);
  console.log("READY");  // Signal readiness
  // ... test code ...
`;

const proc = spawn(process.execPath, ["-e", script, dbPath]);
await waitForOutput(proc, "READY"); // Wait for process to be ready
```

### CI Environment Considerations

1. **GitHub Actions runners vary significantly**:

   - Ubuntu: Fast and reliable
   - Windows: 4x slower process operations
   - macOS: 4x slower in VMs
   - Alpine ARM64: 10x slower (2x for musl + 5x for emulation)

2. **Resource constraints**: CI environments may have limited memory/CPU, affecting timing and performance tests.

3. **Parallel test execution**: Tests must be isolated and not depend on specific port numbers or global resources.

## Advanced CI/CD Reliability Patterns

Based on cross-project analysis and lessons learned from other native Node.js modules, these advanced patterns help eliminate the most stubborn sources of test flakiness:

### 1. Alpine Linux ARM64 Emulation Detection

**Problem**: ARM64 emulation on x64 GitHub Actions runners is 5-20x slower and can cause unexpected timeouts.

**Solution**: Auto-detect emulated environments and adjust behavior:

```typescript
// Detect Alpine Linux emulation environment
const isAlpine = fs.existsSync("/etc/alpine-release");
const isARM64 = process.arch === "arm64";
const isEmulated = isARM64 && process.env.GITHUB_ACTIONS === "true";

// Skip intensive tests on emulated environments
const describeForNative = isEmulated ? describe.skip : describe;

describeForNative("CPU-intensive operations", () => {
  // Tests that spawn multiple processes or do heavy computation
});
```

### 2. Dynamic Value Testing for Changing Metadata

**Problem**: File system metadata like `available` space and `used` space change continuously as other processes run, making exact equality assertions unreliable.

**Solution**: Focus on type validation and stability patterns:

```typescript
// DON'T: Test dynamic values for exact equality or ranges
const result1 = db.prepare("PRAGMA freelist_count").get();
const result2 = db.prepare("PRAGMA freelist_count").get();
expect(result1.freelist_count).toBe(result2.freelist_count); // May fail!
expect(result1.freelist_count).toBeGreaterThan(0); // May fail if pages are freed!

// DO: Test for type correctness and structural properties
expect(typeof result.freelist_count).toBe("number");
expect(Number.isInteger(result.freelist_count)).toBe(true);
expect(result.freelist_count).toBeGreaterThanOrEqual(0);

// DO: Test static/stable properties for exact equality
expect(result.page_size).toBe(4096); // Page size doesn't change
expect(result.application_id).toBe(expectedId); // Application ID is stable
```

### 3. Worker Thread Resource Management

**Problem**: Race conditions and resource leaks in concurrent worker operations can cause Jest to hang.

**Solution**: Implement proper worker lifecycle management:

```typescript
// Track all active workers for cleanup
const activeWorkers = new Set<Worker>();

afterEach(async () => {
  // Terminate all workers with timeout
  const terminations = Array.from(activeWorkers).map((worker) =>
    Promise.race([
      new Promise<void>((resolve) => {
        worker.terminate().then(() => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)), // 1s timeout
    ]),
  );

  await Promise.allSettled(terminations);
  activeWorkers.clear();
});

// Use Promise.allSettled() instead of Promise.all() for concurrent operations
const results = await Promise.allSettled(
  workers.map((worker) => worker.performOperation()),
);

// Check results individually
results.forEach((result, index) => {
  if (result.status === "fulfilled") {
    expect(result.value).toBeDefined();
  } else {
    console.warn(`Worker ${index} failed:`, result.reason);
  }
});
```

### 4. Benchmark Test Reliability

**Problem**: "Cannot log after tests are done" errors in performance tests due to async operations continuing after test completion.

**Solution**: Ensure complete async operation lifecycle management:

```typescript
// DON'T: Allow async operations to continue after test
test("benchmark performance", async () => {
  const operations = [];
  for (let i = 0; i < 1000; i++) {
    operations.push(performAsyncOperation(i)); // May continue after test ends
  }
  const results = await Promise.all(operations);
  console.log("Performance results:", results); // May log after test completion
});

// DO: Use proper lifecycle management with explicit synchronization
test("benchmark performance", async () => {
  const operations = [];
  const abortController = new AbortController();

  try {
    for (let i = 0; i < 1000; i++) {
      operations.push(
        performAsyncOperation(i, { signal: abortController.signal }),
      );
    }

    const results = await Promise.allSettled(operations);
    const successful = results.filter((r) => r.status === "fulfilled");

    // Log immediately, before any potential async continuation
    expect(successful.length).toBeGreaterThan(900); // Allow some failures
  } finally {
    // Ensure all operations are cancelled
    abortController.abort();

    // Wait for any cleanup to complete
    await new Promise((resolve) => setImmediate(resolve));
  }
});
```

### 5. Timeout Test Precision

**Problem**: Exact timing assertions fail due to CI environment variability and timer precision limitations.

**Solution**: Use statistical timing validation:

```typescript
// DON'T: Test exact timing
const start = Date.now();
await operationWithTimeout(100);
const duration = Date.now() - start;
expect(duration).toBe(100); // Will fail due to timing precision

// DO: Use ranges with platform-aware margins
const start = process.hrtime.bigint();
await operationWithTimeout(100);
const duration = Number(process.hrtime.bigint() - start) / 1_000_000; // Convert to ms

const expectedDuration = 100;
const margin = process.env.CI ? 50 : 20; // Larger margin in CI
expect(duration).toBeGreaterThanOrEqual(expectedDuration - margin);
expect(duration).toBeLessThanOrEqual(expectedDuration + margin);
```

### 6. Environment-Specific Test Configuration

**Problem**: Tests behave differently in local vs CI environments, causing flaky failures.

**Solution**: Implement environment detection and adaptive configuration:

```typescript
// Environment detection helper
export function getTestEnvironment() {
  const isCI = process.env.CI === "true";
  const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
  const isLocal = !isCI;

  return {
    isCI,
    isGitHubActions,
    isLocal,

    // Adaptive configuration
    concurrencyLimit: isCI ? 2 : 4,
    retryAttempts: isCI ? 3 : 1,
    timeoutMultiplier: isCI ? 3 : 1,

    // Platform-specific adjustments
    shouldSkipHeavyTests: isAlpine && isARM64,
    shouldUseSequentialExecution: process.platform === "win32" && isCI,
  };
}

// Use in test configuration
const env = getTestEnvironment();

beforeAll(() => {
  if (env.shouldUseSequentialExecution) {
    jest.retryTimes(env.retryAttempts);
  }
});
```

### 7. Deterministic Test Data

**Problem**: Tests using random data or timestamps can be inconsistent across runs.

**Solution**: Use deterministic data generation with seeded randomness:

```typescript
// DON'T: Use truly random data
test("database operations", () => {
  const randomId = Math.random(); // Different every run
  const timestamp = Date.now(); // Different every run

  db.prepare("INSERT INTO test VALUES (?, ?)").run(randomId, timestamp);
  // Test behavior becomes unpredictable
});

// DO: Use seeded deterministic data
import { createHash } from "node:crypto";

function deterministicRandom(seed: string): number {
  const hash = createHash("sha256").update(seed).digest("hex");
  return parseInt(hash.substring(0, 8), 16) / 0xffffffff;
}

test("database operations", () => {
  const testSeed = "test-database-operations"; // Consistent across runs
  const deterministicId = deterministicRandom(testSeed + "-id");
  const deterministicTimestamp = 1704067200000; // Fixed timestamp: 2024-01-01

  db.prepare("INSERT INTO test VALUES (?, ?)").run(
    deterministicId,
    deterministicTimestamp,
  );
  // Test behavior is now predictable and reproducible
});
```

### Best Practices Summary

1. **Environment Detection**: Auto-detect emulated environments and adjust test behavior accordingly
2. **Dynamic Value Handling**: Focus on type validation rather than exact values for changing metadata
3. **Resource Lifecycle**: Implement comprehensive cleanup for workers, timers, and async operations
4. **Statistical Validation**: Use ranges and statistical analysis instead of exact timing assertions
5. **Deterministic Data**: Prefer seeded randomness over truly random data for consistent test results
6. **Adaptive Configuration**: Adjust concurrency, timeouts, and retry logic based on environment
7. **Graceful Degradation**: Skip or modify tests that can't work reliably in certain environments

## References

- [Node.js SQLite Documentation](https://nodejs.org/api/sqlite.html)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [Node-API Documentation](https://nodejs.org/api/n-api.html)
- [Node.js Source: lib/sqlite.js](https://github.com/nodejs/node/blob/main/lib/sqlite.js)
- [Node.js Source: src/node_sqlite.cc](https://github.com/nodejs/node/blob/main/src/node_sqlite.cc)
