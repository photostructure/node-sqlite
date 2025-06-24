import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { constants, DatabaseSync } from "../dist/index.cjs";

describe("Session callback error handling", () => {
  let sourceDb: InstanceType<typeof DatabaseSync>;
  let targetDb: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    sourceDb = new DatabaseSync(":memory:");
    targetDb = new DatabaseSync(":memory:");

    // Create test table in both databases
    const schema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      )
    `;
    sourceDb.exec(schema);
    targetDb.exec(schema);
  });

  afterEach(() => {
    sourceDb.close();
    targetDb.close();
  });

  describe("onConflict callback error handling", () => {
    test("should handle string errors thrown in onConflict callback", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing onConflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          throw "Conflict error!";
        },
      });

      // Should abort the changeset
      expect(result).toBe(false);

      // Original data should remain unchanged
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user.name).toBe("Bob");
    });

    test("should handle Error objects thrown in onConflict callback", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing onConflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          throw new Error("Custom conflict error");
        },
      });

      // Should abort the changeset
      expect(result).toBe(false);

      // Original data should remain unchanged
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user.name).toBe("Bob");
    });

    test("should handle null thrown in onConflict callback", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing onConflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          throw null;
        },
      });

      // Should abort the changeset
      expect(result).toBe(false);
    });

    test("should handle undefined thrown in onConflict callback", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing onConflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          throw undefined;
        },
      });

      // Should abort the changeset
      expect(result).toBe(false);
    });

    test("should handle object thrown in onConflict callback", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing onConflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          throw { error: "conflict", code: 42 };
        },
      });

      // Should abort the changeset
      expect(result).toBe(false);
    });

    test("should handle non-numeric return values from onConflict", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with invalid return value
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          return "invalid" as any;
        },
      });

      // Should handle gracefully
      expect(result).toBe(false);
    });

    test("should handle async functions in onConflict", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with async function (returns Promise)
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (async (_conflictType: number) => {
          return constants.SQLITE_CHANGESET_REPLACE;
        }) as any,
      });

      // Should handle the Promise object as invalid return
      expect(result).toBe(false);
    });

    test("should handle multiple conflicts with mixed behaviors", () => {
      // Setup multiple conflicting rows
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@source.com')",
      );
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (3, 'Charlie', 'charlie@source.com')",
      );

      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice2', 'alice2@target.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (2, 'Bob2', 'bob2@target.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (3, 'Charlie2', 'charlie2@target.com')",
      );

      // Create changeset with multiple updates
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      sourceDb.exec("UPDATE users SET name = 'Bob Updated' WHERE id = 2");
      sourceDb.exec("UPDATE users SET name = 'Charlie Updated' WHERE id = 3");
      const changeset = session.changeset();
      session.close();

      let callCount = 0;
      // Apply with callback that throws on second conflict
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Error on second conflict");
          }
          return constants.SQLITE_CHANGESET_REPLACE;
        },
      });

      // Should abort when error is thrown
      expect(result).toBe(false);
      expect(callCount).toBeGreaterThanOrEqual(2);

      // First update might have been applied, but not the rest
      const user2 = targetDb.prepare("SELECT * FROM users WHERE id = 2").get();
      expect(user2.name).toBe("Bob2"); // Should remain unchanged
    });
  });

  describe("filter callback error handling", () => {
    test("should handle string errors thrown in filter callback", () => {
      // Setup test data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing filter
      expect(() => {
        targetDb.applyChangeset(changeset, {
          filter: (_tableName: string) => {
            throw "Filter error!";
          },
        });
      }).not.toThrow(); // Should not crash

      // No changes should be applied
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user).toBeUndefined();
    });

    test("should handle Error objects thrown in filter callback", () => {
      // Setup test data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Apply with throwing filter
      const result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          throw new Error("Custom filter error");
        },
      });

      // Should complete but exclude the table
      expect(result).toBe(true);

      // No changes should be applied
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user).toBeUndefined();
    });

    test("should handle null/undefined thrown in filter callback", () => {
      // Setup test data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Test with null
      let result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          throw null;
        },
      });
      expect(result).toBe(true);

      // Test with undefined
      result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          throw undefined;
        },
      });
      expect(result).toBe(true);
    });

    test("should handle non-boolean return values from filter", () => {
      // Setup test data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')",
      );
      const changeset = session.changeset();
      session.close();

      // Apply with filter returning non-boolean
      const result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          return "not a boolean" as any;
        },
      });

      // Should treat truthy values as true
      expect(result).toBe(true);
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 2").get();
      expect(user).toBeDefined();
      expect(user.name).toBe("Bob");
    });

    test("should handle async functions in filter", () => {
      // Setup test data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')",
      );
      const changeset = session.changeset();
      session.close();

      // Apply with async filter (returns Promise)
      const result = targetDb.applyChangeset(changeset, {
        filter: (async (_tableName: string) => {
          return true;
        }) as any,
      });

      // Should treat Promise as truthy
      expect(result).toBe(true);
    });
  });

  describe("Combined callback error scenarios", () => {
    test("should handle errors in both filter and onConflict callbacks", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      let filterCalled = false;
      let conflictCalled = false;

      // Apply with both callbacks that can throw
      const result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          filterCalled = true;
          // Don't throw in filter, let it pass to conflict
          return true;
        },
        onConflict: (_conflictType: number) => {
          conflictCalled = true;
          throw new Error("Conflict handler error");
        },
      });

      expect(filterCalled).toBe(true);
      expect(conflictCalled).toBe(true);
      expect(result).toBe(false);
    });

    test("should handle filter throwing before onConflict is called", () => {
      // Setup conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      let conflictCalled = false;

      // Apply with filter that throws
      const result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          throw new Error("Filter error");
        },
        onConflict: (_conflictType: number) => {
          conflictCalled = true;
          return constants.SQLITE_CHANGESET_REPLACE;
        },
      });

      // Filter error should prevent conflict callback from being called
      expect(conflictCalled).toBe(false);
      expect(result).toBe(true); // Operation succeeds but table is filtered out
    });
  });

  describe("Memory and resource management", () => {
    test("should not leak memory when callbacks throw repeatedly", () => {
      // Create many conflicts
      for (let i = 0; i < 100; i++) {
        sourceDb.exec(
          `INSERT INTO users (id, name, email) VALUES (${i}, 'User${i}', 'user${i}@source.com')`,
        );
        targetDb.exec(
          `INSERT INTO users (id, name, email) VALUES (${i}, 'User${i}', 'user${i}@target.com')`,
        );
      }

      // Create changeset with many updates
      const session = sourceDb.createSession({ table: "users" });
      for (let i = 0; i < 100; i++) {
        sourceDb.exec(`UPDATE users SET name = 'Updated${i}' WHERE id = ${i}`);
      }
      const changeset = session.changeset();
      session.close();

      // Apply with throwing callbacks many times
      for (let attempt = 0; attempt < 10; attempt++) {
        const result = targetDb.applyChangeset(changeset, {
          filter: (_tableName: string) => {
            if (Math.random() > 0.5) {
              throw new Error("Random filter error");
            }
            return true;
          },
          onConflict: (_conflictType: number) => {
            if (Math.random() > 0.5) {
              throw new Error("Random conflict error");
            }
            return constants.SQLITE_CHANGESET_OMIT;
          },
        });

        // Some attempts might succeed, some might fail
        expect(typeof result).toBe("boolean");
      }

      // If we get here without segfault, the test passes
      expect(true).toBe(true);
    });

    test("should handle callback errors after database operations", () => {
      // Setup data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Create changeset
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Do some database operations
      targetDb.exec("CREATE TABLE temp (id INTEGER)");
      targetDb.exec("INSERT INTO temp VALUES (1), (2), (3)");

      // Apply changeset with throwing callback
      const result = targetDb.applyChangeset(changeset, {
        filter: (_tableName: string) => {
          // Access database during callback (should not crash)
          try {
            targetDb.prepare("SELECT COUNT(*) FROM temp").get();
          } catch {
            // Ignore any errors from nested DB access
          }
          throw new Error("Filter error after DB access");
        },
      });

      expect(result).toBe(true);
    });
  });
});
