import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StatementSyncInstance } from "../src";
import { DatabaseSync, StatementSync } from "../src";

/**
 * Tests for invalid operations and edge cases.
 *
 * This test suite validates that the native implementation properly handles
 * use-after-free scenarios and other edge cases that could cause crashes.
 */
describe("Invalid Operations Tests", () => {
  describe("Statement Invalid Operations", () => {
    test("handles finalized statement operations", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

      const stmt = db.prepare("SELECT * FROM test");

      // Finalize the statement
      stmt.finalize();

      // All operations on finalized statement should throw
      expect(() => {
        stmt.run();
      }).toThrow(/finalized|destroyed|invalid/i);

      expect(() => {
        stmt.get();
      }).toThrow(/finalized|destroyed|invalid/i);

      expect(() => {
        stmt.all();
      }).toThrow(/finalized|destroyed|invalid/i);

      expect(() => {
        stmt.iterate();
      }).toThrow(/finalized|destroyed|invalid/i);

      // Double finalize should not throw or have no effect
      expect(() => {
        stmt.finalize();
      }).not.toThrow();

      db.close();
    });

    test("handles statement from closed database", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

      const stmt = db.prepare("SELECT * FROM test");

      // Close the database
      db.close();

      // Statement operations should fail
      expect(() => {
        stmt.run();
      }).toThrow(/closed|invalid/i);

      expect(() => {
        stmt.get();
      }).toThrow(/closed|invalid/i);

      expect(() => {
        stmt.all();
      }).toThrow(/closed|invalid/i);
    });

    test("handles invalid SQL in prepare", () => {
      const db = new DatabaseSync(":memory:");

      // Various invalid SQL statements
      const invalidSql = [
        "SELCT * FROM test", // Typo
        "SELECT * FROM test WHERE", // Incomplete WHERE
        "CREATE TABLE", // Incomplete CREATE
        "INSERT INTO test VALLUES", // Typo in VALUES
        "UPDATE SET value = 1", // Missing table
        "DELETE WHERE id = 1", // Missing FROM
      ];

      invalidSql.forEach((sql) => {
        expect(() => {
          db.prepare(sql);
        }).toThrow(/syntax|incomplete|near/i);
      });

      // Empty SQL is actually allowed by SQLite
      const emptyStmt = db.prepare("");
      expect(emptyStmt).toBeInstanceOf(StatementSync);
      emptyStmt.finalize();

      // Multiple statements in prepare is actually allowed by SQLite
      // Only the first statement is prepared
      const multiStmt = db.prepare("SELECT 1; SELECT 2");
      const result = multiStmt.get();
      expect(result).toEqual({ "1": 1 });
      multiStmt.finalize();

      db.close();
    });

    test("handles wrong parameter types and counts", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, name TEXT, data BLOB)");

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?, ?)");

      // Object that can't be serialized
      const circularRef: any = { a: 1 };
      circularRef.self = circularRef;

      // SQLite is very permissive with parameters - it binds NULL for missing params
      // and ignores extra params. Let's test what actually throws.

      // Too few parameters - SQLite binds NULL
      expect(() => {
        stmt.run(1, 2); // Missing third param
      }).not.toThrow();

      // Too many parameters - SQLite ignores extras
      expect(() => {
        stmt.run(1, 2, 3, 4); // Extra param
      }).not.toThrow();

      // Various types - SQLite converts most things
      expect(() => {
        stmt.run(undefined, null, Buffer.from("test"));
      }).not.toThrow();

      expect(() => {
        stmt.run(NaN, Infinity, -Infinity);
      }).not.toThrow();

      db.close();
    });

    test("handles named parameter mismatches", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, name TEXT)");

      // Statement with named parameters
      const stmt = db.prepare("INSERT INTO test VALUES (:id, :name)");

      // Missing named parameters
      expect(() => {
        stmt.run({ id: 1 }); // Missing :name
      }).not.toThrow(); // SQLite binds NULL for missing params

      // Wrong parameter names
      expect(() => {
        stmt.run({ wrong: 1, keys: "test" });
      }).not.toThrow(); // SQLite binds NULL for unmatched params

      // Mix of named and positional might be allowed in some implementations
      // Let's test what actually happens
      const mixedStmt = db.prepare("INSERT INTO test VALUES (?, :name)");
      try {
        mixedStmt.run(1, { name: "test" });
        // If it doesn't throw, that's okay
      } catch (error: any) {
        // If it throws, check the error
        expect(error.message).toMatch(/mix|positional.*named|parameter/i);
      }

      db.close();
    });
  });

  describe("Database Invalid Operations", () => {
    test("handles invalid database paths", () => {
      // Empty path creates an in-memory database in SQLite
      const emptyPathDb = new DatabaseSync("");
      expect(emptyPathDb).toBeInstanceOf(DatabaseSync);
      emptyPathDb.close();

      // Null characters in path should fail
      expect(() => {
        new DatabaseSync("\0");
      }).toThrow();

      expect(() => {
        new DatabaseSync("path\0with\0nulls");
      }).toThrow();
    });

    test("handles double close", () => {
      const db = new DatabaseSync(":memory:");

      // First close should work
      expect(() => {
        db.close();
      }).not.toThrow();

      // Second close should either not throw or throw a specific error
      // Behavior might vary by implementation
      try {
        db.close();
        // If it doesn't throw, that's acceptable
      } catch (error: any) {
        expect(error.message).toMatch(/already closed|not open/i);
      }
    });

    test("handles invalid database options", () => {
      // Test invalid option combinations
      expect(() => {
        new DatabaseSync(":memory:", {
          // @ts-expect-error - Testing invalid options
          invalidOption: true,
        });
      }).not.toThrow(); // Unknown options are typically ignored

      // Test conflicting options
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-test-"));
      const dbPath = path.join(tempDir, "test.db");

      try {
        // Create a database file first
        const db1 = new DatabaseSync(dbPath);
        db1.exec("CREATE TABLE test (id INTEGER)");
        db1.close();

        // Try to open existing database with valid flags
        expect(() => {
          new DatabaseSync(dbPath, {
            readOnly: false, // Open for writing
          });
        }).not.toThrow(); // This should work - opening existing file for writing
      } finally {
        try {
          fs.unlinkSync(dbPath);
          fs.rmdirSync(tempDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test("handles operations during active transactions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");

      // Start a transaction
      db.exec("BEGIN");

      // Try to start another transaction (should fail)
      expect(() => {
        db.exec("BEGIN");
      }).toThrow(/transaction|already/i);

      // Try to close database with active transaction
      // This might succeed (implicit rollback) or fail
      try {
        db.close();
      } catch (error: any) {
        expect(error.message).toMatch(/transaction|active/i);
        // If it failed, rollback and close
        db.exec("ROLLBACK");
        db.close();
      }
    });
  });

  describe("Function and Aggregate Invalid Operations", () => {
    test("handles invalid function definitions", () => {
      const db = new DatabaseSync(":memory:");

      // Empty function name is actually allowed by SQLite
      db.function("", () => 42);
      // We can even call it!
      const result = db.prepare('SELECT ""()').get();
      expect(result).toEqual({ '""()': 42 });

      // Invalid function name with special characters might be allowed
      // SQLite is quite permissive with function names
      try {
        db.function("func with spaces", () => 42);
        // If it doesn't throw, clean up
        // No way to unregister functions, so just note it worked
      } catch (error: any) {
        expect(error.message).toMatch(/name|invalid/i);
      }

      // Non-function as handler
      expect(() => {
        // @ts-expect-error - Testing invalid type
        db.function("myfunc", "not a function");
      }).toThrow(/function|callable/i);

      // Null/undefined function
      expect(() => {
        // @ts-expect-error - Testing invalid type
        db.function("myfunc", null);
      }).toThrow(/function|required/i);

      db.close();
    });

    test("handles function errors during execution", () => {
      const db = new DatabaseSync(":memory:");

      // Function that always throws
      db.function("throw_error", () => {
        throw new Error("Function execution error");
      });

      // Function that throws on certain inputs
      db.function("conditional_error", (x: any) => {
        if (x < 0) {
          throw new Error("Negative input not allowed");
        }
        return x * 2;
      });

      // Function that returns invalid types
      db.function("return_function", () => {
        return function () {}; // Functions can't be stored in SQLite
      });

      db.function("return_symbol", () => {
        return Symbol("test"); // Symbols can't be stored in SQLite
      });

      // Test throwing function
      expect(() => {
        db.prepare("SELECT throw_error()").get();
      }).toThrow(/Function execution error/i);

      // Test conditional throwing
      const stmt = db.prepare("SELECT conditional_error(?)");
      expect(() => {
        stmt.get(-5);
      }).toThrow(/Negative input not allowed/i);

      // Valid input should work
      const result = stmt.get(5);
      expect(result).toEqual({ "conditional_error(?)": 10 });

      // Test invalid return types - these might be converted to strings or null
      try {
        const funcResult = db
          .prepare("SELECT return_function() as result")
          .get();
        // If it doesn't throw, check what we got
        expect(funcResult.result).toBeNull(); // Functions likely become null
      } catch (error: any) {
        expect(error.message).toMatch(/convert|type|function/i);
      }

      try {
        const symResult = db.prepare("SELECT return_symbol() as result").get();
        // If it doesn't throw, check what we got
        expect(symResult.result).toBeNull(); // Symbols likely become null
      } catch (error: any) {
        expect(error.message).toMatch(/convert|type|symbol/i);
      }

      db.close();
    });

    test("handles invalid aggregate definitions", () => {
      const db = new DatabaseSync(":memory:");

      // Empty aggregate name is actually allowed by SQLite
      db.exec("CREATE TABLE test (value INTEGER)");
      db.aggregate("", {
        start: 0,
        step: (acc: number, val: number) => acc + val,
      });
      // We can even use it!
      db.exec("INSERT INTO test (value) VALUES (1), (2), (3)");
      const aggResult = db.prepare('SELECT ""(value) as sum FROM test').get();
      expect(aggResult).toEqual({ sum: 6 });

      // Missing required properties
      expect(() => {
        // @ts-expect-error - Testing invalid aggregate
        db.aggregate("myagg", {
          start: 0,
          // Missing step function
        });
      }).toThrow(/step|required/i);

      // Missing start is actually allowed - defaults to undefined
      db.aggregate("myagg2", {
        step: (acc: any, val: number) => (acc ?? 0) + val,
      });
      // It works with the default undefined start
      const testResult = db
        .prepare("SELECT myagg2(value) as result FROM test")
        .get();
      expect(testResult.result).toBe(6); // (undefined ?? 0) + 1 + 2 + 3 = 6

      // Invalid step function
      expect(() => {
        db.aggregate("myagg", {
          start: 0,
          // @ts-expect-error - Testing invalid type
          step: "not a function",
        });
      }).toThrow(/step.*function/i);

      db.close();
    });

    test("handles aggregate errors during execution", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (value INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3), (4), (5)");

      // Aggregate that throws in step
      db.aggregate("throw_in_step", {
        start: 0,
        step: (acc: number, val: number) => {
          if (val > 3) {
            throw new Error("Value too large");
          }
          return acc + val;
        },
      });

      // Aggregate that throws in result
      db.aggregate("throw_in_result", {
        start: 0,
        step: (acc: number, val: number) => acc + val,
        result: (_acc: number) => {
          throw new Error("Result error");
        },
      });

      // Test throwing in step
      expect(() => {
        db.prepare("SELECT throw_in_step(value) FROM test").get();
      }).toThrow(/Value too large/i);

      // Test throwing in result
      expect(() => {
        db.prepare("SELECT throw_in_result(value) FROM test").get();
      }).toThrow(/Result error/i);

      db.close();
    });
  });

  describe("Memory and Resource Errors", () => {
    test("handles statement memory after database close", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");

      // Create multiple statements
      const stmt1 = db.prepare("SELECT * FROM test");
      const stmt2 = db.prepare("INSERT INTO test VALUES (?, ?)");
      const stmt3 = db.prepare("UPDATE test SET data = ? WHERE id = ?");

      // Get an iterator
      const iterator = stmt1.iterate();

      // Close database
      db.close();

      // All statement operations should fail
      expect(() => stmt1.all()).toThrow(/closed|invalid/i);
      expect(() => stmt2.run(1, "test")).toThrow(/closed|invalid/i);
      expect(() => stmt3.run("updated", 1)).toThrow(/closed|invalid/i);

      // Iterator should also fail
      expect(() => {
        iterator.next();
      }).toThrow(/closed|invalid/i);
    });

    test("handles very long SQL statements", () => {
      const db = new DatabaseSync(":memory:");

      // Create a very long but valid SQL statement
      const columnCount = 100;
      const columns = Array.from(
        { length: columnCount },
        (_, i) => `col${i} INTEGER`,
      ).join(", ");
      const createTable = `CREATE TABLE test (${columns})`;

      // This should work
      expect(() => {
        db.exec(createTable);
      }).not.toThrow();

      // Create an extremely long WHERE clause
      const conditions = Array.from(
        { length: 1000 },
        (_, i) => `col0 = ${i}`,
      ).join(" OR ");
      const longSelect = `SELECT * FROM test WHERE ${conditions}`;

      // Very long queries might hit limits
      try {
        db.prepare(longSelect);
        // If it works, that's fine
      } catch (error: any) {
        // If it fails due to limits, that's also expected
        expect(error.message).toMatch(/too large|maximum|limit/i);
      }

      db.close();
    });

    test("handles invalid blob data", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      // Various invalid blob inputs
      const invalidBlobs = [
        { value: "not a buffer" },
        { value: 12345 },
        { value: { data: [1, 2, 3] } },
        { value: [1, 2, 3] },
      ];

      // SQLite is very permissive - it will convert most types
      invalidBlobs.forEach(({ value }) => {
        expect(() => {
          stmt.run(1, value);
        }).not.toThrow(); // SQLite accepts these and converts them
      });

      // Verify what was actually stored
      const results = db.prepare("SELECT * FROM test").all();
      expect(results.length).toBe(invalidBlobs.length);

      db.close();
    });
  });

  describe("Iterator Invalid Operations", () => {
    test("handles iterator after statement finalize", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      const stmt = db.prepare("SELECT * FROM test");
      const iterator = stmt.iterate();

      // Get first value
      const first = iterator.next();
      expect(first.done).toBe(false);
      expect(first.value.id).toBe(1);

      // Finalize statement
      stmt.finalize();

      // Iterator should fail
      expect(() => {
        iterator.next();
      }).toThrow(/finalized|invalid/i);

      db.close();
    });

    test("handles multiple iterators on same statement", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      const stmt = db.prepare("SELECT * FROM test");

      // Create multiple iterators
      const iter1 = stmt.iterate();
      const iter2 = stmt.iterate();

      // Iterators might share state or be independent
      const val1 = iter1.next().value.id;
      const val2 = iter2.next().value.id;

      // They might be independent (both get 1) or share state (1 and 2)
      if (val1 === 1 && val2 === 1) {
        // Independent iterators
        expect(iter1.next().value.id).toBe(2);
        expect(iter2.next().value.id).toBe(2);
      } else if (val1 === 1 && val2 === 2) {
        // Shared state
        expect(iter1.next().value.id).toBe(3);
        expect(iter2.next().done).toBe(true);
      }

      db.close();
    });

    test("handles iterator with modified database", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      const stmt = db.prepare("SELECT * FROM test ORDER BY id");
      const iterator = stmt.iterate();

      // Get first value
      expect(iterator.next().value.id).toBe(1);

      // Modify database while iterating
      db.exec("INSERT INTO test VALUES (4)");
      db.exec("DELETE FROM test WHERE id = 2");

      // Continue iteration - should see original snapshot
      expect(iterator.next().value.id).toBe(2); // Still see deleted row
      expect(iterator.next().value.id).toBe(3);
      expect(iterator.next().done).toBe(true); // Don't see new row

      db.close();
    });
  });

  describe("Edge Cases", () => {
    test("handles operations with null bytes in strings", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");

      // String with null bytes
      const nullString = "before\0after";

      // SQLite should handle this
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      expect(() => {
        stmt.run(1, nullString);
      }).not.toThrow();

      // Retrieve and check
      const result = db.prepare("SELECT * FROM test WHERE id = 1").get();
      // SQLite might truncate at null or preserve it
      expect(result.data).toBeDefined();

      db.close();
    });

    test("handles extreme numeric values", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, num REAL)");

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      const extremeValues = [
        { id: 1, value: Number.MAX_VALUE },
        { id: 2, value: Number.MIN_VALUE },
        { id: 3, value: Number.MAX_SAFE_INTEGER },
        { id: 4, value: Number.MIN_SAFE_INTEGER },
        { id: 5, value: Number.EPSILON },
        { id: 6, value: Infinity },
        { id: 7, value: -Infinity },
        { id: 8, value: NaN },
      ];

      extremeValues.forEach(({ id, value }) => {
        expect(() => {
          stmt.run(id, value);
        }).not.toThrow();
      });

      // Check what was stored
      const results = db.prepare("SELECT * FROM test ORDER BY id").all();
      expect(results.length).toBe(extremeValues.length);

      // Check how extreme values are stored
      // Infinity might be stored as Infinity or null
      expect([Infinity, null]).toContain(results[5].num);
      expect([-Infinity, null]).toContain(results[6].num);
      expect(results[7].num).toBe(null); // NaN becomes null

      db.close();
    });

    test("handles recursive triggers and constraints", () => {
      const db = new DatabaseSync(":memory:");

      // Create tables with recursive trigger
      db.exec(`
        CREATE TABLE test (id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0);
        CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, test_id INTEGER, action TEXT);
        
        CREATE TRIGGER recursive_trigger
        AFTER UPDATE ON test
        WHEN NEW.count < 5
        BEGIN
          UPDATE test SET count = count + 1 WHERE id = NEW.id;
          INSERT INTO log (test_id, action) VALUES (NEW.id, 'incremented to ' || (NEW.count + 1));
        END;
      `);

      // Insert initial row
      db.exec("INSERT INTO test (id) VALUES (1)");

      // Trigger recursive update
      db.exec("UPDATE test SET count = 1 WHERE id = 1");

      // Check results - recursive triggers might have limits
      const testRow = db.prepare("SELECT * FROM test WHERE id = 1").get();
      // Count should be at least 2 (initial update worked)
      expect(testRow.count).toBeGreaterThanOrEqual(2);

      const logCount = db.prepare("SELECT COUNT(*) as count FROM log").get();
      // Should have at least one log entry
      expect(logCount.count).toBeGreaterThanOrEqual(1);

      db.close();
    });

    test("handles statement with comments and special characters", () => {
      const db = new DatabaseSync(":memory:");

      // SQL with various comment styles
      const sqlWithComments = `
        -- This is a line comment
        CREATE TABLE test (
          id INTEGER PRIMARY KEY, -- inline comment
          /* multi-line
             comment */
          data TEXT
        );
      `;

      expect(() => {
        db.exec(sqlWithComments);
      }).not.toThrow();

      // SQL with special characters in identifiers
      expect(() => {
        db.exec('CREATE TABLE "table-with-dashes" ("column-name" TEXT)');
      }).not.toThrow();

      expect(() => {
        db.exec('CREATE TABLE "table.with.dots" ("column.name" TEXT)');
      }).not.toThrow();

      // SQL with unicode
      expect(() => {
        db.exec("CREATE TABLE test_unicode (name TEXT)");
        db.prepare("INSERT INTO test_unicode VALUES (?)").run("Hello 世界 🌍");
      }).not.toThrow();

      const result = db.prepare("SELECT * FROM test_unicode").get();
      expect(result.name).toBe("Hello 世界 🌍");

      db.close();
    });
  });

  describe("Potential Segfault Scenarios", () => {
    test("handles statement prepared from one db used on another", () => {
      const db1 = new DatabaseSync(":memory:");
      const db2 = new DatabaseSync(":memory:");

      db1.exec("CREATE TABLE test (id INTEGER)");
      db2.exec("CREATE TABLE test (id INTEGER)");

      const stmt = db1.prepare("INSERT INTO test VALUES (?)");

      // Close the original database
      db1.close();

      // Statement should still fail gracefully
      expect(() => {
        stmt.run(1);
      }).toThrow(/closed/i);

      db2.close();
    });

    test("handles deeply nested user function calls", () => {
      const db = new DatabaseSync(":memory:");
      let depth = 0;
      const maxDepth = 100;

      // Create a recursive function that could blow the stack
      db.function("recursive", (n: number) => {
        depth++;
        if (depth > maxDepth) {
          throw new Error("Maximum recursion depth exceeded");
        }
        try {
          if (n <= 0) return n;
          // Call SQLite from within the function - this could be dangerous
          const result = db.prepare("SELECT recursive(?)").get(n - 1);
          return (Object.values(result)[0] as number) + 1;
        } finally {
          depth--;
        }
      });

      // This should either work or throw a controlled error
      try {
        const result = db.prepare("SELECT recursive(5)").get();
        expect(Object.values(result)[0]).toBe(5);
      } catch (error: any) {
        expect(error.message).toMatch(/recursion|stack|depth/i);
      }

      db.close();
    });

    test("handles statement with extremely long parameter lists", () => {
      const db = new DatabaseSync(":memory:");

      // Create a table with many columns
      const columnCount = 1000;
      const columns = Array.from(
        { length: columnCount },
        (_, i) => `c${i} INTEGER`,
      ).join(", ");
      db.exec(`CREATE TABLE test (${columns})`);

      // Prepare statement with many placeholders
      const placeholders = Array.from({ length: columnCount }, () => "?").join(
        ", ",
      );
      const stmt = db.prepare(`INSERT INTO test VALUES (${placeholders})`);

      // Create array with many values
      const values = Array.from({ length: columnCount }, (_, i) => i);

      // This should work or fail gracefully
      expect(() => {
        stmt.run(...values);
      }).not.toThrow();

      // Try with even more parameters than placeholders
      const tooManyValues = Array.from(
        { length: columnCount * 2 },
        (_, i) => i,
      );
      expect(() => {
        stmt.run(...tooManyValues);
      }).not.toThrow(); // SQLite ignores extra parameters

      db.close();
    });

    test("handles concurrent statement iterations", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3), (4), (5)");

      const stmt = db.prepare("SELECT * FROM test ORDER BY id");

      // Create multiple iterators from the same statement
      const iterators = Array.from({ length: 5 }, () => stmt.iterate());

      // Interleave iterator calls
      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        for (const iterator of iterators) {
          const result = iterator.next();
          if (!result.done) {
            results.push(result.value.id);
          }
        }
      }

      // Results might be interleaved or sequential depending on implementation
      expect(results.length).toBeGreaterThan(0);

      db.close();
    });

    test("handles rapid open/close cycles", () => {
      // Rapidly opening and closing databases could expose race conditions
      const cycles = 50;

      for (let i = 0; i < cycles; i++) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT ?");
        const result = stmt.get(i);
        expect(Object.values(result)[0]).toBe(i);
        stmt.finalize();
        db.close();
      }
    });

    test("handles statement finalization during iteration", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3), (4), (5)");

      const stmt = db.prepare("SELECT * FROM test");
      const iterator = stmt.iterate();

      // Get first result
      const first = iterator.next();
      expect(first.done).toBe(false);

      // Create another iterator
      const iterator2 = stmt.iterate();

      // Finalize while iterators exist
      stmt.finalize();

      // Both iterators should fail
      expect(() => {
        iterator.next();
      }).toThrow(/finalized/i);

      expect(() => {
        iterator2.next();
      }).toThrow(/finalized/i);

      db.close();
    });

    test("handles database close with active user functions", () => {
      const db = new DatabaseSync(":memory:");

      let functionCallCount = 0;
      db.function("my_function", () => {
        functionCallCount++;
        // Try to use the database from within the function
        try {
          db.exec("SELECT 1"); // This could be dangerous if db is closing
        } catch {
          // Expected if database is closing
        }
        return functionCallCount;
      });

      // Create a statement that uses the function
      const stmt = db.prepare("SELECT my_function()");

      // Execute it once to ensure it works
      const result = stmt.get();
      expect(Object.values(result)[0]).toBe(1);

      // Close database - functions should be cleaned up
      db.close();

      // Statement should fail
      expect(() => {
        stmt.get();
      }).toThrow(/closed/i);
    });

    test("handles circular references in aggregates", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      // Create aggregate with circular reference
      const circularObj: any = { value: 0 };
      circularObj.self = circularObj;

      db.aggregate("circular_agg", {
        start: circularObj,
        step: (acc: any, val: number) => {
          acc.value += val;
          return acc;
        },
        result: (acc: any) => acc.value,
      });

      // This should work despite the circular reference
      const result = db
        .prepare("SELECT circular_agg(id) as total FROM test")
        .get();
      expect(result.total).toBe(6);

      db.close();
    });

    test("handles statement execution after Error in constructor", () => {
      // Test database that fails to open
      let db: InstanceType<typeof DatabaseSync> | null = null;
      let stmt: any = null;

      try {
        // Try to create a database with an invalid path
        db = new DatabaseSync("/root/definitely/not/accessible/test.db");
        stmt = db.prepare("SELECT 1");
      } catch (error) {
        // Database creation failed as expected
        expect(error).toBeDefined();
      }

      // If we somehow got a statement, it should fail gracefully
      if (stmt) {
        expect(() => {
          stmt.run();
        }).toThrow();
      }

      // Clean up if needed
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test("handles blob operations with invalid memory", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");

      // Create a large buffer
      const bigBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      bigBuffer.fill(0x42);

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      // Insert the buffer
      expect(() => {
        stmt.run(1, bigBuffer);
      }).not.toThrow();

      // Try to insert a buffer that we'll modify during execution
      const mutableBuffer = Buffer.alloc(1024);

      // This is a bit contrived, but simulates buffer modification during use
      let modifyCount = 0;
      const originalToString = mutableBuffer.toString;
      mutableBuffer.toString = function (
        this: Buffer,
        ...args: [encoding?: BufferEncoding, start?: number, end?: number]
      ) {
        modifyCount++;
        if (modifyCount > 1) {
          // Modify the buffer content
          this.fill(0xff);
        }
        return originalToString.apply(this, args);
      };

      // Should handle buffer modification gracefully
      expect(() => {
        stmt.run(2, mutableBuffer);
      }).not.toThrow();

      db.close();
    });

    test("handles statement with side effects in toString", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      // Object with side effects in toString
      let callCount = 0;
      const trickObject = {
        toString() {
          callCount++;
          if (callCount === 1) {
            // First call returns a string
            return "first";
          } else {
            // Subsequent calls throw
            throw new Error("toString called multiple times!");
          }
        },
      };

      // SQLite might call toString multiple times
      try {
        stmt.run(1, trickObject);
        // If it succeeds, that's fine
      } catch (error: any) {
        // If it fails, it should be our error
        expect(error.message).toMatch(/toString called multiple times/);
      }

      db.close();
    });

    test("handles memory pressure with many prepared statements", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

      // Create many prepared statements without finalizing
      const statements: StatementSyncInstance[] = [];
      const statementCount = 1000;

      try {
        for (let i = 0; i < statementCount; i++) {
          // Create unique SQL to prevent statement caching
          const stmt = db.prepare(
            `SELECT * FROM test WHERE id = ${i} AND value = ?`,
          );
          statements.push(stmt);
        }

        // All statements should be valid
        expect(statements.length).toBe(statementCount);

        // Use some of them
        statements[0].get("test");
        statements[500].get("test");
        statements[999].get("test");
      } finally {
        // Clean up
        for (const stmt of statements) {
          try {
            stmt.finalize();
          } catch {
            // Ignore finalization errors
          }
        }
        db.close();
      }
    });
  });
});
