# SQLite library comparison

This guide compares @photostructure/sqlite with the alternatives to help you choose the right SQLite library for Node.js.

## Quick decision guide

### Choose **`@photostructure/sqlite`** when you want:

- **Broad Node.js support** (v22+) — `node:sqlite` requires Node.js 22.5.0+
- **Decoupled SQLite version** — upgrade SQLite independently of your Node.js version
- **Future-proof code** that works with both this package AND `node:sqlite`
- **Synchronous performance** with a clean, official API
- **Hassle-free installs** — prebuilds are bundled in the npm package (no postinstall downloads)
- **Node-API stability** — one prebuild per platform works across Node.js versions
- **Zero migration path** to `node:sqlite` when you're ready
- **Session/changeset support** for replication and synchronization

### Choose **`better-sqlite3`** when you want:

- A well-established synchronous SQLite library in maintenance mode
- A specific API design that differs from Node.js

### ~~Choose **`sqlite3`**~~ (deprecated)

> **`sqlite3` (node-sqlite3) is [unmaintained and deprecated](https://github.com/TryGhost/node-sqlite3/pull/1844) as of December 2025.** New projects should not use it. Existing users should migrate to one of the alternatives above.

### Choose **`node:sqlite`** when you're:

- Already on Node.js 22.5.0+ and don't need support for older versions
- Working in environments where you control the Node.js version
- Willing to track a release-candidate API that may still have minor changes

## Detailed comparison

### [`node:sqlite`](https://nodejs.org/docs/latest/api/sqlite.html), Node.js built-in module

_The official SQLite module included with Node.js 22.5.0+. Promoted to Release Candidate (Stability: 1.2) in Node.js v25.7.0._

**`node:sqlite` availability by Node.js version:**

| Node.js         | `node:sqlite` status                           |
| --------------- | ---------------------------------------------- |
| v20             | Not available                                  |
| v22.5.0–22.12.x | Requires `--experimental-sqlite` flag          |
| v22.13.0+       | Experimental (no flag needed, prints warning)  |
| v24.0.0–24.14.x | Experimental (no flag needed, prints warning)  |
| v24.15.0+       | Release Candidate (Stability: 1.2, no warning) |
| v25.0.0–25.6.x  | Experimental (no flag needed, prints warning)  |
| v25.7.0+        | Release Candidate (Stability: 1.2, no warning) |
| v26.0.0+        | Release Candidate (Stability: 1.2, no warning) |

**Pros:**

- **Zero dependencies**: built directly into Node.js
- **Official support**: maintained by the Node.js core team
- **Clean synchronous API**: simple, predictable blocking operations
- **Full SQLite power**: FTS5, JSON functions, R\*Tree, sessions/changesets, and more

**Cons:**

- **Release candidate**: API is stable but may still have minor changes before final stable designation
- **Requires Node.js 22.5.0+**: won't work on older versions
- **Coupled SQLite version**: you get whatever SQLite version shipped with your Node.js release — upgrading SQLite means upgrading Node.js

**Best for:** Projects already on Node.js 22.5.0+ that want zero dependencies and are comfortable with a release-candidate API.

---

### [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)

_A well-established synchronous SQLite library, now in maintenance mode (SQLite version updates and prebuild maintenance only)_

**Pros:**

- **Proven**: widely used in thousands of production apps
- **Stable API**: no breaking changes in years
- **Feature-rich**: user functions, aggregates, virtual tables, extensions
- **Large community**: many resources and Stack Overflow answers

**Cons:**

- **Maintenance mode**: receives SQLite updates and prebuild refreshes, but no new feature development
- **Different API**: not compatible with Node.js built-in SQLite
- **Postinstall download**: prebuilds are fetched from GitHub at install time, which can fail behind firewalls or in air-gapped environments
- **V8-specific**: requires separate prebuilds for each Node.js ABI version (no Node-API)
- **Migration effort**: switching from other libraries requires code changes
- **No session support**: doesn't expose SQLite's session/changeset functionality

**Best for:** Existing users who are happy with the current API and don't need new features.

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

| Feature                  | @photostructure/sqlite | node:sqlite                                       | better-sqlite3        | sqlite3               |
| ------------------------ | ---------------------- | ------------------------------------------------- | --------------------- | --------------------- |
| **API Compatibility**    | node:sqlite            | -                                                 | Custom                | Custom                |
| **SQLite Version**       | Independent            | Tied to Node.js release                           | Independent           | Independent           |
| **Min Node.js Version**  | 22.0.0                 | 22.5.0                                            | 14.0.0                | 10.0.0                |
| **Experimental Flag**    | ✅ Never needed        | ⚠️ Required on 22.5–22.12; not needed since 22.13 | ✅ Not needed         | ✅ Not needed         |
| **Synchronous API**      | ✅                     | ✅                                                | ✅                    | ❌                    |
| **Asynchronous API**     | ❌                     | ❌                                                | ❌                    | ✅                    |
| **TypeScript Types**     | ✅ Built-in            | ✅ Built-in                                       | ✅ Via @types         | ✅ Via @types         |
| **Custom Functions**     | ✅                     | ✅                                                | ✅                    | ✅                    |
| **Aggregate Functions**  | ✅                     | ✅                                                | ✅                    | ❌                    |
| **Window Functions**     | ✅                     | ✅                                                | ✅                    | ❌                    |
| **Sessions/Changesets**  | ✅                     | ✅                                                | ❌                    | ❌                    |
| **Backup API**           | ✅                     | ✅                                                | ✅ Different API      | ✅                    |
| **Extension Loading**    | ✅                     | ✅                                                | ✅                    | ✅                    |
| **Worker Threads**       | ✅                     | ✅                                                | ✅                    | ⚠️ Limited            |
| **FTS5**                 | ✅                     | ✅                                                | ✅                    | ✅                    |
| **JSON Functions**       | ✅                     | ✅                                                | ✅                    | ✅                    |
| **R\*Tree**              | ✅                     | ✅                                                | ✅                    | ✅                    |
| **Prebuild Strategy**    | Bundled in npm         | N/A (built-in)                                    | Downloaded on install | Downloaded on install |
| **Node-API**             | ✅                     | N/A                                               | ❌ V8-specific        | ✅                    |
| **Disposable Interface** | ✅ Native C++          | ✅ Native C++                                     | ❌                    | ❌                    |
| **node_modules Size**    | ~28MB (all prebuilds)  | 0 (built-in)                                      | ~14MB (with deps)     | ~15MB (with deps)     |

## Performance comparison

All three synchronous drivers are fast enough for most applications, but they
are not equal on every workload. Durable single-row writes tie because storage
sync time dominates, and indexed single-row reads are within roughly 20% of the
fastest driver in our benchmark. `@photostructure/sqlite` is slower when one
call materializes roughly 1,000 rows.

That bulk-read gap comes from the stable Node-API boundary. This package
converts each returned value through Node-API so its prebuilds work across
supported Node.js releases. `node:sqlite` is built into Node.js and can use
V8-only bulk constructors. See the [full benchmark results and
methodology](../benchmark/README.md).

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
- **better-sqlite3**: Maintenance mode — receives SQLite version updates and prebuild refreshes, but no recent feature development
- **sqlite3**: [Deprecated and unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) since December 2025

### Community and support

- **better-sqlite3**: Largest community, most Stack Overflow answers
- **node:sqlite**: Growing community as adoption increases
- **@photostructure/sqlite**: New but benefits from `node:sqlite` compatibility
- **sqlite3**: Large legacy community, but no longer maintained

## Conclusion

Choose based on your specific needs:

1. **Need support for all Node.js v22 releases?** → @photostructure/sqlite
2. **Already using better-sqlite3 and happy with it?** → No urgent reason to switch
3. **Have async legacy code using sqlite3?** → Migrate to @photostructure/sqlite or better-sqlite3 (sqlite3 is deprecated)
4. **Already on Node.js v22.13+, v24+, v25.7+, or v26+ with a preference for zero dependencies?** → `node:sqlite`
