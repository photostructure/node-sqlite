# SQLite Library Comparison

When choosing a SQLite library for Node.js, you have several excellent options. This guide compares @photostructure/sqlite with the alternatives to help you make an informed decision.

## Quick Decision Guide

### Choose **`@photostructure/sqlite`** when you want:

- ✅ **Future-proof code** that works with both this package AND `node:sqlite`
- ✅ **Node.js API compatibility** without waiting for stable release
- ✅ **Broad Node.js support** (v20+) without experimental flags
- ✅ **Synchronous performance** with a clean, official API
- ✅ **Node-API stability** — one build works across Node.js versions
- ✅ **Zero migration path** when `node:sqlite` becomes stable
- ✅ **Session/changeset support** for replication and synchronization

### Choose **`better-sqlite3`** when you want:

- ✅ The most mature and feature-rich synchronous SQLite library
- ✅ Maximum performance above all else
- ✅ A specific API design that differs from Node.js

### Choose **`sqlite3`** when you have:

- ✅ Legacy code using async/callback patterns
- ✅ Hard requirement for non-blocking operations
- ✅ Need for SQLCipher encryption

### Choose **`node:sqlite`** when you're:

- ✅ Experimenting with bleeding-edge Node.js features
- ✅ Building proof-of-concepts for future migration
- ✅ Working in environments where you control the Node.js version

## Detailed Comparison

### 🏷️ [`node:sqlite`](https://nodejs.org/docs/latest/api/sqlite.html) — Node.js Built-in Module

_The official SQLite module included with Node.js 25.0.0+ (experimental)_

**✨ Pros:**

- **Zero dependencies** — Built directly into Node.js
- **Official support** — Maintained by the Node.js core team
- **Clean synchronous API** — Simple, predictable blocking operations
- **Full SQLite power** — FTS5, JSON functions, R\*Tree, sessions/changesets, and more

**⚠️ Cons:**

- **Experimental status** — Not yet stable for production use
- **Requires Node.js 25.0.0+** — Won't work on older versions
- **Flag required** — Must use `--experimental-sqlite` to enable
- **API may change** — Breaking changes possible before stable release
- **Limited real-world usage** — Few production deployments to learn from

**🎯 Best for:** Experimental projects, early adopters, and preparing for the future when it becomes stable.

---

### 🚀 [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — The Performance Champion

_The most popular high-performance synchronous SQLite library_

**✨ Pros:**

- **Blazing fast** — 2-15x faster than async alternatives
- **Rock-solid stability** — Battle-tested in thousands of production apps
- **Rich feature set** — User functions, aggregates, virtual tables, extensions
- **Extensive community** — Large ecosystem with many resources

**⚠️ Cons:**

- **Different API** — Not compatible with Node.js built-in SQLite
- **V8-specific** — Requires separate builds for each Node.js version
- **Synchronous only** — No async operations (usually a feature, not a bug)
- **Migration effort** — Switching from other libraries requires code changes
- **No session support** — Doesn't expose SQLite's session/changeset functionality

**🎯 Best for:** High-performance applications where you want maximum speed and control over the API.

---

### 📦 [`sqlite3`](https://github.com/TryGhost/node-sqlite3) — The Async Classic

_The original asynchronous SQLite binding for Node.js_

**✨ Pros:**

- **Battle-tested legacy** — 10+ years of production use
- **Massive ecosystem** — 4000+ dependent packages
- **Truly asynchronous** — Non-blocking operations won't freeze your app
- **Extensive resources** — Countless tutorials and Stack Overflow answers
- **Extension support** — Works with SQLCipher for encryption
- **Node-API stable** — One build works across Node.js versions

**⚠️ Cons:**

- **Significantly slower** — 2-15x performance penalty vs synchronous libs
- **Callback complexity** — Prone to callback hell without careful design
- **Unnecessary overhead** — SQLite is inherently synchronous anyway
- **Memory management quirks** — Exposes low-level C concerns to JavaScript
- **Concurrency issues** — Mutex contention under heavy load

**🎯 Best for:** Legacy codebases, apps requiring true async operations, or when you need SQLCipher encryption.

## Feature Matrix

