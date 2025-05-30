import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "../dist/index.js";

console.log("Starting valgrind memory test for node-sqlite...");

function runBasicOperations() {
  // Test in-memory database
  const memDb = new DatabaseSync(":memory:");

  // Create table
  memDb.exec(
    "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value REAL)",
  );

  // Prepare statements
  const insert = memDb.prepare("INSERT INTO test (name, value) VALUES (?, ?)");
  const select = memDb.prepare("SELECT * FROM test WHERE id = ?");
  const selectAll = memDb.prepare("SELECT * FROM test");

  // Insert data
  for (let i = 0; i < 100; i++) {
    insert.run(`name_${i}`, Math.random() * 1000);
  }

  // Query data
  for (let i = 1; i <= 100; i++) {
    const row = select.get(i);
    if (!row) throw new Error(`Row ${i} not found`);
  }

  // Iterate over all rows
  let count = 0;
  for (const row of selectAll.iterate()) {
    count++;
  }
  if (count !== 100) throw new Error(`Expected 100 rows, got ${count}`);

  // Close database
  memDb.close();
}

function runFileOperations() {
  // Create temporary directory
  const tempDir = mkdtempSync(join(tmpdir(), "sqlite-test-"));
  const dbPath = join(tempDir, "test.db");

  try {
    // Test file-based database
    const fileDb = new DatabaseSync(dbPath);

    // Create tables
    fileDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      CREATE INDEX idx_users_email ON users(email);
    `);

    // Prepare statements
    const insertUser = fileDb.prepare(
      "INSERT INTO users (name, email) VALUES (?, ?)",
    );
    const updateUser = fileDb.prepare("UPDATE users SET name = ? WHERE id = ?");
    const deleteUser = fileDb.prepare("DELETE FROM users WHERE id = ?");

    // Perform operations
    for (let i = 0; i < 50; i++) {
      insertUser.run(`User ${i}`, `user${i}@example.com`);
    }

    // Update some users
    for (let i = 1; i <= 10; i++) {
      updateUser.run(`Updated User ${i}`, i);
    }

    // Delete some users
    for (let i = 41; i <= 50; i++) {
      deleteUser.run(i);
    }

    // Close database
    fileDb.close();

    // Reopen to test persistence
    const fileDb2 = new DatabaseSync(dbPath);
    const count = fileDb2.prepare("SELECT COUNT(*) as count FROM users").get();
    if (count.count !== 40)
      throw new Error(`Expected 40 users, got ${count.count}`);
    fileDb2.close();
  } finally {
    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runTransactionOperations() {
  const db = new DatabaseSync(":memory:");

  db.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance REAL)");

  const insert = db.prepare("INSERT INTO accounts (balance) VALUES (?)");
  const update = db.prepare(
    "UPDATE accounts SET balance = balance + ? WHERE id = ?",
  );

  // Insert initial data
  for (let i = 0; i < 10; i++) {
    insert.run(1000);
  }

  // Run transactions
  for (let i = 0; i < 20; i++) {
    db.exec("BEGIN");
    try {
      update.run(-100, 1);
      update.run(100, 2);
      if (i % 2 === 0) {
        db.exec("COMMIT");
      } else {
        db.exec("ROLLBACK");
      }
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  db.close();
}

function runUserDefinedFunctions() {
  const db = new DatabaseSync(":memory:");

  // Create user function
  db.function("double", (x: number) => x * 2);

  // Create aggregate function
  db.aggregate("custom_sum", {
    start: 0,
    step: (acc: number, value: number) => acc + value,
    result: (acc: number) => acc,
  });

  // Test functions
  db.exec("CREATE TABLE numbers (n INTEGER)");
  const insert = db.prepare("INSERT INTO numbers VALUES (?)");
  for (let i = 1; i <= 10; i++) {
    insert.run(i);
  }

  const doubled = db
    .prepare("SELECT double(n) as result FROM numbers WHERE n = 5")
    .get();
  if (doubled.result !== 10)
    throw new Error(`Expected 10, got ${doubled.result}`);

  const sum = db.prepare("SELECT custom_sum(n) as total FROM numbers").get();
  if (sum.total !== 55) throw new Error(`Expected 55, got ${sum.total}`);

  db.close();
}

function runLargeDataOperations() {
  const db = new DatabaseSync(":memory:");

  // Create table
  db.exec("CREATE TABLE large_data (id INTEGER PRIMARY KEY, data TEXT)");

  const insert = db.prepare("INSERT INTO large_data (data) VALUES (?)");
  const select = db.prepare("SELECT data FROM large_data WHERE id = ?");

  // Create large strings
  const largeString = "x".repeat(10000);

  // Insert many large strings
  for (let i = 0; i < 100; i++) {
    insert.run(largeString + i);
  }

  // Query them back
  for (let i = 1; i <= 100; i++) {
    const row = select.get(i);
    if (!row || row.data.length !== 10001) {
      throw new Error(`Invalid data at row ${i}`);
    }
  }

  db.close();
}

// Run all tests
try {
  console.log("Running basic operations...");
  runBasicOperations();

  console.log("Running file operations...");
  runFileOperations();

  console.log("Running transaction operations...");
  runTransactionOperations();

  console.log("Running user-defined functions...");
  runUserDefinedFunctions();

  console.log("Running large data operations...");
  runLargeDataOperations();

  console.log("All tests completed successfully!");
  process.exit(0);
} catch (error) {
  console.error("Test failed:", error);
  process.exit(1);
}
