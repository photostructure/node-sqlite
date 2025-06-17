# Working with Data

This guide covers common data operations using @photostructure/sqlite, including prepared statements, parameter binding, transactions, and data type handling.

## Prepared Statements

Prepared statements are the recommended way to execute SQL queries. They provide:

- Protection against SQL injection
- Better performance for repeated queries
- Type-safe parameter binding

### Basic Usage

```javascript
import { DatabaseSync } from "@photostructure/sqlite";

const db = new DatabaseSync("myapp.db");

// Prepare a statement
const stmt = db.prepare("SELECT * FROM users WHERE age > ?");

// Execute it multiple times with different parameters
const adults = stmt.all(18);
const seniors = stmt.all(65);

// Always finalize statements when done (or let them be garbage collected)
stmt.finalize();
db.close();
```

### Statement Methods

```javascript
// .run() - Execute statement, returns info about changes
const insert = db.prepare("INSERT INTO users (name, age) VALUES (?, ?)");
const info = insert.run("Alice", 30);
console.log(info.changes); // Number of rows affected
console.log(info.lastInsertRowid); // ID of inserted row

// .get() - Return first row
const select = db.prepare("SELECT * FROM users WHERE id = ?");
const user = select.get(1);
console.log(user); // { id: 1, name: 'Alice', age: 30 }

// .all() - Return all rows as array
const selectAll = db.prepare("SELECT * FROM users WHERE age > ?");
const users = selectAll.all(25);
console.log(users); // Array of user objects

// .iterate() - Return iterator for memory-efficient row processing
const iter = db.prepare("SELECT * FROM users");
for (const user of iter) {
  console.log(user);
  // Process one row at a time
}
```

## Parameter Binding

### Positional Parameters (?)

```javascript
const stmt = db.prepare(
  "INSERT INTO users (name, age, email) VALUES (?, ?, ?)",
);
stmt.run("Bob", 25, "bob@example.com");
```

### Named Parameters

```javascript
const stmt = db.prepare(
  "INSERT INTO users (name, age, email) VALUES ($name, $age, $email)",
);
stmt.run({ $name: "Charlie", $age: 35, $email: "charlie@example.com" });

// Also works with : prefix
const stmt2 = db.prepare(
  "INSERT INTO users (name, age, email) VALUES (:name, :age, :email)",
);
stmt2.run({ name: "David", age: 40, email: "david@example.com" });
```

### Anonymous Parameters

```javascript
// Enable anonymous parameters for a specific statement
const stmt = db.prepare("INSERT INTO logs (message) VALUES (?)", {
  anonymousParameters: true,
});

// Now you can bind any number of parameters
stmt.run("Error", "Details", "Stack trace"); // All concatenated
```

## Data Types

SQLite supports several data types, and this library handles JavaScript type conversions automatically:

### Type Mapping

| SQLite Type | JavaScript Type  | Notes                                        |
| ----------- | ---------------- | -------------------------------------------- |
| NULL        | null             |                                              |
| INTEGER     | number or bigint | BigInt for values outside safe integer range |
| REAL        | number           |                                              |
| TEXT        | string           |                                              |
| BLOB        | Buffer           | Node.js Buffer objects                       |

### Working with Different Types

```javascript
const db = new DatabaseSync(":memory:");

// Create table with various types
db.exec(`
  CREATE TABLE data_types (
    id INTEGER PRIMARY KEY,
    count INTEGER,
    price REAL,
    name TEXT,
    data BLOB,
    created_at TEXT
  )
