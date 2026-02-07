# SQLite library comparison

This guide compares @photostructure/sqlite with the alternatives to help you choose the right SQLite library for Node.js.

## Quick decision guide

### Choose **`@photostructure/sqlite`** when you want:

- **Future-proof code** that works with both this package AND `node:sqlite`
- **Node.js API compatibility** without waiting for stable release
- **Broad Node.js support** (v20+) without experimental flags
- **Synchronous performance** with a clean, official API
- **Node-API stability**: one build works across Node.js versions
- **Zero migration path** when `node:sqlite` becomes stable
- **Session/changeset support** for replication and synchronization

### Choose **`better-sqlite3`** when you want:

- The most mature synchronous SQLite library
- Maximum performance above all else
- A specific API design that differs from Node.js

### ~~Choose **`sqlite3`**~~ (deprecated)

> **`sqlite3` (node-sqlite3) is [unmaintained and deprecated](https://github.com/TryGhost/node-sqlite3/pull/1844) as of December 2025.** New projects should not use it. Existing users should migrate to one of the alternatives above.

### Choose **`node:sqlite`** when you're:

- Experimenting with bleeding-edge Node.js features
- Building proof-of-concepts for future migration
- Working in environments where you control the Node.js version

## Detailed comparison

### [`node:sqlite`](https://nodejs.org/docs/latest/api/sqlite.html), Node.js built-in module

_The official SQLite module included with Node.js 22.5.0+ (experimental)_

**Pros:**

- **Zero dependencies**: built directly into Node.js
- **Official support**: maintained by the Node.js core team
- **Clean synchronous API**: simple, predictable blocking operations
- **Full SQLite power**: FTS5, JSON functions, R\*Tree, sessions/changesets, and more

**Cons:**

- **Experimental status**: not yet stable for production use (Stability: 1.1 - Active development)
- **Requires Node.js 22.5.0+**: won't work on older versions
- **API may change**: breaking changes possible before stable release
- **Limited real-world usage**: few production deployments to learn from

**Best for:** Experimental projects, early adopters, and preparing for the future when it becomes stable.

---

### [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)

_The most popular high-performance synchronous SQLite library_

**Pros:**

- **Fast**: 2-15x faster than async alternatives
- **Stable**: widely used in thousands of production apps
- **Feature-rich**: user functions, aggregates, virtual tables, extensions
- **Large community**: many resources and Stack Overflow answers

**Cons:**

- **Different API**: not compatible with Node.js built-in SQLite
- **V8-specific**: requires separate builds for each Node.js version
- **Synchronous only**: no async operations (usually a feature, not a bug)
- **Migration effort**: switching from other libraries requires code changes
- **No session support**: doesn't expose SQLite's session/changeset functionality

**Best for:** High-performance applications where you want maximum speed and control over the API.

---

### [`sqlite3`](https://github.com/TryGhost/node-sqlite3) (deprecated)

_The original asynchronous SQLite binding for Node.js, [unmaintained since December 2025](https://github.com/TryGhost/node-sqlite3/pull/1844)_

**Status:**

- **Deprecated and unmaintained**: no new issues or PRs will be addressed
- **No security updates**: vulnerabilities will not be patched
- **Bundled SQLite is outdated**: ships with SQLite 3.45.0 (current is 3.51.1+)

**Historical context:**

- Was the most widely used SQLite binding for Node.js (4000+ dependent packages)
- Provided an async/callback API
- Supported SQLCipher encryption

**Recommendation:** Migrate to @photostructure/sqlite, better-sqlite3, or node:sqlite. See [migration guide below](#from-sqlite3-to-photostructuresqlite).

## Feature matrix

| Feature                  | @photostructure/sqlite | node:sqlite   | better-sqlite3   | sqlite3       |
| ------------------------ | ---------------------- | ------------- | ---------------- | ------------- |
| **API Compatibility**    | node:sqlite            | -             | Custom           | Custom        |
| **Min Node.js Version**  | 20.0.0                 | 22.5.0        | 14.0.0           | 10.0.0        |
| **Experimental Flag**    | ❌ Not needed          | ❌ Not needed | ❌ Not needed    | ❌ Not needed |
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

## Performance comparison

All synchronous libraries (@photostructure/sqlite, node:sqlite, better-sqlite3) offer similar performance:

- **2-15x faster** than async sqlite3 for most operations
- **Direct C API access** with minimal JavaScript overhead
- **No async/await overhead** or promise creation costs
- **Efficient batch operations** with prepared statements

The async sqlite3 library was slower due to:

- Thread pool overhead
- Callback/promise creation costs
- Mutex contention under load
- Additional memory allocations

> **Note:** sqlite3 is [deprecated and unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) as of December 2025.

### SQLTagStore performance

Both `node:sqlite` and `@photostructure/sqlite` provide `SQLTagStore` for cached prepared statements via tagged template literals. Node.js implements this in native C++, while we use a TypeScript implementation. Benchmarks show equivalent performance:

| Scenario               | @photostructure/sqlite |   node:sqlite | Difference |
| ---------------------- | ---------------------: | ------------: | ---------: |
| Single query cache hit |          141,000 ops/s | 155,000 ops/s |        -9% |
| Multi-pattern workload |           65,000 ops/s |  50,000 ops/s |       +31% |
| Write operations       |              720 ops/s |     720 ops/s |         0% |

The TypeScript implementation performs equivalently because SQLite execution time dominates over cache lookup overhead. V8's Map is highly optimized for string keys, matching or exceeding native LRU performance for typical workloads.

Run `npm run bench:tagstore` in the `benchmark/` directory to reproduce these results.

## Migration paths

### From `node:sqlite` to `@photostructure/sqlite`

```javascript
// Just change the import - everything else stays the same!
// From: import { DatabaseSync } from 'node:sqlite';
import { DatabaseSync } from "@photostructure/sqlite";
```

### From `better-sqlite3` to `@photostructure/sqlite`

See our detailed [migration guide](./migrating-from-better-sqlite3.md). Key differences:

- Constructor syntax slightly different
- Use `enhance()` for `.transaction()` and `.pragma()` helper methods
- Different property names (e.g., `.name` → `.location()`)
- Iterator syntax changes

### From `sqlite3` to `@photostructure/sqlite`

> **Note:** sqlite3 is [deprecated and unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) as of December 2025. Migration is strongly recommended.

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

## Ecosystem considerations

### Package maintenance

- **@photostructure/sqlite**: Actively maintained, tracks Node.js upstream
- **node:sqlite**: Part of Node.js core, follows Node.js release cycle
- **better-sqlite3**: Very actively maintained, frequent updates
- **sqlite3**: [Deprecated and unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) since December 2025

### Community and support

- **better-sqlite3**: Largest community, most Stack Overflow answers
- **sqlite3**: Large legacy community, but no longer maintained
- **node:sqlite**: Growing community as adoption increases
- **@photostructure/sqlite**: New but benefits from node:sqlite compatibility

## Conclusion

Choose based on your specific needs:

1. **Need future compatibility?** → @photostructure/sqlite
2. **Want maximum performance and features?** → better-sqlite3
3. **Have async legacy code using sqlite3?** → Migrate to @photostructure/sqlite or better-sqlite3 (sqlite3 is deprecated)
4. **Can use experimental features?** → node:sqlite

For new projects targeting Node.js 20+, @photostructure/sqlite offers the best balance of compatibility, performance, and future-proofing.
