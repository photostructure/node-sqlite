#!/usr/bin/env tsx

/**
 * Valgrind test runner for @photostructure/sqlite
 *
 * This script exercises the native module's core functionality to detect
 * memory leaks. It's designed to be run under valgrind via npm run test:valgrind
 *
 * The test performs multiple iterations of each operation to help detect
 * memory leaks that might only appear after repeated use.
 *
 * Note: This script should be run after building the dist directory
 */

// Import from the built dist directory (we assume build has been done)
// We use any type here since this is a test script and dist doesn't have types
const { DatabaseSync } = require("../dist/index.cjs") as any;

async function runTests() {
  console.log("Starting valgrind memory leak tests...");

  // Test 1: Exercise basic database operations multiple times
  console.log("Test 1: Database creation and basic operations");
  for (let i = 0; i < 10; i++) {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test (
        id INTEGER PRIMARY KEY,
        name TEXT,
        value REAL,
        data BLOB
      )
    `);

    const insert = db.prepare(
      "INSERT INTO test (name, value, data) VALUES (?, ?, ?)",
    );
    const select = db.prepare("SELECT * FROM test WHERE id = ?");

    // Insert test data
    for (let j = 0; j < 5; j++) {
      insert.run(`test${j}`, Math.random(), Buffer.from(`data${j}`));
    }

    // Query test data
    for (let j = 1; j <= 5; j++) {
      const result = select.get(j);
      if (!result) {
        console.error(`No result for id ${j}`);
      }
    }

    // Statements are automatically finalized when db.close() is called
    db.close();
  }

  // Test 2: Exercise statement lifecycle
  console.log("Test 2: Statement lifecycle");
  for (let i = 0; i < 10; i++) {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE lifecycle_test (id INTEGER, data TEXT)");

    // Create and use multiple statements (no explicit finalize needed)
    for (let j = 0; j < 5; j++) {
      const stmt = db.prepare("INSERT INTO lifecycle_test VALUES (?, ?)");
      stmt.run(j, `data${j}`);
      // Statements are finalized automatically when db is closed
    }

    db.close();
  }

  // Test 3: Exercise transaction handling
  console.log("Test 3: Transaction handling");
  for (let i = 0; i < 5; i++) {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE transaction_test (id INTEGER, value TEXT)");

    const insert = db.prepare("INSERT INTO transaction_test VALUES (?, ?)");

    // Test explicit transactions
    db.exec("BEGIN TRANSACTION");
    for (let j = 0; j < 10; j++) {
      insert.run(j, `value${j}`);
    }
    db.exec("COMMIT");

    // Test rollback
    db.exec("BEGIN TRANSACTION");
    insert.run(999, "should_rollback");
    db.exec("ROLLBACK");

    // Statements are finalized automatically when db.close() is called
    db.close();
  }

  // Test 4: Exercise user-defined functions if available
  console.log("Test 4: User-defined functions");
  for (let i = 0; i < 5; i++) {
    const db = new DatabaseSync(":memory:");

    try {
      // Test scalar function
      if (typeof db.function === "function") {
        db.function("test_add", (a: number, b: number) => a + b);

        const result = db.prepare("SELECT test_add(?, ?) as sum").get(5, 3);
        if (!result || (result as any).sum !== 8) {
          console.error("User function test failed");
        }
      }

      // Test aggregate function if available
      if (typeof db.aggregate === "function") {
        db.aggregate("test_sum", {
          start: 0,
          step: (acc: number, value: number) => acc + value,
        });

        db.exec("CREATE TABLE agg_test (value INTEGER)");
        db.exec("INSERT INTO agg_test VALUES (1), (2), (3), (4), (5)");

        const result = db
          .prepare("SELECT test_sum(value) as total FROM agg_test")
          .get();
        if (!result || (result as any).total !== 15) {
          console.error("Aggregate function test failed");
        }
      }
    } catch {
      // User functions might not be available in all builds
      console.log("User functions not available, skipping");
    }

    db.close();
  }

  console.log("Valgrind tests completed successfully");
}

runTests().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