`);

const insert = db.prepare(`
  INSERT INTO data_types (count, price, name, data, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

// Insert different types
insert.run(
  42, // INTEGER
  19.99, // REAL
  "Product", // TEXT
  Buffer.from("binary data"), // BLOB
  new Date().toISOString(), // TEXT (store dates as ISO strings)
);

// Retrieve and check types
const row = db.prepare("SELECT * FROM data_types WHERE id = ?").get(1);
console.log(typeof row.count); // 'number'
console.log(typeof row.price); // 'number'
console.log(typeof row.name); // 'string'
console.log(row.data); // <Buffer ...>
```

### BigInt Support

```javascript
// Large integers automatically returned as BigInt
db.exec("CREATE TABLE big_numbers (value INTEGER)");
const bigInsert = db.prepare("INSERT INTO big_numbers VALUES (?)");
bigInsert.run(9007199254740993n); // Using BigInt literal

const result = db.prepare("SELECT value FROM big_numbers").get();
console.log(result.value); // 9007199254740993n
console.log(typeof result.value); // 'bigint'
```

## Transactions

Transactions ensure data consistency by grouping multiple operations into a single atomic unit.

### Basic Transaction

```javascript
const db = new DatabaseSync("bank.db");

try {
  db.exec("BEGIN TRANSACTION");

  const withdraw = db.prepare(
    "UPDATE accounts SET balance = balance - ? WHERE id = ?",
  );
  const deposit = db.prepare(
    "UPDATE accounts SET balance = balance + ? WHERE id = ?",
  );

  // Transfer $100 from account 1 to account 2
  withdraw.run(100, 1);
  deposit.run(100, 2);

  db.exec("COMMIT");
  console.log("Transfer successful");
} catch (error) {
  db.exec("ROLLBACK");
  console.error("Transfer failed:", error.message);
} finally {
  db.close();
}
```

### Transaction Types

```javascript
// Default transaction
db.exec("BEGIN");
// or
db.exec("BEGIN TRANSACTION");

// Deferred transaction (default)
db.exec("BEGIN DEFERRED");

// Immediate transaction (acquires RESERVED lock)
db.exec("BEGIN IMMEDIATE");

// Exclusive transaction (acquires EXCLUSIVE lock)
db.exec("BEGIN EXCLUSIVE");
```

### Savepoints

```javascript
db.exec("BEGIN");
try {
  db.exec('INSERT INTO users (name) VALUES ("Alice")');

  // Create savepoint
  db.exec("SAVEPOINT sp1");

  try {
    db.exec('INSERT INTO users (name) VALUES ("Bob")');
    // This might fail
    db.exec("INSERT INTO users (name) VALUES (NULL)"); // Error if NOT NULL
  } catch (error) {
    // Rollback to savepoint
    db.exec("ROLLBACK TO sp1");
    console.log("Rolled back to savepoint");
  }

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
}
```

## Error Handling

SQLite operations can throw errors for various reasons. This package provides enhanced error information to help with debugging and error recovery.

### Enhanced Error Properties

When an SQLite error occurs, the thrown `Error` object includes additional properties:

#### Always Present

- **`sqliteCode`** (number): The primary SQLite error code (e.g., `14` for `SQLITE_CANTOPEN`)
- **`sqliteExtendedCode`** (number): The extended error code providing more specific information (e.g., `2067` for `SQLITE_CONSTRAINT_UNIQUE`)
- **`code`** (string): The SQLite error constant name (e.g., `"SQLITE_CANTOPEN"`, `"SQLITE_CONSTRAINT"`)
- **`sqliteErrorString`** (string): Human-readable description of the error (e.g., `"unable to open database file"`)

#### Optional

- **`systemErrno`** (number): The underlying OS error number for I/O operations. Only present when the error involves file system operations.

### Example Error Handling

```javascript
import { DatabaseSync } from '@photostructure/sqlite';

try {
  const db = new DatabaseSync('/nonexistent/path/database.db', { readOnly: true });
} catch (error) {
  console.log(error.message);          // "Failed to open database: unable to open database file"
  console.log(error.sqliteCode);       // 14
  console.log(error.sqliteExtendedCode); // 14
  console.log(error.code);             // "SQLITE_CANTOPEN"
  console.log(error.sqliteErrorString); // "unable to open database file"
  console.log(error.systemErrno);      // 2 (ENOENT on Unix)
}

// Handling constraint violations
try {
  const stmt = db.prepare("INSERT INTO users (id, email) VALUES (?, ?)");
  stmt.run(1, "duplicate@email.com"); // This email already exists
} catch (error) {
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    console.log("Email already exists:", error.sqliteErrorString);
  }
}
```

### Common Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1 | `SQLITE_ERROR` | Generic error |
| 5 | `SQLITE_BUSY` | Database is locked |
| 8 | `SQLITE_READONLY` | Attempt to write a readonly database |
| 14 | `SQLITE_CANTOPEN` | Unable to open database file |
| 19 | `SQLITE_CONSTRAINT` | Constraint violation |
| 2067 | Extended: `SQLITE_CONSTRAINT_UNIQUE` | UNIQUE constraint failed |
| 1555 | Extended: `SQLITE_CONSTRAINT_PRIMARYKEY` | PRIMARY KEY constraint failed |

## NULL Handling

```javascript
// Inserting NULL values
const stmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
stmt.run("Alice", null); // email will be NULL

// Checking for NULL in queries
const nullCheck = db.prepare("SELECT * FROM users WHERE email IS NULL");
const usersWithoutEmail = nullCheck.all();

// COALESCE to provide default values
const withDefaults = db.prepare(
  'SELECT name, COALESCE(email, "no-email@example.com") as email FROM users',
);
```

## Working with Dates

SQLite doesn't have a native date type, so dates are typically stored as TEXT, INTEGER, or REAL.

```javascript
// Store as ISO string (TEXT)
const insertDate = db.prepare("INSERT INTO events (name, date) VALUES (?, ?)");
insertDate.run("Meeting", new Date().toISOString());

// Store as Unix timestamp (INTEGER)
const insertTimestamp = db.prepare(
  "INSERT INTO events (name, timestamp) VALUES (?, ?)",
);
insertTimestamp.run("Meeting", Math.floor(Date.now() / 1000));

// Query and parse dates
const events = db.prepare("SELECT * FROM events").all();
events.forEach((event) => {
  if (event.date) {
    const date = new Date(event.date);
    console.log(`${event.name} at ${date.toLocaleString()}`);
  }
});

// Use SQLite date functions
const recent = db
  .prepare(
    `
  SELECT * FROM events 
  WHERE date > datetime('now', '-7 days')
`,
  )
  .all();
```

## Error Handling

```javascript
try {
  const stmt = db.prepare("SELECT * FROM nonexistent_table");
  stmt.all();
} catch (error) {
  console.error("SQLite error:", error.message);
  console.error("Error code:", error.code);
  console.error("SQLite code:", error.sqliteCode);
  console.error("Extended code:", error.sqliteExtendedCode);
}
```

## Best Practices

1. **Always use prepared statements** for queries with parameters
2. **Close databases** when done to free resources
3. **Use transactions** for multiple related operations
4. **Handle errors** appropriately
5. **Validate input** before binding to statements
6. **Use appropriate data types** for your use case

## Next Steps

- [Extending SQLite](./extending-sqlite.md) - Learn about custom functions and extensions
- [Advanced Patterns](./advanced-patterns.md) - Worker threads, backups, and more
- [API Reference](./api-reference.md) - Complete API documentation
