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

The package exports SQLite constants for use with sessions, changesets, and authorization:

```javascript
import { constants } from "@photostructure/sqlite";

// Conflict resolution constants
constants.SQLITE_CHANGESET_OMIT;
constants.SQLITE_CHANGESET_REPLACE;
constants.SQLITE_CHANGESET_ABORT;

// Authorization result codes
constants.SQLITE_OK;
constants.SQLITE_DENY;
constants.SQLITE_IGNORE;

// Authorization action codes
constants.SQLITE_CREATE_TABLE;
constants.SQLITE_INSERT;
constants.SQLITE_SELECT;
// ... and more
```

### TypeScript Type Categories

> **Note:** These categorized type interfaces are an extension provided by `@photostructure/sqlite`.
> The `node:sqlite` module exports only a flat `constants` object without these type categories.

This package provides strongly-typed interfaces for different constant categories, enabling better TypeScript type checking and IntelliSense:

```typescript
import {
  constants,
  // Type interfaces (not in node:sqlite)
  SqliteConstants,
  SqliteOpenFlags,
  SqliteChangesetResolution,
  SqliteChangesetConflictTypes,
  SqliteAuthorizationResults,
  SqliteAuthorizationActions,
} from "@photostructure/sqlite";
```

#### SqliteOpenFlags (Extension)

Database open flags. **These constants are an extension beyond `node:sqlite`** - the `node:sqlite` module does not export `SQLITE_OPEN_*` constants.

| Constant                   | Description                           |
| -------------------------- | ------------------------------------- |
| `SQLITE_OPEN_READONLY`     | Open database for reading only        |
| `SQLITE_OPEN_READWRITE`    | Open database for reading and writing |
| `SQLITE_OPEN_CREATE`       | Create database if it doesn't exist   |
| `SQLITE_OPEN_URI`          | Interpret filename as URI             |
| `SQLITE_OPEN_MEMORY`       | Open in-memory database               |
| `SQLITE_OPEN_NOMUTEX`      | Open without mutex                    |
| `SQLITE_OPEN_FULLMUTEX`    | Open with full mutex                  |
| `SQLITE_OPEN_SHAREDCACHE`  | Enable shared cache mode              |
| `SQLITE_OPEN_PRIVATECACHE` | Enable private cache mode             |
| `SQLITE_OPEN_WAL`          | Open WAL file                         |
| ...                        | (10 more flags available)             |

#### SqliteChangesetResolution (node:sqlite compatible)

Return values for `applyChangeset()` conflict callbacks:

| Constant                   | Description                 |
| -------------------------- | --------------------------- |
| `SQLITE_CHANGESET_OMIT`    | Skip conflicting changes    |
| `SQLITE_CHANGESET_REPLACE` | Replace conflicting changes |
| `SQLITE_CHANGESET_ABORT`   | Abort on conflict           |

#### SqliteChangesetConflictTypes (node:sqlite compatible)

Conflict type codes passed to `applyChangeset()` callbacks:

| Constant                       | Description                  |
| ------------------------------ | ---------------------------- |
| `SQLITE_CHANGESET_DATA`        | Row exists but values differ |
| `SQLITE_CHANGESET_NOTFOUND`    | Row not found in target      |
| `SQLITE_CHANGESET_CONFLICT`    | Primary key conflict         |
| `SQLITE_CHANGESET_CONSTRAINT`  | Constraint violation         |
| `SQLITE_CHANGESET_FOREIGN_KEY` | Foreign key violation        |

#### SqliteAuthorizationResults (node:sqlite compatible)

Return values for `setAuthorizer()` callbacks:

| Constant        | Description                 |
| --------------- | --------------------------- |
| `SQLITE_OK`     | Allow the operation         |
| `SQLITE_DENY`   | Deny and abort with error   |
| `SQLITE_IGNORE` | Silently skip the operation |

#### SqliteAuthorizationActions (node:sqlite compatible)

Action codes passed to `setAuthorizer()` callbacks (34 total):

| Constant              | Description            |
| --------------------- | ---------------------- |
| `SQLITE_CREATE_TABLE` | Create a new table     |
| `SQLITE_INSERT`       | Insert rows            |
| `SQLITE_SELECT`       | Execute SELECT         |
| `SQLITE_UPDATE`       | Update rows            |
| `SQLITE_DELETE`       | Delete rows            |
| `SQLITE_CREATE_INDEX` | Create an index        |
| `SQLITE_DROP_TABLE`   | Drop a table           |
| `SQLITE_PRAGMA`       | Execute PRAGMA         |
| `SQLITE_ATTACH`       | Attach a database      |
| `SQLITE_DETACH`       | Detach a database      |
| ...                   | (24 more action codes) |

### Using Type Categories

The categorized types enable strongly-typed function signatures:

```typescript
import {
  constants,
  SqliteChangesetResolution,
  SqliteChangesetConflictTypes,
} from "@photostructure/sqlite";

function handleConflict(
  conflictType: keyof SqliteChangesetConflictTypes,
): keyof SqliteChangesetResolution {
  if (conflictType === "SQLITE_CHANGESET_DATA") {
    return "SQLITE_CHANGESET_REPLACE";
  }
  return "SQLITE_CHANGESET_OMIT";
}

db.applyChangeset(changeset, {
  onConflict: (type) => constants[handleConflict(type)],
});
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
