# Migrating from better-sqlite3

This guide helps you migrate from better-sqlite3 to @photostructure/sqlite. While both libraries provide synchronous SQLite access, they have different APIs.

## Key API Differences

### Database Creation

```javascript
// better-sqlite3
const Database = require("better-sqlite3");
const db = new Database("mydb.sqlite");
const db = new Database("mydb.sqlite", { readonly: true });

// @photostructure/sqlite
const { DatabaseSync } = require("@photostructure/sqlite");
const db = new DatabaseSync("mydb.sqlite");
const db = new DatabaseSync("mydb.sqlite", { readOnly: true });
```

### Statement Preparation

Both libraries use prepared statements, but with different property names:

```javascript
// better-sqlite3
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");

// @photostructure/sqlite
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
// Same syntax! ✅
```

### Executing Statements

```javascript
// better-sqlite3
const row = stmt.get(userId);
const rows = stmt.all();
const info = stmt.run(data);

// @photostructure/sqlite
const row = stmt.get(userId);
const rows = stmt.all();
const info = stmt.run(data);
// Same methods! ✅
```

### Iteration

```javascript
// better-sqlite3
for (const row of stmt.iterate()) {
  console.log(row);
}

// @photostructure/sqlite
for (const row of stmt) {
  // Direct iteration on statement
  console.log(row);
}
```

### Property Differences

```javascript
// better-sqlite3
console.log(db.name); // 'mydb.sqlite'
console.log(db.open); // true/false
console.log(db.inTransaction); // true/false
console.log(db.memory); // true/false
console.log(db.readonly); // true/false

// @photostructure/sqlite
console.log(db.location); // 'mydb.sqlite' (different property name)
// Note: open, inTransaction, memory, readonly properties not available
```

### Custom Functions

```javascript
// better-sqlite3
db.function("add", (a, b) => a + b);
db.function(
  "add",
  {
    deterministic: true,
  },
  (a, b) => a + b,
);

// @photostructure/sqlite
db.function("add", (a, b) => a + b);
db.function(
  "add",
  {
    deterministic: true,
  },
  (a, b) => a + b,
);
// Same syntax! ✅
```

### Aggregate Functions

```javascript
// better-sqlite3
db.aggregate("custom_sum", {
  start: 0,
  step: (total, nextValue) => total + nextValue,
  result: (total) => total,
});

// @photostructure/sqlite
db.aggregate("custom_sum", {
  start: 0,
  step: (total, nextValue) => total + nextValue,
  result: (total) => total, // Optional in @photostructure/sqlite
});
// Nearly identical! ✅
```

### Transactions

```javascript
// better-sqlite3
const transaction = db.transaction((items) => {
  for (const item of items) {
    insertStmt.run(item);
  }
});
transaction(items);

// @photostructure/sqlite
// Manual transaction management
db.exec("BEGIN");
try {
  for (const item of items) {
    insertStmt.run(item);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
```

### Pragmas

```javascript
// better-sqlite3
db.pragma("journal_mode = WAL");
const result = db.pragma("cache_size");

// @photostructure/sqlite
db.exec("PRAGMA journal_mode = WAL");
const result = db.prepare("PRAGMA cache_size").get();
```

## Feature Differences

### Features Only in better-sqlite3

- ❌ `.transaction()` helper method (use manual `BEGIN`/`COMMIT`/`ROLLBACK`)
- ❌ `.pragma()` convenience method (use `db.exec("PRAGMA ...")` or `db.prepare("PRAGMA ...").get()`)
- ❌ `.serialize()` method
- ❌ `.defaultSafeIntegers()` method (use `stmt.setReadBigInts()` instead)
- ❌ `.unsafeMode()` method

### Features Only in @photostructure/sqlite

- ✅ SQLite sessions and changesets
- ✅ 100% compatibility with node:sqlite
- ✅ `.enableLoadExtension()` method
- ✅ Node.js-style backup API

### Common Features

- ✅ Synchronous API
- ✅ Prepared statements
- ✅ Parameter binding
- ✅ Custom functions
- ✅ Aggregate functions
- ✅ TypeScript support

## Migration Script Example

Here's a script to help automate common migrations:

```javascript
// migrate-from-better-sqlite3.js
const fs = require("fs");

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");

  // Update imports
  content = content.replace(
    /const Database = require\(['"]better-sqlite3['"]\)/g,
    "const { DatabaseSync } = require('@photostructure/sqlite')",
  );
  content = content.replace(
    /import Database from ['"]better-sqlite3['"]/g,
    "import { DatabaseSync } from '@photostructure/sqlite'",
  );

  // Update constructor calls
  content = content.replace(/new Database\(/g, "new DatabaseSync(");

  // Update options
  content = content.replace(/\breadonly:\s*true/g, "readOnly: true");

  // Update property access
  content = content.replace(/\.name\b/g, ".location");

  // Flag manual review needed for transactions
  if (content.includes(".transaction(")) {
    console.warn(
      `${filePath}: Manual review needed - contains .transaction() calls`,
    );
  }

  if (content.includes(".pragma(")) {
    console.warn(
      `${filePath}: Manual review needed - contains .pragma() calls`,
    );
  }

  fs.writeFileSync(filePath, content);
}

// Usage: node migrate-from-better-sqlite3.js src/**/*.js
```

## Performance Considerations

Both libraries offer similar performance characteristics:

- Synchronous operations (no async overhead)
- Direct SQLite C API access
- Minimal JavaScript wrapper overhead

## TypeScript Migration

Update your type imports:

```typescript
// better-sqlite3
import Database from "better-sqlite3";
const db: Database.Database = new Database("mydb.sqlite");

// @photostructure/sqlite
import { DatabaseSync } from "@photostructure/sqlite";
const db = new DatabaseSync("mydb.sqlite");
```

## Common Gotchas

1. **No .transaction() helper** - Use manual BEGIN/COMMIT/ROLLBACK
2. **No .pragma() method** - Use db.exec() or db.prepare().get()
3. **Different iteration syntax** - Iterate directly on statement, not stmt.iterate()
4. **Property name changes** - `.name` → `.location`
5. **No virtual table API** - Use raw SQL if needed

## Need Help?

- Check the [API Reference](./api-reference.md) for detailed method documentation
- See [Working with Data](./working-with-data.md) for transaction examples
- Visit [GitHub Discussions](https://github.com/photostructure/node-sqlite/discussions) for migration help
