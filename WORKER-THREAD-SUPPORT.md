# Worker Thread Support Implementation Plan

This document outlines the plan to implement full Node.js worker thread support for @photostructure/sqlite.

## Current Status

**✅ Partially Working:** The implementation has basic worker thread compatibility due to N-API and SQLite's multi-thread mode.  
**❌ Known Issue:** Worker threads currently cause segfaults (documented in TODO.md:186).  
**📋 Implementation Status:** Foundation is solid, but missing robust thread safety infrastructure.

## Research Summary

### SQLite Thread Safety Configuration

SQLite supports three threading modes:

- **Single-thread** (`SQLITE_THREADSAFE=0`): No thread safety, one thread only
- **Multi-thread** (`SQLITE_THREADSAFE=2`): Multiple threads, separate connections per thread ✅ **CURRENT**
- **Serialized** (`SQLITE_THREADSAFE=1`): Full thread safety with mutexes (default)

**Current Configuration:** Using `SQLITE_THREADSAFE=2` (multi-thread mode) - the correct choice for worker threads where each thread gets its own database connection.

### Node.js Worker Thread Requirements for Native Addons

1. **Context-Aware Addons**: ✅ N-API provides automatic context awareness
2. **Instance Data Management**: ❌ Missing `napi_set_instance_data` implementation
3. **Cleanup Hooks**: ❌ Missing `napi_add_env_cleanup_hook` for worker termination
4. **Connection Isolation**: ❌ No enforcement preventing cross-thread connection sharing
5. **Thread-Safe Functions**: ❌ Missing for advanced cross-thread communication

### Current Implementation Analysis

**Working Components:**

- N-API provides inherent context awareness across worker threads
- SQLite compiled with appropriate thread safety mode
- Basic ThreadPoolWork implementation in `src/shims/threadpoolwork-inl.h`
- Worker thread tests exist in `test/worker-threads-simple.test.ts`

**Missing Components:**

- Per-worker instance data management
- Cleanup hooks for worker thread lifecycle
- Validation preventing cross-thread object access
- Documentation for proper worker thread usage

**Known Issues:**

- Segfaults when using worker threads (TODO.md:186)
- Potential use-after-free scenarios in cross-thread contexts
- No cleanup when worker threads terminate

## Implementation Plan

### Phase 1: Fix Current Segfaults (High Priority - 1-2 days)

**Objective:** Resolve the known segfault issue preventing reliable worker thread usage.

**Tasks:**

1. **Debug worker thread segfaults**

   - Run existing tests in `test/worker-threads-simple.test.ts` under debugger
   - Identify specific crash locations using valgrind/gdb
   - Check for use-after-free in statement/database lifecycle

2. **Implement thread safety validation**

   - Add thread ID tracking to DatabaseSync and StatementSync objects
   - Validate that objects are only used from their creation thread
   - Throw clear errors for cross-thread usage attempts

3. **Fix statement/database lifecycle issues**
   - Ensure proper cleanup order when worker threads terminate
   - Add reference counting for cross-object dependencies
   - Test edge cases like closing database while statements exist

**Key Files to Modify:**

- `src/sqlite_impl.h` - Add thread ID tracking
- `src/sqlite_impl.cpp` - Add validation in all public methods
- `test/worker-threads-simple.test.ts` - Expand test coverage

**Expected Outcome:** Worker thread tests pass without segfaults.

### Phase 2: Robust Thread Support (Medium Priority - 1 day)

**Objective:** Implement proper per-worker instance data management and cleanup.

**Tasks:**

1. **Add instance data management**

   ```cpp
   // In binding.cpp
   struct AddonData {
     std::map<std::string, std::unique_ptr<DatabaseSync>> databases;
     std::mutex mutex; // For thread-safe access to shared state
   };

   // Set instance data during module initialization
   napi_set_instance_data(env, addon_data, cleanup_callback, nullptr);
   ```

2. **Implement cleanup hooks**

   ```cpp
   // Add cleanup hook for worker thread termination
   napi_add_env_cleanup_hook(env, worker_cleanup_callback, addon_data);
   ```

3. **Add connection isolation enforcement**
   - Track which thread created each database connection
   - Prevent sharing connections between worker threads
   - Add runtime validation for thread affinity

**Key Files to Modify:**

