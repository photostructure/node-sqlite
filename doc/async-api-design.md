# Async API Design Analysis for @photostructure/sqlite

## Executive Summary

This document analyzes options for adding asynchronous API support to the @photostructure/sqlite library, which currently provides a synchronous SQLite interface matching Node.js's built-in sqlite module. After careful analysis, we recommend creating a separate package for the async API rather than integrating it into the existing library.

## Current State

### What We Have

The @photostructure/sqlite library provides:

- **Synchronous API** matching Node.js's experimental SQLite module exactly
- **DatabaseSync** and **StatementSync** classes for blocking operations
- **Native C++ implementation** using N-API/node-addon-api
- **Full SQLite functionality** including user-defined functions, aggregates, and more
- **Cross-platform support** with prebuilds for major platforms

### Technical Foundation

The library is built on:

- **SQLite amalgamation** (sqlite3.c) compiled directly into the addon
- **Node-addon-api** for C++ to JavaScript bindings
- **Synchronous execution model** where all operations block the JavaScript thread

## The Challenge

SQLite's C API is fundamentally synchronous. Operations like `sqlite3_step()`, `sqlite3_exec()`, and `sqlite3_prepare()` block until completion. To provide an async API, we need to:

1. Move SQLite operations to worker threads
2. Manage callbacks/promises for result delivery
3. Handle concurrent access safely
4. Maintain proper connection lifecycle

## Design Options Analysis

### Option 1: Integrated Async API in Existing Library

Add async classes alongside sync classes in the same package:

```typescript
// Same package exports both APIs
export { DatabaseSync, StatementSync } from "./sync";
export { Database, Statement } from "./async";
```

**Pros:**

- Single package installation
- Shared C++ compilation and SQLite binary
- Code reuse for common functionality
- Easier migration between sync/async

**Cons:**

- API confusion (which to use when?)
- Complex TypeScript definitions
- Risk of breaking sync API when adding async
- Larger package size for all users
- Testing complexity increases significantly

### Option 2: Separate Async Package (Recommended)

Create a new package `@photostructure/sqlite-async`:

```typescript
// @photostructure/sqlite (existing)
export class DatabaseSync { ... }
export class StatementSync { ... }

// @photostructure/sqlite-async (new)
export class Database { ... }
export class Statement { ... }
```

**Pros:**

- **Clear separation of concerns** - no API confusion
- **Independent development** - can iterate without affecting sync users
- **Focused packages** - each does one thing well
- **Smaller bundles** - users only get what they need
- **Easier testing** - no sync/async interaction bugs
- **Follows Node.js philosophy** - they also separate sync/async APIs

**Cons:**

- Two packages to maintain
- Some code duplication
- Need to coordinate SQLite version updates

### Option 3: Modular Architecture

Create three packages with shared core:

```
@photostructure/sqlite-core    (shared C++ bindings, SQLite)
@photostructure/sqlite         (sync API, depends on core)
@photostructure/sqlite-async   (async API, depends on core)
```

**Pros:**

- Minimizes code duplication
- Clear architectural boundaries
- Shared SQLite compilation

**Cons:**

- Most complex to implement
- Three packages to maintain
- Dependency versioning complexity

## Recommended Approach: Separate Async Package

We recommend **Option 2** for these reasons:

1. **Philosophical Alignment**: Node.js itself chose to provide only sync API initially, suggesting async would be separate
2. **User Clarity**: Clear package names indicate sync vs async
3. **Risk Mitigation**: No chance of breaking existing sync users
4. **Clean Implementation**: Can use AsyncWorker pattern from the start

## Async API Design Principles

### 1. Promise-Based API

All operations return promises:

```typescript
class Database {
  static open(filename: string, options?: OpenOptions): Promise<Database>;
  prepare(sql: string): Promise<Statement>;
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: any[]): Promise<RunResult>;
  get(sql: string, ...params: any[]): Promise<any>;
  all(sql: string, ...params: any[]): Promise<any[]>;
  close(): Promise<void>;
}

class Statement {
  run(...params: any[]): Promise<RunResult>;
  get(...params: any[]): Promise<any>;
  all(...params: any[]): Promise<any[]>;
  iterate(...params: any[]): AsyncIterableIterator<any>;
  finalize(): Promise<void>;
}
```

### 2. Connection Pooling

Since operations run on worker threads, we can support concurrent operations:

