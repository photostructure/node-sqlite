import { describe, expect, jest, test } from "@jest/globals";
import { DatabaseSync, type DatabaseSyncInstance } from "../src/index";
import { getTestTimeout } from "./test-utils";

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
      stmt.finalize();

      // Database is still open at this point
      expect(db.isOpen).toBe(true);
    }
    // using block ends here - db should be automatically disposed

    // Database should now be closed
    expect(dbRef!.isOpen).toBe(false);
  });

  test("using statement with StatementSync automatically finalizes statement", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER, name TEXT)");

    let stmtRef: any = null;

    try {
      // Use a block to ensure the using scope is clearly defined
      {
        using stmt = db.prepare("SELECT * FROM test WHERE id = ?");
        stmtRef = stmt;

        // Statement should work initially
        const result = stmt.get(1);
        expect(result).toBeUndefined(); // No rows yet

        // Insert some data and test again
        db.exec("INSERT INTO test (id, name) VALUES (1, 'Alice')");
        const result2 = stmt.get(1);
        expect(result2).toEqual({ id: 1, name: "Alice" });
      }
      // using block ends here - stmt should be automatically finalized

      // Statement should now be finalized and throw on use
      expect(() => stmtRef.get(1)).toThrow();
    } finally {
      db.close();
    }
  });

  test("nested using statements work correctly", () => {
    let dbRef: DatabaseSyncInstance | null = null;
    let stmtRef: any = null;

    {
      using db = new DatabaseSync(":memory:");
      dbRef = db;

      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("INSERT INTO users (name) VALUES ('Alice'), ('Bob')");

      expect(db.isOpen).toBe(true);

      {
        using selectStmt = db.prepare("SELECT * FROM users WHERE name = ?");
        stmtRef = selectStmt;

        const alice = selectStmt.get("Alice");
        expect(alice).toEqual({ id: 1, name: "Alice" });

        const bob = selectStmt.get("Bob");
        expect(bob).toEqual({ id: 2, name: "Bob" });
      }
      // Inner using block ends - selectStmt should be finalized

      // Statement should be finalized
      expect(() => stmtRef.get("Alice")).toThrow();

      // Database should still be open
      expect(db.isOpen).toBe(true);
    }
    // Outer using block ends - db should be closed

    // Database should now be closed
    expect(dbRef!.isOpen).toBe(false);
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

  test("using statement with multiple resources", () => {
    let dbRef: DatabaseSyncInstance | null = null;
    let insertRef: any = null;
    let selectRef: any = null;

    {
      using db = new DatabaseSync(":memory:");

      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

      using insertStmt = db.prepare("INSERT INTO users (name) VALUES (?)");
      using selectStmt = db.prepare("SELECT * FROM users WHERE name = ?");

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
    // All using declarations end here

    // All resources should be cleaned up
    expect(dbRef!.isOpen).toBe(false);
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
      insertStmt.finalize();

      expect(db.isOpen).toBe(true);
    }
    // using block ends after async work

    expect(dbRef!.isOpen).toBe(false);
  });
});
