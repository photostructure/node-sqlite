<img src="https://raw.githubusercontent.com/photostructure/node-sqlite/main/doc/logo.svg" alt="PhotoStructure SQLite logo" width="200">

# @photostructure/sqlite

[![npm version](https://img.shields.io/npm/v/@photostructure/sqlite.svg)](https://www.npmjs.com/package/@photostructure/sqlite)
[![CI](https://github.com/photostructure/node-sqlite/actions/workflows/build.yml/badge.svg)](https://github.com/photostructure/node-sqlite/actions/workflows/build.yml)

Native SQLite for Node.js 20+. Drop-in replacement for `node:sqlite`. Synced with Node.js v26.4.0 for the latest features including native `Symbol.dispose` resource management.

## Installation

```bash
npm install @photostructure/sqlite
```

## Quick Start

```javascript
import { DatabaseSync } from "@photostructure/sqlite";

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
insert.run("Alice");
const users = db.prepare("SELECT * FROM users").all();
console.log(users); // [{ id: 1, name: 'Alice' }]
db.close();
```

## Features

- API-compatible with Node.js v26.4.0 built-in `node:sqlite` module\*
- Zero dependencies - native SQLite implementation
- Synchronous API - no async overhead
- Native SQLite performance ([benchmarks and tradeoffs](./benchmark/README.md))
- Full SQLite feature set ([details](./doc/features.md))
- TypeScript support with complete type definitions
- Cross-platform prebuilt binaries (Windows/macOS/Linux, x64/ARM64)
- User-defined functions and aggregates
- Database backups and session/changeset support
- Session class exposed for advanced replication workflows
- Native `Symbol.dispose` for resource management
- `enhance()` function for better-sqlite3 style `.pragma()` and `.transaction()` methods
- URI filename support for advanced configuration
- Worker thread safe
- [Compare with other libraries →](./doc/library-comparison.md)

## Performance

For most applications, `@photostructure/sqlite` is fast enough that SQLite or
storage will be the bottleneck. Durable single-row writes match `node:sqlite`
and `better-sqlite3`, and indexed single-row reads are within roughly 20% of the
fastest driver in our benchmarks.

The exception is materializing large result sets. This package uses the stable
Node-API ABI for compatibility across Node.js releases, so each returned value
crosses that boundary. `node:sqlite` can use internal V8 bulk constructors that
addons cannot use through stable Node-API. If thousand-row reads are a hot path
in your application, [review the results and run the benchmark](./benchmark/README.md).

## Note

\*API-compatible with Node.js SQLite, but this library adopts SQLite-recommended features and security-enhancing build flags. See [build configuration details](./doc/build-flags.md).

## Documentation

**Getting Started**

- [Installation & Setup](./doc/getting-started.md)
- [Migrating from node:sqlite](./doc/migrating-from-node-sqlite.md)
- [Migrating from better-sqlite3](./doc/migrating-from-better-sqlite3.md)

**Using SQLite**

- [Working with Data](./doc/working-with-data.md)
- [Extending SQLite](./doc/extending-sqlite.md)
- [Advanced Patterns](./doc/advanced-patterns.md)

**Reference**

- [API Reference](./doc/api-reference.md)
- [All Features](./doc/features.md)
- [Build Flags & Configuration](./doc/build-flags.md)
- [Library Comparison](./doc/library-comparison.md)

## License

MIT - see [LICENSE](./LICENSE) for details.

This package includes SQLite (public domain) and code from Node.js (MIT licensed).

---

**Note**: This package is not affiliated with the Node.js project. It extracts and redistributes Node.js's SQLite implementation under the MIT license.