```typescript
interface PoolOptions {
  max: number; // Maximum connections (default: 5)
  min: number; // Minimum connections (default: 1)
  idleTimeout: number; // Close idle connections after ms
}
```

### 3. AsyncWorker Implementation

Use node-addon-api's AsyncWorker for all operations:

```cpp
class OpenWorker : public Napi::AsyncWorker {
  void Execute() override {
    // Open SQLite connection on worker thread
    int result = sqlite3_open_v2(filename_.c_str(), &db_, flags_, nullptr);
    if (result != SQLITE_OK) {
      SetError(sqlite3_errstr(result));
    }
  }

  void OnOK() override {
    // Create JavaScript Database object on main thread
    auto database = Database::constructor.New({});
    database->SetConnection(db_);
    deferred_.Resolve(database);
  }
};
```

### 4. Thread Safety

- Each Database instance owns its sqlite3\* connection
- Operations are serialized per connection
- Multiple Database instances can work in parallel
- Use SQLITE_OPEN_FULLMUTEX for thread safety

### 5. Streaming Support

For large result sets:

```typescript
// Async iterator for memory efficiency
for await (const row of statement.iterate()) {
  processRow(row);
}

// Stream interface
statement.stream().pipe(transform).pipe(output);
```

## Implementation Roadmap

### Phase 1: Core Architecture

1. Create new repository/package structure
2. Set up AsyncWorker base classes
3. Implement Database.open() and Database.close()
4. Add basic error handling

### Phase 2: Statement Operations

1. Implement prepare() with AsyncWorker
2. Add run(), get(), all() methods
3. Implement parameter binding
4. Add finalize() support

### Phase 3: Advanced Features

1. Connection pooling
2. Async iterators
3. Stream support
4. Transaction helpers

### Phase 4: Feature Parity

1. User-defined functions (async callbacks)
2. Backup API (progress callbacks)
3. Busy handlers
4. All remaining features

## Technical Considerations

### 1. Memory Management

- AsyncWorker automatically handles worker thread lifecycle
- Need careful management of sqlite3\* pointers
- Statement objects must track their parent Database

### 2. Error Handling

- Errors in Execute() are automatically converted to promise rejections
- SQLite error messages must be copied (not referenced)
- Need to handle both SQLite errors and system errors

### 3. Performance

- Worker thread overhead vs blocking main thread
- Connection pool tuning
- Consider prepared statement caching

### 4. Compatibility

- Support same SQLite compile options
- Match Node.js sqlite error behaviors
- Provide migration guide from sync API

## Testing Strategy

1. **Port existing tests** - Adapt sync tests to async
2. **Concurrency tests** - Verify thread safety
3. **Performance benchmarks** - Compare with sync API
4. **Stress tests** - Connection pool limits
5. **Integration tests** - Real-world usage patterns

## Migration Guide (Future)

For users moving from sync to async:

```typescript
// Sync (current)
const db = new DatabaseSync(":memory:");
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
const user = stmt.get(userId);

// Async (new)
const db = await Database.open(":memory:");
const stmt = await db.prepare("SELECT * FROM users WHERE id = ?");
const user = await stmt.get(userId);
```

## Open Questions

1. **Package naming**: `@photostructure/sqlite-async` or `@photostructure/async-sqlite`?
2. **API style**: Mirror better-sqlite3's async API or create our own?
3. **Default pool size**: What's appropriate for typical use cases?
4. **Transaction API**: Provide high-level transaction helpers?

## Conclusion

Creating a separate async package is the recommended approach. It provides the clearest path forward, aligns with Node.js's design philosophy, and minimizes risk to existing users. The AsyncWorker pattern from node-addon-api provides a solid foundation for implementation.

## Next Steps

1. **Decision**: Confirm separate package approach
2. **Repository**: Create new repo or subdirectory
3. **Prototype**: Implement basic open/close/exec operations
4. **Validate**: Test AsyncWorker pattern with SQLite
5. **Iterate**: Build out full API based on learnings

## References

- [Node-addon-api AsyncWorker documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/async_operations.md)
- [SQLite Threading Modes](https://sqlite.org/threadsafe.html)
- [Node.js SQLite Module](https://nodejs.org/api/sqlite.html)
- [better-sqlite3 async discussion](https://github.com/WiseLibs/better-sqlite3/issues/233)
