# API Reference

Complete API documentation for @photostructure/sqlite. This package provides 100% compatibility with Node.js's built-in SQLite module.

## Table of Contents

- [DatabaseSync](#databasesync)
- [StatementSync](#statementsync)
- [Types and Interfaces](#types-and-interfaces)
- [Constants](#constants)
- [Error Handling](#error-handling)

## DatabaseSync

The main database class for synchronous SQLite operations.

### Constructor

```typescript
new DatabaseSync(location: string, options?: DatabaseSyncOptions)
```

Creates a new database connection.

**Parameters:**

- `location` - Path to database file. Special values:
  - `:memory:` - In-memory database
  - `""` (empty string) - Temporary on-disk database
  - URI format supported (e.g., `file:data.db?mode=ro`)
- `options` - Optional configuration object

**Options:**

```typescript
interface DatabaseSyncOptions {
  readOnly?: boolean; // Open in read-only mode (default: false)
  enableForeignKeyConstraints?: boolean; // Enable foreign keys (default: true)
  enableDoubleQuotedStringLiterals?: boolean; // Allow double-quoted strings (default: false)
  timeout?: number; // Busy timeout in ms (default: 5000)
  allowExtension?: boolean; // Allow loading extensions (default: false)
}
```

**Examples:**

```javascript
// Basic usage
const db = new DatabaseSync("myapp.db");

// In-memory database
const memDb = new DatabaseSync(":memory:");

// Read-only with options
const readOnlyDb = new DatabaseSync("data.db", {
  readOnly: true,
  timeout: 10000,
});

// URI format
const uriDb = new DatabaseSync("file:data.db?mode=ro&cache=private");
```

### Methods

#### close()

```typescript
close(): void
```

Closes the database connection. All prepared statements are finalized automatically.

```javascript
db.close();
```

#### [Symbol.dispose]()

```typescript
[Symbol.dispose](): void
```

Implements the disposable interface for automatic resource management. Calls `close()` internally, ignoring any errors during disposal. Implemented natively in C++ for better performance.

```javascript
// Automatic cleanup with using statement
using db = new DatabaseSync("myapp.db");
// db.close() called automatically when leaving scope

// Or explicit disposal
db[Symbol.dispose]();
```

#### exec()

```typescript
exec(sql: string): void
```

Executes one or more SQL statements. Does not return any results.

```javascript
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
  CREATE INDEX idx_name ON users(name);
`);
```

#### prepare()

```typescript
prepare(sql: string, options?: StatementOptions): StatementSync
```

Prepares a SQL statement for execution.

**Options:**

```typescript
interface StatementOptions {
  expandedSQL?: boolean; // Include expanded SQL (default: false)
  anonymousParameters?: boolean; // Enable anonymous parameters (default: false)
}
```

```javascript
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtWithExpanded = db.prepare("SELECT * FROM users WHERE id = ?", {
  expandedSQL: true,
});
```

#### function()

```typescript
function(name: string, options: FunctionOptions | Function, func?: Function): void
```

Registers a custom scalar SQL function.

**Options:**

```typescript
interface FunctionOptions {
  deterministic?: boolean; // Same input always gives same output
  directOnly?: boolean; // Cannot be used in triggers/views
  varargs?: boolean; // Accept variable number of arguments
}
```

```javascript
// Simple function
db.function("double", (x) => x * 2);

// With options
db.function(
  "hash",
  {
    deterministic: true,
    directOnly: true,
  },
  (value) => {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  },
);

// Variable arguments
db.function("concat", { varargs: true }, (...args) => args.join(""));
```

#### aggregate()

```typescript
aggregate(name: string, options: AggregateOptions): void
```

Registers a custom aggregate SQL function.

**Options:**

```typescript
interface AggregateOptions {
  start: any | (() => any); // Initial value or factory
  step: (accumulator: any, ...values: any[]) => any; // Step function
  result?: (accumulator: any) => any; // Final result transformer
  deterministic?: boolean;
  directOnly?: boolean;
  varargs?: boolean;
}
```

```javascript
// Sum aggregate
db.aggregate("custom_sum", {
  start: 0,
  step: (sum, value) => sum + value,
});

// Average aggregate
db.aggregate("custom_avg", {
  start: { sum: 0, count: 0 },
  step: (acc, value) => {
    acc.sum += value;
    acc.count += 1;
    return acc;
  },
  result: (acc) => acc.sum / acc.count,
});
```

#### backup()

```typescript
backup(destination: string, options?: BackupOptions): Promise<void>
```

Creates a backup of the database.

**Options:**

```typescript
interface BackupOptions {
  source?: string; // Source database name (default: 'main')
  rate?: number; // Pages per iteration (default: 100)
  progress?: (info: { totalPages: number; remainingPages: number }) => void;
}
```

```javascript
// Simple backup
await db.backup("backup.db");

// With progress monitoring
await db.backup("backup.db", {
  rate: 10,
  progress: ({ totalPages, remainingPages }) => {
    const percent = (
      ((totalPages - remainingPages) / totalPages) *
      100
    ).toFixed(1);
    console.log(`Backup progress: ${percent}%`);
  },
});
```

#### createSession()

```typescript
createSession(options?: SessionOptions): Session
```

Creates a session for tracking changes.

**Options:**

```typescript
interface SessionOptions {
  table?: string; // Specific table to track
  db?: string; // Database name (default: 'main')
}
```

```javascript
const session = db.createSession({ table: "users" });
// Make changes...
const changeset = session.changeset();
session.close();
```

#### applyChangeset()

```typescript
applyChangeset(changeset: Uint8Array, options?: ChangesetOptions): ApplyResult
```

Applies a changeset to the database.

```javascript
const result = db.applyChangeset(changeset, {
  onConflict: (conflict) => {
    console.log(`Conflict on table ${conflict.table}`);
    return constants.SQLITE_CHANGESET_REPLACE;
  },
});
```

#### enableLoadExtension()

```typescript
enableLoadExtension(enable: boolean): void
```

Enables or disables extension loading. Requires `allowExtension: true` in constructor.

```javascript
db.enableLoadExtension(true);
db.loadExtension("./my-extension.so");
db.enableLoadExtension(false);
```

#### loadExtension()

```typescript
loadExtension(path: string, entryPoint?: string): void
```

Loads a SQLite extension.

```javascript
db.loadExtension("./extensions/vector.so");
db.loadExtension("./custom.so", "sqlite3_custom_init");
```

### Properties

#### location

```typescript
readonly location: string
```

The path or URI of the database file.

```javascript
console.log(db.location); // "myapp.db"
```

## StatementSync

Represents a prepared SQL statement.

### Methods

#### run()

```typescript
run(...params: any[]): RunResult
```

Executes the statement and returns information about changes.

**Returns:**

```typescript
interface RunResult {
  changes: number; // Number of rows affected
  lastInsertRowid: number | bigint; // Last inserted row ID
}
```

```javascript
const result = stmt.run("Alice", 30);
console.log(`Inserted row ${result.lastInsertRowid}`);
```

#### get()

```typescript
get(...params: any[]): any
```

Executes the statement and returns the first row.

```javascript
const user = stmt.get(1);
console.log(user); // { id: 1, name: 'Alice', age: 30 }
```

#### all()

```typescript
all(...params: any[]): any[]
```

Executes the statement and returns all rows.

```javascript
const users = stmt.all();
console.log(users); // Array of all user objects
```

#### [Symbol.iterator]()

Allows direct iteration over statement results.

```javascript
for (const row of stmt) {
  console.log(row);
}
```

#### finalize()

```typescript
finalize(): void
```

Finalizes the statement and frees resources.

```javascript
stmt.finalize();
```

#### [Symbol.dispose]()

```typescript
[Symbol.dispose](): void
```

Implements the disposable interface for automatic resource management. Calls `finalize()` internally, ignoring any errors during disposal. Implemented natively in C++ for better performance.

```javascript
// Automatic cleanup with using statement
using stmt = db.prepare("SELECT * FROM users WHERE id = ?");
// stmt.finalize() called automatically when leaving scope

// Or explicit disposal
stmt[Symbol.dispose]();
```

### Properties

#### sourceSQL

```typescript
readonly sourceSQL: string
```

The original SQL text of the statement.

```javascript
console.log(stmt.sourceSQL); // "SELECT * FROM users WHERE id = ?"
```

#### expandedSQL

```typescript
readonly expandedSQL: string
```

The SQL with bound parameters expanded (only if `expandedSQL: true` option was used).

```javascript
const stmt = db.prepare("SELECT * FROM users WHERE id = ?", {
  expandedSQL: true,
});
stmt.get(42);
console.log(stmt.expandedSQL); // "SELECT * FROM users WHERE id = 42"
```

## Types and Interfaces

### DatabaseSyncOptions

```typescript
interface DatabaseSyncOptions {
  readOnly?: boolean;
  enableForeignKeyConstraints?: boolean;
  enableDoubleQuotedStringLiterals?: boolean;
  timeout?: number;
  allowExtension?: boolean;
}
```

### StatementOptions

```typescript
interface StatementOptions {
  expandedSQL?: boolean;
  anonymousParameters?: boolean;
}
```

### FunctionOptions

```typescript
interface FunctionOptions {
  deterministic?: boolean;
  directOnly?: boolean;
  varargs?: boolean;
}
```

### AggregateOptions

```typescript
interface AggregateOptions {
  start: any | (() => any);
  step: (accumulator: any, ...values: any[]) => any;
  result?: (accumulator: any) => any;
  deterministic?: boolean;
  directOnly?: boolean;
  varargs?: boolean;
}
```

### BackupOptions

```typescript
interface BackupOptions {
  source?: string;
  rate?: number;
  progress?: (info: { totalPages: number; remainingPages: number }) => void;
}
```

## Constants

The package exports SQLite constants for use with sessions and changesets:

```javascript
import { constants } from "@photostructure/sqlite";

// Conflict resolution constants
constants.SQLITE_CHANGESET_OMIT;
constants.SQLITE_CHANGESET_REPLACE;
constants.SQLITE_CHANGESET_ABORT;

// And many more SQLite constants...
```

## Error Handling

All errors thrown include enhanced information:

```typescript
interface SQLiteError extends Error {
  code: string; // e.g., "SQLITE_CANTOPEN"
  sqliteCode: number; // e.g., 14
  sqliteExtendedCode: number;
  sqliteErrorString: string; // Human-readable description
  systemErrno?: number; // OS error code (when applicable)
}
```

```javascript
try {
  db.exec("INVALID SQL");
} catch (error) {
  console.log(error.message); // Full error message
  console.log(error.code); // "SQLITE_ERROR"
  console.log(error.sqliteCode); // 1
  console.log(error.sqliteErrorString); // "SQL logic error"
}
```

## See Also

- [SQLite C API Reference](./reference/sqlite-api.md) - Low-level C API documentation
- [Working with Data](./working-with-data.md) - Practical examples and patterns
- [Extending SQLite](./extending-sqlite.md) - Custom functions and extensions
