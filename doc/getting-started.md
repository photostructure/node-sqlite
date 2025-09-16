# Getting Started with @photostructure/sqlite

This guide will help you get up and running with @photostructure/sqlite, a native SQLite implementation for Node.js.

## Installation

```bash
npm install @photostructure/sqlite
```

Or with yarn:

```bash
yarn add @photostructure/sqlite
```

## Platform Requirements

- **Node.js**: v20 or higher
- **Operating Systems**: Windows 10+, macOS 10.15+, Linux (GLIBC 2.31+)
- **Architectures**: x64 and ARM64

### Linux Distribution Requirements

**Supported distributions** (with prebuilt binaries):

- Ubuntu 20.04 LTS and newer
- Debian 11 (Bullseye) and newer
- RHEL/CentOS/Rocky/Alma Linux 8 and newer
- Fedora 32 and newer
- Alpine Linux 3.21 and newer (musl libc)
- Any distribution with GLIBC 2.31 or newer

**Not supported** (GLIBC too old):

- Debian 10 (Buster) - GLIBC 2.28
- Ubuntu 18.04 LTS - GLIBC 2.27
- CentOS 7 - GLIBC 2.17
- Amazon Linux 2 - GLIBC 2.26

> **Note**: While Node.js 20 itself supports these older distributions, our prebuilt binaries require GLIBC 2.31+ due to toolchain requirements. Users on older distributions can still compile from source if they have a compatible compiler (GCC 10+ with C++20 support).

## Development Requirements

If prebuilt binaries aren't available for your platform, the package will compile from source. You'll need:

- **Linux**: `build-essential`, `python3` (3.8+), GCC 10+ or Clang 10+
- **macOS**: Xcode command line tools
- **Windows**: Visual Studio Build Tools 2019 or newer
- **Python**: 3.8 or higher (required by node-gyp v11)

## Your First Database

### In-Memory Database

```javascript
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
const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
insert.run("Alice", "alice@example.com");
insert.run("Bob", "bob@example.com");

// Query data
const users = db.prepare("SELECT * FROM users").all();
console.log(users);
// Output: [
//   { id: 1, name: 'Alice', email: 'alice@example.com' },
//   { id: 2, name: 'Bob', email: 'bob@example.com' }
// ]

// Always close the database when done
db.close();
```

### File-Based Database

```javascript
import { DatabaseSync } from "@photostructure/sqlite";

// Create or open a database file
const db = new DatabaseSync("myapp.db");

// Enable foreign keys (recommended)
db.exec("PRAGMA foreign_keys = ON");

// Your database operations...

// Always close when done
db.close();
```

### Using TypeScript

```typescript
import { DatabaseSync, StatementSync } from "@photostructure/sqlite";

interface User {
  id: number;
  name: string;
  email: string;
}

const db = new DatabaseSync("users.db");

// Type your statement results
const stmt: StatementSync = db.prepare("SELECT * FROM users WHERE id = ?");
const user = stmt.get(1) as User | undefined;

if (user) {
  console.log(`Found user: ${user.name}`);
}

db.close();
```

## Common Patterns

### Using try-finally for cleanup

```javascript
const db = new DatabaseSync("myapp.db");
try {
  // Your database operations
  db.exec(
    "CREATE TABLE IF NOT EXISTS data (id INTEGER PRIMARY KEY, value TEXT)",
  );
  // ... more operations ...
} finally {
  // Ensure database is closed even if an error occurs
  db.close();
}
```

### Automatic Resource Management with `using`

For Node.js 20+ with `--experimental-explicit-resource-management` flag, or TypeScript 5.2+ with disposable support, you can use the `using` statement for automatic cleanup:

```javascript
// Database is automatically closed when leaving scope
using db = new DatabaseSync("myapp.db");

// Create and use statements
using insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
using select = db.prepare("SELECT * FROM users WHERE id = ?");

insert.run("Alice", "alice@example.com");
const user = select.get(1);

// No need to call db.close() or insert.finalize() - happens automatically!
```

This pattern ensures resources are always cleaned up, even if an exception occurs. Both `DatabaseSync` and `StatementSync` implement the disposable interface (`Symbol.dispose`).

### Transactions

```javascript
const db = new DatabaseSync("myapp.db");
try {
  db.exec("BEGIN TRANSACTION");

  const insert = db.prepare(
    "INSERT INTO accounts (name, balance) VALUES (?, ?)",
  );
  insert.run("Alice", 1000);
  insert.run("Bob", 500);

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
```

## Next Steps

- [Working with Data](./working-with-data.md) - Learn about prepared statements, parameter binding, and transactions
- [API Reference](./api-reference.md) - Complete documentation of all classes and methods
- [Migrating from other libraries](./migrating-from-better-sqlite3.md) - If you're coming from better-sqlite3 or node-sqlite3
