#!/usr/bin/env node

/**
 * Valgrind test runner for @photostructure/sqlite
 *
 * This script exercises the native module's core functionality to detect
 * memory leaks. It's designed to be run under valgrind via npm run test:valgrind
 *
 * The test performs multiple iterations of each operation to help detect
 * memory leaks that might only appear after repeated use.
 */

import { DatabaseSync } from "../dist/index.mjs";

async function runTests() {
  console.log("Starting valgrind memory leak tests...");

  // Test 1: Exercise basic database operations multiple times
  console.log("Test 1: Database creation and basic operations");
  for (let i = 0; i < 10; i++) {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const insert = db.prepare("INSERT INTO test (name) VALUES (?)");
    const select = db.prepare("SELECT * FROM test WHERE id = ?");

    // Insert and query some data
    const result = insert.run(`test_${i}`);
    const row = select.get(result.lastInsertRowid);

    if (!row || row.name !== `test_${i}`) {
      throw new Error(`Unexpected result at iteration ${i}`);
    }

    db.close();
    if (i % 5 === 0) console.log(`  Iteration ${i + 1}/10`);
  }

  // Test 2: Exercise prepared statements with parameter binding
  console.log("Test 2: Prepared statement parameter binding");
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE params_test (id INTEGER, text_val TEXT, real_val REAL, blob_val BLOB)",
  );

  const stmt = db.prepare(
    "INSERT INTO params_test (id, text_val, real_val, blob_val) VALUES (?, ?, ?, ?)",
  );

  for (let i = 0; i < 10; i++) {
    const textVal = `string_${i}`;
    const realVal = i * 3.14;
    const blobVal = Buffer.from(`blob_data_${i}`);

    stmt.run(i, textVal, realVal, blobVal);

    if (i % 5 === 0) console.log(`  Iteration ${i + 1}/10`);
  }

  db.close();

  // Test 3: Exercise error conditions
  console.log("Test 3: Error handling");
  for (let i = 0; i < 5; i++) {
    try {
      const db = new DatabaseSync("/nonexistent/path/database.db");
      db.close();
    } catch {
      // Expected - testing error paths
    }

    try {
      const db = new DatabaseSync(":memory:");
      db.exec("INVALID SQL SYNTAX");
      db.close();
    } catch {
      // Expected - testing error paths
    }

    if (i % 3 === 0) console.log(`  Iteration ${i + 1}/5`);
  }

  // Test 4: Exercise user-defined functions if available
  console.log("Test 4: User-defined functions");
  try {
    const db = new DatabaseSync(":memory:");

    // Simple scalar function
    db.function("test_func", (x) => x * 2);

    for (let i = 0; i < 10; i++) {
      const result = db.prepare("SELECT test_func(?) as result").get(i);
      if (result.result !== i * 2) {
        throw new Error(`Unexpected function result at iteration ${i}`);
      }
    }

    db.close();
    console.log("  User-defined functions test completed");
  } catch (e) {
    console.log("  User-defined functions not available or error:", e.message);
  }

  // Test 5: Exercise large result sets
  console.log("Test 5: Large result sets");
  const db2 = new DatabaseSync(":memory:");
  db2.exec("CREATE TABLE large_test (id INTEGER PRIMARY KEY, data TEXT)");

  const insertLarge = db2.prepare("INSERT INTO large_test (data) VALUES (?)");

  // Insert 1000 rows
  for (let i = 0; i < 1000; i++) {
    insertLarge.run(`data_${i}`);
  }

  // Query all rows
  const allRows = db2.prepare("SELECT * FROM large_test").all();
  if (allRows.length !== 1000) {
    throw new Error(`Expected 1000 rows, got ${allRows.length}`);
  }

  db2.close();
  console.log("  Large result set test completed");

  console.log("Valgrind tests completed");
}

// Run tests and exit
runTests()
  .then(() => {
    console.log("All tests completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });
