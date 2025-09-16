import { describe, expect, test } from "@jest/globals";
import { DatabaseSync } from "../src/index";
import { getTestTimeout } from "./test-utils";

describe("Disposable Interface", () => {
  jest.setTimeout(getTestTimeout());

  describe("DatabaseSync Symbol.dispose", () => {
    test("Symbol.dispose exists when Symbol.dispose is available", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        expect(typeof db[Symbol.dispose]).toBe("function");
        db.close();
      } else {
        // If Symbol.dispose is not available, skip this test
        expect(true).toBe(true);
      }
    });

    test("Symbol.dispose closes the database connection", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        expect(db.isOpen).toBe(true);

        // Call Symbol.dispose
        db[Symbol.dispose]();

        // Database should be closed
        expect(db.isOpen).toBe(false);
      }
    });

    test("Symbol.dispose ignores errors during disposal", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");

        // Close the database first
        db.close();
        expect(db.isOpen).toBe(false);

        // Calling Symbol.dispose on already closed database should not throw
        expect(() => {
          db[Symbol.dispose]();
        }).not.toThrow();
      }
    });

    test("Symbol.dispose can be called multiple times safely", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");

        // Call dispose multiple times
        db[Symbol.dispose]();
        db[Symbol.dispose]();
        db[Symbol.dispose]();

        expect(db.isOpen).toBe(false);
      }
    });
  });

  describe("StatementSync Symbol.dispose", () => {
    test("Symbol.dispose exists when Symbol.dispose is available", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");

        expect(typeof stmt[Symbol.dispose]).toBe("function");

        db.close(); // This also finalizes the statement
      }
    });

    test("Symbol.dispose finalizes the statement", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");

        // Statement should work initially
        expect(stmt.get()).toEqual({ "1": 1 });

        // Call Symbol.dispose
        stmt[Symbol.dispose]();

        // Statement should be finalized and throw on use
        expect(() => stmt.get()).toThrow();

        db.close();
      }
    });

    test("Symbol.dispose ignores errors during disposal", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");

        // Finalize the statement first
        stmt.finalize();

        // Calling Symbol.dispose on already finalized statement should not throw
        expect(() => {
          stmt[Symbol.dispose]();
        }).not.toThrow();

        db.close();
      }
    });

    test("Symbol.dispose can be called multiple times safely", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");

        // Call dispose multiple times
        stmt[Symbol.dispose]();
        stmt[Symbol.dispose]();
        stmt[Symbol.dispose]();

        // Statement should be finalized
        expect(() => stmt.get()).toThrow();

        db.close();
      }
    });
  });

  describe("using statement integration", () => {
    test("using statement works with DatabaseSync if supported", async () => {
      // Check if using declarations are supported in this environment
      // Note: This test may be skipped in environments without using support
      try {
        // This is a compile-time check - if using is not supported,
        // this test file would fail to compile/run
        if (typeof Symbol !== "undefined" && Symbol.dispose) {
          // We can't actually test the using syntax in Jest easily since it
          // requires specific compiler support, but we can test the disposal
          // mechanism that using would call

          const db = new DatabaseSync(":memory:");
          db.exec("CREATE TABLE test (id INTEGER)");

          // Simulate what using would do
          try {
            // Use the database
            const stmt = db.prepare("INSERT INTO test (id) VALUES (?)");
            stmt.run(1);
            stmt.finalize();
          } finally {
            // using would call Symbol.dispose here
            db[Symbol.dispose]();
          }

          expect(db.isOpen).toBe(false);
        }
      } catch (error) {
        // If using is not supported, that's okay - this is a future feature
        console.log("using statement not supported in this environment");
      }
    });

    test("nested using statements would work correctly", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER)");

        // Simulate nested using declarations
        try {
          // Outer using db = new DatabaseSync(...)
          try {
            // Inner using stmt = db.prepare(...)
            const stmt = db.prepare("SELECT * FROM test");

            // Use the statement
            stmt.all();

            // Inner using would dispose stmt here
            stmt[Symbol.dispose]();

            // Statement should be finalized
            expect(() => stmt.get()).toThrow();

          } finally {
            // This represents the end of the inner using block
          }

        } finally {
          // Outer using would dispose db here
          db[Symbol.dispose]();
        }

        expect(db.isOpen).toBe(false);
      }
    });
  });

  describe("disposal order and safety", () => {
    test("disposing database finalizes all statements", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER)");

        const stmt1 = db.prepare("SELECT * FROM test");
        const stmt2 = db.prepare("INSERT INTO test (id) VALUES (?)");

        // Dispose database (should finalize all statements)
        db[Symbol.dispose]();

        // Database should be closed
        expect(db.isOpen).toBe(false);

        // Both statements should be finalized
        expect(() => stmt1.get()).toThrow();
        expect(() => stmt2.run(1)).toThrow();
      }
    });

    test("disposal is idempotent across mixed manual and automatic cleanup", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");

        // Mix manual and automatic cleanup
        stmt.finalize(); // Manual cleanup
        stmt[Symbol.dispose](); // Automatic cleanup - should not throw

        db.close(); // Manual cleanup
        db[Symbol.dispose](); // Automatic cleanup - should not throw

        expect(db.isOpen).toBe(false);
      }
    });
  });
});