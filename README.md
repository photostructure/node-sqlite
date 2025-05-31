## 🚀 Drop-in Replacement for node:sqlite

This package provides **100% API compatibility** with Node.js v24 built-in SQLite module (`node:sqlite`). You can seamlessly switch between this package and the built-in module without changing any code.

```javascript
// Using Node.js built-in SQLite (requires Node.js 22.5.0+ and --experimental-sqlite flag)
const { DatabaseSync } = require("node:sqlite");

// Using @photostructure/sqlite (works on Node.js 20+ without any flags)
const { DatabaseSync } = require("@photostructure/sqlite");

// The API is identical - no code changes needed!
```

## Overview

Node.js has an [experimental built-in SQLite module](https://nodejs.org/docs/latest/api/sqlite.html) that provides synchronous database operations with excellent performance. However, it's only available in the newest Node.js versions, and requires the `--experimental-sqlite` flag.

This package extracts that implementation into a standalone library that:

- **Works everywhere**: Compatible with Node.js 20+ without experimental flags
- **Drop-in replacement**: 100% API compatible with `node:sqlite` - no code changes needed
- **Full-featured**: Includes all SQLite extensions (FTS, JSON, math functions, etc.)
- **High performance**: Direct SQLite C library integration with minimal overhead
- **Type-safe**: Complete TypeScript definitions matching Node.js exactly
- **Future-proof**: When `node:sqlite` becomes stable, switching back requires zero code changes

## Installation

```bash
npm install @photostructure/sqlite
```

## Quick Start

### As a Drop-in Replacement

```javascript
// If you have code using node:sqlite:
const { DatabaseSync } = require("node:sqlite");

// Simply replace with:
const { DatabaseSync } = require("@photostructure/sqlite");
// That's it! No other changes needed.
```

### Basic Example

```typescript
import { DatabaseSync } from "@photostructure/sqlite";

// Create an in-memory database
const db = new DatabaseSync(":memory:");

// Create a table
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

// Insert data
const insertStmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
const result = insertStmt.run("Alice Johnson", "alice@example.com");
console.log("Inserted user with ID:", result.lastInsertRowid);

// Query data
const selectStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const user = selectStmt.get(result.lastInsertRowid);
console.log("User:", user);

// Clean up
db.close();
```

## API Reference

### Database Configuration Options

### Custom Functions

```typescript
// Register a simple custom SQL function
db.function("multiply", (a, b) => a * b);

// With options
db.function(
  "hash",
  {
    deterministic: true, // Same inputs always produce same output
    directOnly: true, // Cannot be called from triggers/views
  },
  (value) => {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  },
);

// Aggregate function
db.aggregate("custom_sum", {
  start: 0,
  step: (sum, value) => sum + value,
  result: (sum) => sum,
});

// Use in SQL
const result = db
  .prepare("SELECT custom_sum(price) as total FROM products")
  .get();
console.log(result.total);
```

### Database Backup

```typescript
// Simple backup
await db.backup("./backup.db");

// Backup with progress monitoring
await db.backup("./backup.db", {
  rate: 10, // Copy 10 pages per iteration
  progress: ({ totalPages, remainingPages }) => {
    const percent = (
      ((totalPages - remainingPages) / totalPages) *
      100
    ).toFixed(1);
    console.log(`Backup progress: ${percent}%`);
  },
});

// Backup specific attached database
db.exec("ATTACH DATABASE 'other.db' AS other");
await db.backup("./other-backup.db", {
  source: "other", // Backup the attached database instead of main
});
```

### Database Restoration

```typescript
// Restore from a backup file
import * as fs from "fs";

// Close the current database
db.close();

// Copy the backup file over the current database file
fs.copyFileSync("./backup.db", "./mydata.db");

// Reopen the database with the restored data
const restoredDb = new DatabaseSync("./mydata.db");

// Verify restoration
const count = restoredDb.prepare("SELECT COUNT(*) as count FROM users").get();
console.log(`Restored database has ${count.count} users`);
```

### Session-based Change Tracking

SQLite's session extension allows you to record changes and apply them to other databases - perfect for synchronization, replication, or undo/redo functionality. This feature is available in both `node:sqlite` and `@photostructure/sqlite`, but not in better-sqlite3.

```typescript
// Create a session to track changes
const session = db.createSession({ table: "users" });

// Make some changes
db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Alice Smith", 1);
db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(
  "Bob",
  "bob@example.com",
);

// Get the changes as a changeset
const changeset = session.changeset();
session.close();

// Apply changes to another database
const otherDb = new DatabaseSync("./replica.db");
const applied = otherDb.applyChangeset(changeset, {
  onConflict: (conflict) => {
    console.log(`Conflict on table ${conflict.table}`);
    return constants.SQLITE_CHANGESET_REPLACE; // Resolve by replacing
  },
});
```

### Parameter Binding

```typescript
const stmt = db.prepare("SELECT * FROM users WHERE name = ? AND age > ?");

// Positional parameters
const users1 = stmt.all("Alice", 25);

// Named parameters (with object)
const stmt2 = db.prepare(
  "SELECT * FROM users WHERE name = $name AND age > $age",
);
const users2 = stmt2.all({ name: "Alice", age: 25 });
```

### Using with TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

const db = new DatabaseSync("users.db");
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");

const user = stmt.get(1) as User;
console.log(`User: ${user.name} <${user.email}>`);
```

## Performance

This package provides performance comparable to Node.js's built-in SQLite and better-sqlite3, with:

- **Synchronous operations** - No async/await overhead
- **Direct C library access** - Minimal JavaScript ↔ native boundary crossings
- **Full SQLite features** - FTS5, JSON functions, R\*Tree indexes, math functions, session extension (including changesets)

Performance is quite similar to node:sqlite and better-sqlite3, while significantly faster than async sqlite3 due to synchronous operations.

## Platform Support

| Platform | x64 | ARM64 | Notes         |
| -------- | --- | ----- | ------------- |
| Linux    | ✅  | ✅    | Ubuntu 20.04+ |
| macOS    | ✅  | ✅    | macOS 10.15+  |
| Windows  | ✅  | ✅    | Windows 10+   |

Prebuilt binaries are provided for all supported platforms. If a prebuilt binary isn't available, the package will compile from source using node-gyp.

## Development Requirements

- **Node.js**: v20 or higher
- **Build tools** (if compiling from source):
  - Linux: `build-essential`, `python3`
  - macOS: Xcode command line tools
  - Windows: Visual Studio Build Tools

## Alternatives

When choosing a SQLite library for Node.js, you have several excellent options. Here's how **`@photostructure/sqlite`** compares to the alternatives:

### 🏷️ [`node:sqlite`](https://nodejs.org/docs/latest/api/sqlite.html) — Node.js Built-in Module

_The official SQLite module included with Node.js 22.5.0+ (experimental)_

**✨ Pros:**

- **Zero dependencies** — Built directly into Node.js
- **Official support** — Maintained by the Node.js core team
- **Clean synchronous API** — Simple, predictable blocking operations
- **Full SQLite power** — FTS5, JSON functions, R\*Tree, sessions/changesets, and more

**⚠️ Cons:**

- **Experimental status** — Not yet stable for production use
- **Requires Node.js 22.5.0+** — Won't work on older versions
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

---

## 🎯 Quick Decision Guide

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

## Contributing

Contributions are welcome! This project maintains 100% API compatibility with Node.js's built-in SQLite module. Please run tests with `npm test` and ensure code passes linting with `npm run lint` before submitting changes. When adding new features, include corresponding tests and ensure they match Node.js SQLite behavior exactly.

The project includes automated sync scripts to keep up-to-date with:

- **Node.js SQLite implementation** via `npm run sync:node`
- **SQLite library updates** via `npm run sync:sqlite`

## Security

This project takes security seriously and employs multiple layers of protection:

- **Automated scanning**: npm audit, Snyk, OSV Scanner, CodeQL (JS/TS and C++), and TruffleHog
- **Weekly security scans**: Automated checks for new vulnerabilities
- **Rapid patching**: Security fixes are prioritized and released quickly
- **Memory safety**: Validated through ASAN, valgrind, and comprehensive testing

### Running Security Scans Locally

```bash
# Install security tools (OSV Scanner, etc.)
./scripts/setup-security-tools.sh

# Run all security scans
npm run security
```

For details, see our [Security Policy](./SECURITY.md). To report vulnerabilities, please email security@photostructure.com.

## License

MIT License - see [LICENSE](./LICENSE) for details.

This package includes SQLite, which is in the public domain, as well as code from the Node.js project, which is MIT licensed.

## Support

- 🐛 **Bug reports**: [GitHub Issues](https://github.com/photostructure/node-sqlite/issues)
- 💬 **Questions**: [GitHub Discussions](https://github.com/photostructure/node-sqlite/discussions)
- 📧 **Security issues**: see [SECURITY.md](./SECURITY.md)

## Known Limitations

- Worker threads are not currently supported due to V8 isolate handling complexities in native addons. Use separate processes or the main thread for concurrent database access.
- SQLite sessions/changesets and backup functionality are still in development.
- Extension loading is not yet implemented.

For concurrent access within the same process, multiple database connections work well with WAL mode enabled.

---

## Development

This project was built with substantial assistance from [Claude Code](https://claude.ai/referral/gM3vgw7pfA), an AI coding assistant.

Note that all changes are human-reviewed before merging.

### Project Timeline

**Conception to v1.0: 3 days** ⚡

- **3,900 lines** of C++ implementation
- **11,000 lines** of comprehensive TypeScript tests
- **337 tests** with full API compliance
- **Multi-platform CI/CD** with automated builds
- **Security scanning** and memory leak detection
- **Automated sync** from Node.js and SQLite upstream
- **Robust [benchmarking suite](./benchmark/README.md)** including all popular Node.js SQLite libraries

### Development Cost

- **API usage**: ~$390 in Claude tokens
- **Actual cost**: $100/month Anthropic MAX plan subscription
- **Time saved**: Weeks of manual porting work

This project demonstrates how AI-assisted development can accelerate complex system programming while maintaining high code quality through comprehensive testing and human oversight.

---

**Note**: This package is not affiliated with the Node.js project. It extracts and redistributes Node.js's SQLite implementation under the MIT license.
