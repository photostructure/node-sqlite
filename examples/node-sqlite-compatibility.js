// This example demonstrates drop-in compatibility with node:sqlite API
// To run with Node.js built-in SQLite: node --experimental-sqlite this-file.js
// To run with @photostructure/sqlite: node this-file.js

// Try to use node:sqlite, fall back to @photostructure/sqlite
let sqlite;
try {
  sqlite = require("node:sqlite");
  console.log("Using built-in node:sqlite");
} catch {
  sqlite = require("@photostructure/sqlite");
  console.log("Using @photostructure/sqlite");
}

const { DatabaseSync, constants } = sqlite;

// Create database - API is identical
const db = new DatabaseSync(":memory:", {
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: true,
});

// Create tables
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    title TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Use prepared statements
const insertUser = db.prepare("INSERT INTO users (name) VALUES (?)");
const insertPost = db.prepare(
  "INSERT INTO posts (user_id, title) VALUES (?, ?)",
);

// Insert data
const alice = insertUser.run("Alice");
const bob = insertUser.run("Bob");

insertPost.run(alice.lastInsertRowid, "Hello World");
insertPost.run(alice.lastInsertRowid, "SQLite is awesome");
insertPost.run(bob.lastInsertRowid, "Node.js rocks");

// Query with statement configuration
const stmt = db.prepare(`
  SELECT u.name, p.title 
  FROM posts p 
  JOIN users u ON p.user_id = u.id
  ORDER BY p.id
`);

// Get column information
console.log("\nColumns:", stmt.columns());

// Get all results
console.log("\nAll posts:");
for (const row of stmt.all()) {
  console.log(`- ${row.name}: ${row.title}`);
}

// Use iterator
console.log("\nUsing iterator:");
for (const row of stmt.iterate()) {
  console.log(`- ${row.name}: ${row.title}`);
}

// Clean up
db.close();
console.log("\nDatabase closed successfully");
