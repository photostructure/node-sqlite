import { DatabaseSync } from "../dist/index.mjs";

console.log("Starting simple valgrind test...");

// Test basic operations
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

const insert = db.prepare("INSERT INTO test (name) VALUES (?)");
const select = db.prepare("SELECT * FROM test WHERE id = ?");

// Insert some data
for (let i = 0; i < 10; i++) {
  insert.run(`name_${i}`);
}

// Query some data
for (let i = 1; i <= 10; i++) {
  const row = select.get(i);
  if (!row) throw new Error(`Row ${i} not found`);
}

// Clean up
db.close();

console.log("Simple test completed successfully!");
