# API reference

Complete API documentation for @photostructure/sqlite. This package provides 100% compatibility with Node.js's built-in SQLite module.

## Table of contents

- [Module exports](#module-exports)
- [Enhancement utilities](#enhancement-utilities)
- [DatabaseSync](#databasesync)
- [StatementSync](#statementsync)
- [Types and interfaces](#types-and-interfaces)
- [Constants](#constants)
- [Error handling](#error-handling)

## Module exports

The module exports the following items that match `node:sqlite`:

```typescript
import {
  DatabaseSync, // Main database class
  StatementSync, // Prepared statement class
  Session, // Session class for changesets
  backup, // Standalone backup function
  constants, // SQLite constants
} from "@photostructure/sqlite";
```

This package also provides enhancement utilities for (some) better-sqlite3 compatibility:

```typescript
import {
  enhance, // Add .pragma() and .transaction() to any compatible database
  isEnhanced, // Type guard to check if database has enhanced methods
} from "@photostructure/sqlite";
```

### backup()

```typescript
backup(
  sourceDb: DatabaseSync,
  destination: string | Buffer | URL,
  options?: BackupOptions
): Promise<number>
```

Standalone function to create a backup of a database.

**Parameters:**

- `sourceDb` - The database instance to back up
- `destination` - Path to the backup file (string, Buffer, or file: URL)
- `options` - Optional backup configuration

**Returns:** A Promise that resolves to the total number of pages backed up.

```javascript
import { DatabaseSync, backup } from "@photostructure/sqlite";

const db = new DatabaseSync("source.db");

// Create a backup
await backup(db, "backup.db");

// With progress monitoring
await backup(db, "backup.db", {
  rate: 10,
  progress: ({ totalPages, remainingPages }) => {
    console.log(`${totalPages - remainingPages}/${totalPages} pages copied`);
  },
});
```

## Enhancement utilities

These utilities add better-sqlite3-style convenience methods to database instances. They are an extension beyond the `node:sqlite` API.

### enhance()

```typescript
enhance<T extends EnhanceableDatabaseSync>(db: T): EnhancedDatabaseSync<T>
```

Adds `.pragma()` and `.transaction()` methods to any compatible database instance. This enables better-sqlite3-style convenience methods on `node:sqlite` DatabaseSync instances or any object with compatible `exec()`, `prepare()`, and `isTransaction` properties.

The enhancement is done by adding methods directly to the instance, not the prototype, so it won't affect other instances or the original class.

**Parameters:**

- `db` - The database instance to enhance

**Returns:** The same instance with `.pragma()` and `.transaction()` methods guaranteed.

```javascript
import { DatabaseSync, enhance } from "@photostructure/sqlite";

// Enhance a database to add better-sqlite3-style methods
const db = enhance(new DatabaseSync(":memory:"));

// Now you can use .pragma()
db.pragma("journal_mode = WAL");
const cacheSize = db.pragma("cache_size", { simple: true });

// And .transaction()
const insertMany = db.transaction((items) => {
  const stmt = db.prepare("INSERT INTO data (value) VALUES (?)");
  for (const item of items) stmt.run(item);
});
insertMany(["a", "b", "c"]); // All in one transaction
```

**Note:** If the database already has `.pragma()` and `.transaction()` methods (e.g., if you call `enhance()` twice), it returns the database unchanged.

### isEnhanced()

```typescript
isEnhanced(db: EnhanceableDatabaseSync): db is EnhancedDatabaseSync
```

Type guard to check if a database has enhanced methods.

```javascript
import { isEnhanced } from "@photostructure/sqlite";

if (isEnhanced(db)) {
  // TypeScript knows db has .pragma() and .transaction()
  db.pragma("cache_size", { simple: true });
}
```

### Enhanced methods

When a database is enhanced, it gains these methods:

#### pragma()

```typescript
pragma(source: string, options?: PragmaOptions): unknown
```

Executes a PRAGMA statement and returns its result.

**Parameters:**

- `source` - The PRAGMA command (without "PRAGMA" prefix)
- `options` - Optional configuration
  - `simple` - If `true`, returns the first column of the first row instead of an array of row objects

**Returns:** Array of rows, or single value if `simple: true`.

```javascript
// Get all rows
const result = db.pragma("table_info(users)");
// [{ cid: 0, name: 'id', type: 'INTEGER', ... }, ...]

// Get simple value
const journalMode = db.pragma("journal_mode", { simple: true });
// 'wal'

// Set a pragma
db.pragma("cache_size = -16000"); // 16MB cache
```

#### transaction()

```typescript
transaction<F extends (...args: any[]) => any>(fn: F): TransactionFunction<F>
```

Creates a function that always runs inside a transaction. If an exception is thrown, the transaction is rolled back; otherwise, it's committed.

**Parameters:**

- `fn` - The function to wrap in a transaction

**Returns:** A transaction function with `.deferred`, `.immediate`, `.exclusive` variants.

```javascript
const insert = db.prepare("INSERT INTO users (name) VALUES (?)");

// Create a transaction function
const insertMany = db.transaction((names) => {
  for (const name of names) {
    insert.run(name);
  }
});

// Use it - automatically wrapped in BEGIN/COMMIT
insertMany(["Alice", "Bob", "Charlie"]);

// Use different transaction modes
insertMany.immediate(["Dave"]); // BEGIN IMMEDIATE
insertMany.exclusive(["Eve"]); // BEGIN EXCLUSIVE
insertMany.deferred(["Frank"]); // BEGIN DEFERRED (default)
```

**Nested transactions:** When called inside an existing transaction, uses savepoints automatically:

```javascript
const outer = db.transaction(() => {
  insert.run("outer");
  try {
    inner(); // Uses SAVEPOINT
  } catch (e) {
    // Inner rolled back, outer continues
  }
});

const inner = db.transaction(() => {
  insert.run("inner");
  throw new Error("rollback inner only");
});

outer(); // "outer" is committed, "inner" is not
```

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
  open?: boolean; // Open database immediately (default: true)
  readOnly?: boolean; // Open in read-only mode (default: false)
  enableForeignKeyConstraints?: boolean; // Enable foreign keys (default: true)
  enableDoubleQuotedStringLiterals?: boolean; // Allow double-quoted strings (default: false)
  allowExtension?: boolean; // Allow loading extensions (default: false)
  timeout?: number; // Busy timeout in ms (default: 0)
  readBigInts?: boolean; // Return BigInt for INTEGER columns (default: false)
  returnArrays?: boolean; // Return rows as arrays instead of objects (default: false)
  allowBareNamedParameters?: boolean; // Allow $name without : prefix (default: true)
  allowUnknownNamedParameters?: boolean; // Allow unbound named parameters (default: false)
  defensive?: boolean; // Enable defensive mode (default: false)
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

#### [Symbol.dispose](<>)

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
  // Per-statement overrides (Node.js v25+ feature):
  readBigInts?: boolean; // Override database-level BigInt setting
  returnArrays?: boolean; // Override database-level array return setting
  allowBareNamedParameters?: boolean; // Override bare parameter setting
  allowUnknownNamedParameters?: boolean; // Override unknown parameter setting
}
```

> **Note:** The per-statement override options (`readBigInts`, `returnArrays`, `allowBareNamedParameters`, `allowUnknownNamedParameters`) are a **Node.js v25+** feature. On Node.js v24 and earlier, `node:sqlite` silently ignores these options. This library implements them for forward compatibility.

```javascript
const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtWithExpanded = db.prepare("SELECT * FROM users WHERE id = ?", {
  expandedSQL: true,
});

// Per-statement option overrides (Node.js v25+)
const stmtBigInt = db.prepare("SELECT big_id FROM data", { readBigInts: true });
const stmtArrays = db.prepare("SELECT * FROM users", { returnArrays: true });
```

#### function()

```typescript
function(name: string, options: FunctionOptions | Function, func?: Function): void
```

Registers a custom scalar SQL function.

**Options:**

```typescript
interface FunctionOptions {
  deterministic?: boolean; // Same input always gives same output (default: false)
  directOnly?: boolean; // Cannot be used in triggers/views (default: false)
  useBigIntArguments?: boolean; // Receive BigInt instead of number for INTEGER args (default: false)
  varargs?: boolean; // Accept variable number of arguments (default: false)
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
  start: any | (() => any); // Initial value or factory function
  step: (accumulator: any, ...values: any[]) => any; // Called for each row
  result?: (accumulator: any) => any; // Final result transformer (optional)
  inverse?: (accumulator: any, ...values: any[]) => any; // For window functions
  deterministic?: boolean; // Same input always gives same output (default: false)
  directOnly?: boolean; // Cannot be used in triggers/views (default: false)
  useBigIntArguments?: boolean; // Receive BigInt for INTEGER args (default: false)
  varargs?: boolean; // Accept variable number of arguments (default: false)
}
```

```javascript
// Sum aggregate
db.aggregate("custom_sum", {
  start: 0,
  step: (sum, value) => sum + value,
  result: (sum) => sum,
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

// Window function with inverse
db.aggregate("moving_sum", {
  start: 0,
  step: (sum, value) => sum + value,
  inverse: (sum, value) => sum - value, // Remove value leaving window
  result: (sum) => sum,
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
applyChangeset(changeset: Buffer, options?: ChangesetApplyOptions): boolean
```

Applies a changeset to the database. Returns `true` if successful, `false` if aborted.

**Options:**

```typescript
interface ChangesetApplyOptions {
  onConflict?: (conflictType: number) => number; // Returns resolution constant
  filter?: (tableName: string) => boolean; // Filter which tables to apply
}
```

```javascript
const success = db.applyChangeset(changeset, {
  onConflict: (conflictType) => {
    // conflictType is one of: SQLITE_CHANGESET_DATA, SQLITE_CHANGESET_NOTFOUND,
    // SQLITE_CHANGESET_CONFLICT, SQLITE_CHANGESET_CONSTRAINT, SQLITE_CHANGESET_FOREIGN_KEY
    console.log(`Conflict type: ${conflictType}`);
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

#### open()

```typescript
open(): void
```

Opens the database connection. Only needed if `open: false` was passed to the constructor.

```javascript
const db = new DatabaseSync("myapp.db", { open: false });
// ... configure something ...
db.open();
```

#### setAuthorizer()

```typescript
setAuthorizer(callback: AuthorizerCallback | null): void
```

Sets an authorizer callback to control access to database operations. Pass `null` to remove the authorizer.

**Callback signature:**

```typescript
type AuthorizerCallback = (
  actionCode: number,
  arg1: string | null,
  arg2: string | null,
  dbName: string | null,
  triggerOrView: string | null,
) => number; // Returns SQLITE_OK, SQLITE_DENY, or SQLITE_IGNORE
```

```javascript
db.setAuthorizer((action, arg1, arg2, dbName, trigger) => {
  if (action === constants.SQLITE_DROP_TABLE) {
    return constants.SQLITE_DENY; // Prevent dropping tables
  }
  return constants.SQLITE_OK;
});
```

#### enableDefensive()

```typescript
enableDefensive(active: boolean): void
```

Enables or disables defensive mode, which prevents application bugs from corrupting the database.

```javascript
db.enableDefensive(true);
```

#### createTagStore()

```typescript
createTagStore(maxSize?: number): SQLTagStore
```

Creates a SQLTagStore for cached prepared statements using tagged template literals.

```javascript
const sql = db.createTagStore();
sql.run`INSERT INTO users VALUES (${id}, ${name})`;
const user = sql.get`SELECT * FROM users WHERE id = ${id}`;
```

#### serialize()

```typescript
serialize(dbName?: string): Uint8Array
```

Serializes a database to a `Uint8Array`. The serialization is a byte-for-byte copy of the database file as it would exist on disk. `dbName` defaults to `"main"`; pass an attached schema name to serialize that database instead.

```javascript
const buf = db.serialize();
// buf is a Uint8Array containing the SQLite file image
fs.writeFileSync("snapshot.db", buf);
```

See SQLite [`sqlite3_serialize()`](https://sqlite.org/c3ref/serialize.html).

#### deserialize()

```typescript
deserialize(buffer: Uint8Array, options?: { dbName?: string }): void
```

Loads a database from a `Uint8Array`. The current contents of the connection's main database (or `options.dbName`) are replaced. Any open prepared statements are finalized — calling methods on them after `deserialize()` throws `ERR_INVALID_STATE`.

```javascript
const buf = fs.readFileSync("snapshot.db");
db.deserialize(buf);
const rows = db.prepare("SELECT * FROM users").all();
```

See SQLite [`sqlite3_deserialize()`](https://sqlite.org/c3ref/deserialize.html).

### Properties

#### isOpen

```typescript
readonly isOpen: boolean
```

Returns `true` if the database connection is open.

```javascript
console.log(db.isOpen); // true
db.close();
console.log(db.isOpen); // false
```

#### isTransaction

```typescript
readonly isTransaction: boolean
```

Returns `true` if a transaction is currently active.

```javascript
db.exec("BEGIN");
console.log(db.isTransaction); // true
db.exec("COMMIT");
console.log(db.isTransaction); // false
```

#### location()

```typescript
location(dbName?: string): string | null
```

Returns the file path of the database, or `null` for in-memory databases.

```javascript
console.log(db.location()); // "myapp.db"
console.log(db.location("main")); // "myapp.db"
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

#### iterate()

```typescript
iterate(...params: any[]): Iterator<any>
```

Executes the statement and returns an iterator for the results.

```javascript
for (const row of stmt.iterate()) {
  console.log(row);
}
```

#### columns()

```typescript
columns(): ColumnInfo[]
```

Returns metadata about the columns in the result set.

**Returns:**

```typescript
interface ColumnInfo {
  column: string | null; // Original column name
  database: string | null; // Database name
  name: string; // Column alias or name
  table: string | null; // Table name
  type: string | null; // Declared type
}
```

```javascript
const stmt = db.prepare("SELECT id, name FROM users");
console.log(stmt.columns());
// [
//   { column: 'id', database: 'main', name: 'id', table: 'users', type: 'INTEGER' },
//   { column: 'name', database: 'main', name: 'name', table: 'users', type: 'TEXT' }
// ]
```

#### setReadBigInts()

```typescript
setReadBigInts(enabled: boolean): void
```

Configures whether INTEGER columns are returned as BigInt values.

```javascript
stmt.setReadBigInts(true);
const row = stmt.get(1);
console.log(typeof row.id); // "bigint"
```

#### setReturnArrays()

```typescript
setReturnArrays(enabled: boolean): void
```

Configures whether rows are returned as arrays instead of objects.

```javascript
stmt.setReturnArrays(true);
const row = stmt.get(1);
console.log(row); // [1, 'Alice', 30] instead of { id: 1, name: 'Alice', age: 30 }
```

#### setAllowBareNamedParameters()

```typescript
setAllowBareNamedParameters(enabled: boolean): void
```

Configures whether named parameters can be used without the `:` prefix.

```javascript
stmt.setAllowBareNamedParameters(true);
stmt.run({ name: "Alice" }); // Works without :name
```

#### setAllowUnknownNamedParameters()

```typescript
setAllowUnknownNamedParameters(enabled: boolean): void
```

Configures whether unbound named parameters are allowed (they resolve to NULL).

```javascript
stmt.setAllowUnknownNamedParameters(true);
stmt.run({ name: "Alice" }); // Extra params in object are ignored
```

#### close()

```typescript
close(): void
```

Finalizes the prepared statement and releases its resources. Statements are otherwise finalized when garbage collected or when the database is closed; `close()` makes that deterministic.

Throws `ERR_INVALID_STATE` if the statement is already finalized, or if it is currently executing (which is reachable by calling `close()` on the running statement from inside a user-defined function).

```javascript
const stmt = db.prepare("SELECT * FROM users");
const rows = stmt.all();
stmt.close();

stmt.get(); // throws ERR_INVALID_STATE: statement has been finalized
```

#### [Symbol.dispose](<>)

```typescript
[Symbol.dispose](): void
```

Implements the disposable interface for automatic resource management. Unlike `close()`, this is idempotent and never throws.

```javascript
// Automatic cleanup with using statement
{
  using stmt = db.prepare("SELECT * FROM users");
  const rows = stmt.all();
} // stmt finalized automatically when leaving scope
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

## Types and interfaces

### DatabaseSyncOptions

```typescript
interface DatabaseSyncOptions {
  open?: boolean; // Open database immediately (default: true)
  readOnly?: boolean; // Open in read-only mode (default: false)
  enableForeignKeyConstraints?: boolean; // Enable foreign keys (default: true)
  enableDoubleQuotedStringLiterals?: boolean; // Allow double-quoted strings (default: false)
  allowExtension?: boolean; // Allow loading extensions (default: false)
  timeout?: number; // Busy timeout in ms (default: 0)
  readBigInts?: boolean; // Return BigInt for INTEGER columns (default: false)
  returnArrays?: boolean; // Return rows as arrays instead of objects (default: false)
  allowBareNamedParameters?: boolean; // Allow $name without : prefix (default: true)
  allowUnknownNamedParameters?: boolean; // Allow unbound named parameters (default: false)
  defensive?: boolean; // Enable defensive mode (default: false)
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
  deterministic?: boolean; // Same input always gives same output (default: false)
  directOnly?: boolean; // Cannot be used in triggers/views (default: false)
  useBigIntArguments?: boolean; // Receive BigInt for INTEGER args (default: false)
  varargs?: boolean; // Accept variable number of arguments (default: false)
}
```

### AggregateOptions

```typescript
interface AggregateOptions {
  start: any | (() => any); // Initial value or factory function
  step: (accumulator: any, ...values: any[]) => any; // Called for each row
  result?: (accumulator: any) => any; // Final result transformer (optional)
  inverse?: (accumulator: any, ...values: any[]) => any; // For window functions
  deterministic?: boolean; // Same input always gives same output (default: false)
  directOnly?: boolean; // Cannot be used in triggers/views (default: false)
  useBigIntArguments?: boolean; // Receive BigInt for INTEGER args (default: false)
  varargs?: boolean; // Accept variable number of arguments (default: false)
}
```

### BackupOptions

```typescript
interface BackupOptions {
  source?: string; // Source database name (default: 'main')
  target?: string; // Target database name (default: 'main')
  rate?: number; // Pages per iteration (default: 100)
  progress?: (info: { totalPages: number; remainingPages: number }) => void;
}
```

### ColumnInfo

```typescript
interface ColumnInfo {
  column: string | null; // Original column name
  database: string | null; // Database name
  name: string; // Column alias or name
  table: string | null; // Table name
  type: string | null; // Declared type
}
```

### RunResult

```typescript
interface RunResult {
  changes: number | bigint; // Number of rows affected
  lastInsertRowid: number | bigint; // Last inserted row ID
}
```

### PragmaOptions

```typescript
interface PragmaOptions {
  simple?: boolean; // Return first column of first row instead of array
}
```

### TransactionFunction

```typescript
interface TransactionFunction<F extends (...args: any[]) => any> {
  (...args: Parameters<F>): ReturnType<F>;
  deferred: (...args: Parameters<F>) => ReturnType<F>;
  immediate: (...args: Parameters<F>) => ReturnType<F>;
  exclusive: (...args: Parameters<F>) => ReturnType<F>;
}
```

### EnhanceableDatabaseSync

Minimal interface for a database that can be enhanced:

```typescript
interface EnhanceableDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): { all(): unknown[] };
  readonly isTransaction: boolean;
}
```

### EnhancedMethods

Interface for enhanced database methods:

```typescript
interface EnhancedMethods {
  pragma(source: string, options?: PragmaOptions): unknown;
  transaction<F extends (...args: any[]) => any>(fn: F): TransactionFunction<F>;
}
```

### EnhancedDatabaseSync

A database instance that has been enhanced:

```typescript
type EnhancedDatabaseSync<T extends EnhanceableDatabaseSync> = T &
  EnhancedMethods;
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

### TypeScript type categories

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

#### SqliteOpenFlags (extension)

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

### Using type categories

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

## Error handling

All errors include additional information:

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

## See also

- [SQLite C API Reference](./reference/sqlite-api.md) - Low-level C API documentation
- [Working with Data](./working-with-data.md) - Practical examples and patterns
- [Extending SQLite](./extending-sqlite.md) - Custom functions and extensions
