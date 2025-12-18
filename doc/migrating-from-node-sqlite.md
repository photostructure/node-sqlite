# Migrating from node:sqlite

@photostructure/sqlite provides **100% API compatibility** with Node.js's built-in SQLite module. This means you can use it as a drop-in replacement without changing any code.

## Drop-in Replacement

Simply change your import statement:

```javascript
// Before: Using Node.js built-in SQLite (available in Node.js 22.5.0+)
const { DatabaseSync } = require("node:sqlite");

// After: Using @photostructure/sqlite (works on Node.js 20+ without any flags)
const { DatabaseSync } = require("@photostructure/sqlite");
```

Or with ES modules:

```javascript
// Before
import { DatabaseSync } from "node:sqlite";

// After
import { DatabaseSync } from "@photostructure/sqlite";
```

**That's it!** All your existing code will work exactly the same.

## Key Differences

### No Experimental Flag Required

```bash
# Node.js built-in requires:
node --experimental-sqlite app.js

# @photostructure/sqlite works directly:
node app.js
```

### Broader Node.js Version Support

- **node:sqlite**: Available in Node.js 22.5.0+ (experimental status)
- **@photostructure/sqlite**: Works with Node.js 20.0.0 or higher

### Same API, Same Behavior

All classes, methods, and properties are identical:

- `DatabaseSync` class with all the same methods
- `StatementSync` class with identical behavior
- Same parameter binding syntax
- Same error handling
- Same return values
- Same SQLite features enabled
- Native Symbol.dispose implementation for improved resource management
- Session class exposed for advanced replication workflows

## Example: Identical Code Works in Both

```javascript
// This code works identically with both libraries
const { DatabaseSync, StatementSync } = require("@photostructure/sqlite");
// OR: const { DatabaseSync, StatementSync } = require('node:sqlite');

const db = new DatabaseSync(":memory:");

// Create tables
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

// Prepared statements
const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
const result = insert.run("Alice", "alice@example.com");
console.log(result.lastInsertRowid);

// Queries
const users = db.prepare("SELECT * FROM users").all();
console.log(users);

// Custom functions
db.function("uppercase", (str) => str.toUpperCase());
const upper = db.prepare("SELECT uppercase(name) as name FROM users").get();
console.log(upper.name); // ALICE

// Cleanup
db.close();
```

## Migration Checklist

1. ✅ Install @photostructure/sqlite: `npm install @photostructure/sqlite`
2. ✅ Change imports from `'node:sqlite'` to `'@photostructure/sqlite'`
3. ✅ Remove `--experimental-sqlite` flag from your npm scripts
4. ✅ Run your tests - they should all pass!

## Additional Constants

@photostructure/sqlite exports 20 additional `SQLITE_OPEN_*` constants for advanced database opening scenarios. These are available via `constants.SQLITE_OPEN_*` and are useful for low-level control. These constants are additive and don't affect API compatibility.

## Unsupported Features

### Node.js Permission Model

Node.js's [permission model](https://nodejs.org/api/permissions.html#permission-model) (`--permission` flag) provides security restrictions that are enforced at the Node.js runtime level. Since @photostructure/sqlite is a userland package, it cannot integrate with this internal security mechanism.

If you use the permission model and need SQLite extension loading restrictions enforced by it, you must use the built-in `node:sqlite` module.

**Workaround**: For extension loading control, you can simply avoid calling `loadExtension()` or set `allowExtension: false` (the default) when creating databases.

## When to Keep Using node:sqlite

You might want to stick with the built-in module if:

- You're already on Node.js 22.5.0+ and don't need backward compatibility
- You prefer zero dependencies and don't mind the experimental flag
- You're building for an environment where the flag is already enabled
- You require Node.js permission model integration for extension loading restrictions

## When to Use @photostructure/sqlite

Choose this package when:

- You need to support Node.js versions before 22.5.0
- You want to avoid experimental flags in production
- You need the exact same API but with broader compatibility
- You're distributing a library and want to support more Node.js versions

## Future Migration Path

When `node:sqlite` becomes stable (removes the experimental flag), migrating back is trivial:

```javascript
// Simply change the import back
import { DatabaseSync } from "node:sqlite";
// All your code continues to work unchanged
```

This makes @photostructure/sqlite a perfect bridge solution while waiting for the official module to stabilize.
