# @photostructure/sqlite

Native SQLite for Node.js 20+ without the experimental flag. Drop-in replacement for `node:sqlite`. Updated to Node.js v25 for latest features and native Symbol.dispose resource management.

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

- 100% compatible with Node.js v25 built-in sqlite module
- Zero dependencies - native SQLite implementation
- Synchronous API - no async overhead
- Performance matches leading SQLite libraries
- Full SQLite feature set ([details](./doc/features.md))
- TypeScript support with complete type definitions
- Cross-platform prebuilt binaries (Windows/macOS/Linux, x64/ARM64)
- User-defined functions and aggregates
- Database backups and session/changeset support
- Session class exposed for advanced replication workflows
- Native Symbol.dispose for improved resource management
- URI filename support for advanced configuration
- Worker thread safe
- [Compare with other libraries →](./doc/library-comparison.md)

## Note

- DataView parameter binding is not currently supported. Use Buffer instead for binary data.

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
- [Library Comparison](./doc/library-comparison.md)

## Support

- 🐛 [Issues](https://github.com/photostructure/node-sqlite/issues)
- 💬 [Discussions](https://github.com/photostructure/node-sqlite/discussions)
- 📧 [Security](./SECURITY.md)

## License

MIT - see [LICENSE](./LICENSE) for details.

This package includes SQLite (public domain) and code from Node.js (MIT licensed).

---

**Note**: This package is not affiliated with the Node.js project. It extracts and redistributes Node.js's SQLite implementation under the MIT license.
