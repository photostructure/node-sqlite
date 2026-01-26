import { describe, expect, jest, test } from "@jest/globals";
import { DatabaseSync, type DatabaseSyncInstance } from "../src";
import { getTestTimeout } from "./test-utils";

/**
 * Tests for the Explicit Resource Management (using syntax) with DatabaseSync.
 *
 * Note: StatementSync does not implement Symbol.dispose in the node:sqlite API.
 * Statements are automatically finalized when the database is closed, so there's
 * no need for explicit statement disposal via the `using` keyword.
 */
describe("Using Syntax (Explicit Resource Management)", () => {
  jest.setTimeout(getTestTimeout());

  test("using statement with DatabaseSync automatically closes database", () => {
    let dbRef: DatabaseSyncInstance | null = null;

    // Use a block to ensure the using scope is clearly defined
    {
      using db = new DatabaseSync(":memory:");
      dbRef = db;

      // Database should be open initially
      expect(db.isOpen).toBe(true);

      // Use the database
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO test (name) VALUES ('test')");

      const stmt = db.prepare("SELECT * FROM test");
      const result = stmt.get();
      expect(result).toEqual({ id: 1, name: "test" });

      // Database is still open at this point
      expect(db.isOpen).toBe(true);
    }
    // using block ends here - db should be automatically disposed

    // Database should now be closed
    expect(dbRef!.isOpen).toBe(false);
  });

  test("nested using with database and manual statement cleanup", () => {
    let dbRef: DatabaseSyncInstance | null = null;
    let stmtRef: any = null;

    {
      using db = new DatabaseSync(":memory:");
      dbRef = db;

      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO users (name) VALUES ('Alice'), ('Bob')");

      expect(db.isOpen).toBe(true);

      // Statements don't support using syntax, but we can still use them normally
      const selectStmt = db.prepare("SELECT * FROM users WHERE name = ?");
      stmtRef = selectStmt;

      const alice = selectStmt.get("Alice");
      expect(alice).toEqual({ id: 1, name: "Alice" });

      const bob = selectStmt.get("Bob");
      expect(bob).toEqual({ id: 2, name: "Bob" });

      // Database should still be open
      expect(db.isOpen).toBe(true);
    }
    // using block ends - db should be closed, which also finalizes statements

    // Database should now be closed
    expect(dbRef!.isOpen).toBe(false);

    // Statement should be finalized (because database was closed)
    expect(() => stmtRef.get("Alice")).toThrow();
  });

  test("using statement handles exceptions properly", () => {
    let dbRef: DatabaseSyncInstance | null = null;

    expect(() => {
      using db = new DatabaseSync(":memory:");
      dbRef = db;

      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      expect(db.isOpen).toBe(true);

      // Throw an exception to test cleanup
      throw new Error("Test exception");
    }).toThrow("Test exception");

    // Database should still be closed despite the exception
    expect(dbRef!.isOpen).toBe(false);
  });

  test("using statement with database and multiple statements", () => {
    let dbRef: DatabaseSyncInstance | null = null;
    let insertRef: any = null;
    let selectRef: any = null;

    {
      using db = new DatabaseSync(":memory:");

      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

      // Create statements normally (they don't need 'using')
      const insertStmt = db.prepare("INSERT INTO users (name) VALUES (?)");
      const selectStmt = db.prepare("SELECT * FROM users WHERE name = ?");

      dbRef = db;
      insertRef = insertStmt;
      selectRef = selectStmt;

      // Use both statements
      insertStmt.run("Charlie");
      const user = selectStmt.get("Charlie");
      expect(user).toEqual({ id: 1, name: "Charlie" });

      // All resources should be active
      expect(db.isOpen).toBe(true);
    }
    // using declaration ends here - db is closed, statements are finalized

    // Database should be closed
    expect(dbRef!.isOpen).toBe(false);

    // Statements should be finalized (because database was closed)
    expect(() => insertRef.run("David")).toThrow();
    expect(() => selectRef.get("Charlie")).toThrow();
  });

  test("using statement with async operations", async () => {
    let dbRef: DatabaseSyncInstance | null = null;

    {
      using db = new DatabaseSync(":memory:");
      dbRef = db;

      db.exec(
        "CREATE TABLE async_test (id INTEGER PRIMARY KEY, timestamp INTEGER)",
      );

      // Simulate some async work while holding the resource
      await new Promise((resolve) => setTimeout(resolve, 10));

      const insertStmt = db.prepare(
        "INSERT INTO async_test (timestamp) VALUES (?)",
      );
      insertStmt.run(Date.now());

      expect(db.isOpen).toBe(true);
    }
    // using block ends after async work

    expect(dbRef!.isOpen).toBe(false);
  });
});