- `src/binding.cpp` - Add instance data and cleanup hooks
- `src/sqlite_impl.h` - Add thread affinity tracking
- `src/sqlite_impl.cpp` - Implement validation logic

**Expected Outcome:** Proper resource management and no memory leaks when worker threads terminate.

### Phase 3: Documentation and Testing (Medium Priority - 1-2 days)

**Objective:** Provide comprehensive testing and usage documentation.

**Tasks:**

1. **Expand test coverage**

   - Add tests for multiple concurrent worker threads
   - Test worker thread creation/termination patterns
   - Test error scenarios (cross-thread usage, cleanup failures)
   - Add stress tests for worker thread pools

2. **Create usage documentation**

   - Document proper worker thread patterns
   - Provide example code for common use cases
   - Document limitations and best practices
   - Add troubleshooting guide for common issues

3. **Add validation tests**
   - Test that cross-thread usage is properly prevented
   - Verify cleanup hooks work correctly
   - Test memory leak scenarios with valgrind

**Key Files to Create/Modify:**

- `test/worker-threads-advanced.test.ts` - Comprehensive worker thread tests
- `docs/WORKER-THREADS.md` - Usage documentation
- `README.md` - Add worker thread examples

**Expected Outcome:** Production-ready worker thread support with comprehensive documentation.

### Phase 4: Advanced Features (Low Priority - Future)

**Objective:** Add advanced worker thread capabilities.

**Tasks:**

1. **Thread-Safe Function support**

   - Implement `Napi::ThreadSafeFunction` for cross-thread callbacks
   - Add async callback mechanisms from worker threads
   - Support for progress notifications across threads

2. **Worker pool utilities**

   - Helper classes for managing worker thread pools
   - Load balancing for database operations
   - Connection pooling strategies

3. **Performance optimizations**
   - Optimize for multi-threaded scenarios
   - Reduce lock contention
   - Memory allocation optimizations

## Technical Implementation Details

### Thread Safety Model

**Connection Isolation Pattern** (Recommended):

- Each worker thread creates its own DatabaseSync instance
- No sharing of `sqlite3*` handles between threads
- Each thread's connections are completely independent

**Implementation Pattern:**

```javascript
// main.js
const { Worker } = require("worker_threads");
const worker = new Worker("./worker.js", {
  workerData: { dbPath: "./data.db" },
});

// worker.js
const { DatabaseSync } = require("@photostructure/sqlite");
const { workerData } = require("worker_threads");

// Each worker creates its own connection
const db = new DatabaseSync(workerData.dbPath);
// ... perform operations
db.close(); // Clean up when done
```

### Memory Management Strategy

1. **Per-Worker Instance Data**:

   ```cpp
   struct WorkerData {
     napi_env env;
     std::vector<DatabaseSync*> databases;
     std::vector<StatementSync*> statements;
   };
   ```

2. **Cleanup Sequence**:

   - Worker thread termination triggers cleanup hook
   - All statements are finalized
   - All database connections are closed
   - Instance data is deallocated

3. **Reference Management**:
   - Use weak references where possible to prevent cycles
   - Track object dependencies for proper cleanup order
   - Implement RAII patterns for automatic cleanup

### Error Handling

**Cross-Thread Usage Detection**:

```cpp
class DatabaseSync {
  std::thread::id creation_thread_;

  void ValidateThread() {
    if (std::this_thread::get_id() != creation_thread_) {
      throw std::runtime_error("Database connection cannot be used from different thread");
    }
  }
};
```

**Error Categories**:

1. **Thread Affinity Errors**: Using objects from wrong thread
2. **Lifecycle Errors**: Using objects after worker termination
3. **Resource Errors**: Memory/handle leaks during cleanup

## Testing Strategy

### Test Categories

1. **Basic Functionality**:

   - Create database in worker thread
   - Execute SQL operations
   - Clean shutdown

2. **Concurrency Tests**:

   - Multiple workers accessing same file
   - Concurrent read/write operations
   - Worker thread pools

3. **Error Scenarios**:

   - Cross-thread usage attempts
   - Premature worker termination
   - Resource exhaustion

4. **Memory Tests**:
   - Valgrind leak detection
   - Stress testing with many workers
   - Long-running worker scenarios

### Test Files