| Feature                  | @photostructure/sqlite | node:sqlite   | better-sqlite3   | sqlite3       |
| ------------------------ | ---------------------- | ------------- | ---------------- | ------------- |
| **API Compatibility**    | node:sqlite            | -             | Custom           | Custom        |
| **Min Node.js Version**  | 20.0.0                 | 25.0.0        | 14.0.0           | 10.0.0        |
| **Experimental Flag**    | ❌ Not needed          | ✅ Required   | ❌ Not needed    | ❌ Not needed |
| **Synchronous API**      | ✅                     | ✅            | ✅               | ❌            |
| **Asynchronous API**     | ❌                     | ❌            | ❌               | ✅            |
| **TypeScript Types**     | ✅ Built-in            | ✅ Built-in   | ✅ Via @types    | ✅ Via @types |
| **Custom Functions**     | ✅                     | ✅            | ✅               | ✅            |
| **Aggregate Functions**  | ✅                     | ✅            | ✅               | ❌            |
| **Window Functions**     | ✅                     | ✅            | ✅               | ❌            |
| **Sessions/Changesets**  | ✅                     | ✅            | ❌               | ❌            |
| **Backup API**           | ✅                     | ✅            | ✅ Different API | ✅            |
| **Extension Loading**    | ✅                     | ✅            | ✅               | ✅            |
| **Worker Threads**       | ✅                     | ✅            | ✅               | ⚠️ Limited    |
| **FTS5**                 | ✅                     | ✅            | ✅               | ✅            |
| **JSON Functions**       | ✅                     | ✅            | ✅               | ✅            |
| **R\*Tree**              | ✅                     | ✅            | ✅               | ✅            |
| **Node-API**             | ✅                     | N/A           | ❌ V8-specific   | ✅            |
| **Disposable Interface** | ✅ Native C++          | ✅ Native C++ | ❌               | ❌            |
| **Build Size**           | ~2MB                   | 0 (built-in)  | ~2MB             | ~3MB          |

## Performance Comparison

All synchronous libraries (@photostructure/sqlite, node:sqlite, better-sqlite3) offer similar performance:

- **2-15x faster** than async sqlite3 for most operations
- **Direct C API access** with minimal JavaScript overhead
- **No async/await overhead** or promise creation costs
- **Efficient batch operations** with prepared statements

The async sqlite3 library is slower due to:

- Thread pool overhead
- Callback/promise creation costs
- Mutex contention under load
- Additional memory allocations

### SQLTagStore Performance

Both `node:sqlite` and `@photostructure/sqlite` provide `SQLTagStore` for cached prepared statements via tagged template literals. Node.js implements this in native C++, while we use a TypeScript implementation. Benchmarks show equivalent performance:

| Scenario               | @photostructure/sqlite |   node:sqlite | Difference |
| ---------------------- | ---------------------: | ------------: | ---------: |
| Single query cache hit |          141,000 ops/s | 155,000 ops/s |        -9% |
| Multi-pattern workload |           65,000 ops/s |  50,000 ops/s |       +31% |
| Write operations       |              720 ops/s |     720 ops/s |         0% |

The TypeScript implementation performs equivalently because SQLite execution time dominates over cache lookup overhead. V8's Map is highly optimized for string keys, matching or exceeding native LRU performance for typical workloads.

Run `npm run bench:tagstore` in the `benchmark/` directory to reproduce these results.

## Migration Paths

### From `node:sqlite` to `@photostructure/sqlite`

```javascript
// Just change the import - everything else stays the same!
// From: import { DatabaseSync } from 'node:sqlite';
import { DatabaseSync } from "@photostructure/sqlite";
```

### From `better-sqlite3` to `@photostructure/sqlite`

See our detailed [migration guide](./migrating-from-better-sqlite3.md). Key differences:

- Constructor syntax slightly different
- No `.transaction()` helper method
- Different property names (e.g., `.name` → `.location`)
- Iterator syntax changes

### From `sqlite3` to `@photostructure/sqlite`

Requires rewriting from async to sync patterns:

```javascript
// sqlite3 (async)
db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
  if (err) handleError(err);
  else processUser(row);
});

// @photostructure/sqlite (sync)
try {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  processUser(row);
} catch (err) {
  handleError(err);
}
```

## Ecosystem Considerations

### Package Maintenance

- **@photostructure/sqlite**: Actively maintained, tracks Node.js upstream
- **node:sqlite**: Part of Node.js core, follows Node.js release cycle
- **better-sqlite3**: Very actively maintained, frequent updates
- **sqlite3**: Maintained but less frequent updates

### Community and Support

- **better-sqlite3**: Largest community, most Stack Overflow answers
- **sqlite3**: Huge legacy community, extensive resources
- **node:sqlite**: Growing community as adoption increases
- **@photostructure/sqlite**: New but benefits from node:sqlite compatibility

## Conclusion

Choose based on your specific needs:

1. **Need future compatibility?** → @photostructure/sqlite
2. **Want maximum performance and features?** → better-sqlite3
3. **Have async legacy code?** → sqlite3
4. **Can use experimental features?** → node:sqlite

For new projects targeting Node.js 20+, @photostructure/sqlite offers the best balance of compatibility, performance, and future-proofing.