- `test/worker-threads-simple.test.ts` - Basic functionality (exists)
- `test/worker-threads-advanced.test.ts` - Comprehensive scenarios (to create)
- `test/worker-threads-stress.test.ts` - Stress and performance tests (to create)
- `test/worker-threads-errors.test.ts` - Error handling tests (to create)

## Risk Assessment

### Low Risk

- **SQLite Thread Safety**: Well-established multi-thread mode
- **N-API Context Awareness**: Proven technology
- **Basic Pattern**: Simple connection-per-thread model

### Medium Risk

- **Current Segfaults**: Need investigation but likely solvable
- **Resource Management**: Requires careful implementation
- **Test Coverage**: Need comprehensive validation

### High Risk

- **Production Deployment**: Should thoroughly test before release
- **Performance Impact**: Thread safety may add overhead
- **Compatibility**: Ensure compatibility across Node.js versions

## Success Criteria

### Phase 1 Success Criteria

- [ ] All worker thread tests pass without segfaults
- [ ] Clear error messages for cross-thread usage
- [ ] Valgrind shows no memory errors in worker thread scenarios

### Phase 2 Success Criteria

- [ ] Per-worker instance data properly managed
- [ ] Clean shutdown of worker threads with no memory leaks
- [ ] Connection isolation enforced at runtime

### Phase 3 Success Criteria

- [ ] Comprehensive test suite covering all worker thread scenarios
- [ ] Complete documentation with examples
- [ ] Production-ready worker thread support

### Overall Success Criteria

- [ ] Worker threads work reliably in production
- [ ] Performance is acceptable for multi-threaded workloads
- [ ] Documentation enables easy adoption
- [ ] Zero memory leaks or stability issues

## References and Prior Art

### better-sqlite3 Worker Thread Implementation

- **Pattern**: Each worker creates own connection
- **Message Passing**: Simple SQL execution via worker messages
- **Isolation**: No connection sharing between threads
- **Documentation**: Clear usage examples and limitations

### Node.js Worker Thread Best Practices

- **Context Awareness**: Use N-API for automatic context handling
- **Instance Data**: Use `napi_set_instance_data` for per-worker state
- **Cleanup Hooks**: Use `napi_add_env_cleanup_hook` for proper cleanup
- **Thread-Safe Functions**: Use `Napi::ThreadSafeFunction` for callbacks

### SQLite Multi-Threading Documentation

- **Thread Safety Modes**: Multi-thread mode prevents connection sharing
- **Connection Isolation**: Each thread must have separate connections
- **Performance**: Minimal overhead in multi-thread mode

## Files Requiring Modification

### Core Implementation

- `src/binding.cpp` - Add instance data management and cleanup hooks
- `src/sqlite_impl.h` - Add thread ID tracking and validation declarations
- `src/sqlite_impl.cpp` - Implement thread validation and cleanup logic

### Testing

- `test/worker-threads-simple.test.ts` - Fix existing segfaults
- `test/worker-threads-advanced.test.ts` - Create comprehensive test suite
- `test/worker-threads-stress.test.ts` - Create stress tests
- `test/worker-threads-errors.test.ts` - Create error handling tests

### Documentation

- `README.md` - Add worker thread examples
- `docs/WORKER-THREADS.md` - Create detailed usage guide
- `CLAUDE.md` - Update with worker thread implementation notes

### Build Configuration

- `binding.gyp` - Ensure proper threading flags are set
- `package.json` - Update test scripts for worker thread testing

## Getting Started

To begin implementation:

1. **Set up debugging environment**:

   ```bash
   # Build with debug symbols
   npm run build:debug

   # Run worker thread tests with debugger
   node --inspect-brk node_modules/.bin/jest test/worker-threads-simple.test.ts
   ```

2. **Identify segfault location**:

   ```bash
   # Run with valgrind
   valgrind --tool=memcheck --track-origins=yes npm test worker-threads-simple
   ```

3. **Start with minimal fix**:

   - Add thread ID validation to DatabaseSync constructor
   - Add validation to all public methods
   - Test with existing worker thread tests

4. **Iterate on solution**:
   - Fix immediate segfaults
   - Add instance data management
   - Expand test coverage
   - Document usage patterns

This plan provides a structured approach to implementing robust worker thread support while building on the existing solid foundation.
