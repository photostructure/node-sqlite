/**
 * Tests for the setAuthorizer API
 * Based on Node.js test-sqlite-authz.js from commit 18c79d9e1ce
 */

import { DatabaseSync, constants } from "../src";

describe("DatabaseSync.prototype.setAuthorizer()", () => {
  /**
   * Helper to create a test database with a users table
   */
  const createTestDatabase = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    return db;
  };

  describe("callback parameters", () => {
    it("receives correct parameters for SELECT operations", () => {
      const calls: any[][] = [];
      const authorizer = (
        actionCode: number,
        arg1: string | null,
        arg2: string | null,
        arg3: string | null,
        arg4: string | null,
      ) => {
        calls.push([actionCode, arg1, arg2, arg3, arg4]);
        return constants.SQLITE_OK;
      };
      const db = createTestDatabase();

      db.setAuthorizer(authorizer);
      db.prepare("SELECT id FROM users").get();
      db.close();

      expect(calls.length).toBe(2);
      expect(calls).toEqual([
        [constants.SQLITE_SELECT, null, null, null, null],
        [constants.SQLITE_READ, "users", "id", "main", null],
      ]);
    });

    it("receives correct parameters for INSERT operations", () => {
      const calls: any[][] = [];
      const authorizer = (
        actionCode: number,
        arg1: string | null,
        arg2: string | null,
        arg3: string | null,
        arg4: string | null,
      ) => {
        calls.push([actionCode, arg1, arg2, arg3, arg4]);
        return constants.SQLITE_OK;
      };
      const db = createTestDatabase();

      db.setAuthorizer(authorizer);
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "node");
      db.close();

      expect(calls.length).toBe(1);
      expect(calls).toEqual([
        [constants.SQLITE_INSERT, "users", null, "main", null],
      ]);
    });
  });

  describe("authorization result codes", () => {
    it("allows operations when authorizer returns SQLITE_OK", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => constants.SQLITE_OK);

      db.exec("CREATE TABLE users (id INTEGER, name TEXT)");
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      db.close();

      expect(tables[0].name).toBe("users");
    });

    it("blocks operations when authorizer returns SQLITE_DENY", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => constants.SQLITE_DENY);

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow(/not authorized/);
      db.close();
    });
  });

  describe("SQLITE_IGNORE behavior", () => {
    it("ignores SELECT operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_SELECT) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      // SELECT should be ignored and return no results
      const result = db.prepare("SELECT * FROM users").all();
      db.close();

      expect(result).toEqual([]);
    });

    it("ignores READ operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      db.setAuthorizer((actionCode, arg1, arg2) => {
        if (
          actionCode === constants.SQLITE_READ &&
          arg1 === "users" &&
          arg2 === "name"
        ) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      // Reading the 'name' column should be ignored, returning NULL
      const result = db
        .prepare("SELECT id, name FROM users WHERE id = 1")
        .get() as { id: number; name: string | null };
      db.close();

      expect(result.id).toBe(1);
      expect(result.name).toBeNull();
    });

    it("ignores INSERT operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_INSERT) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      // Verify no data was inserted
      db.setAuthorizer(null);
      const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
        count: number;
      };
      db.close();

      expect(count.count).toBe(0);
    });

    it("ignores UPDATE operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_UPDATE) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Bob", 1);

      // Verify data was not updated
      db.setAuthorizer(null);
      const result = db
        .prepare("SELECT name FROM users WHERE id = 1")
        .get() as {
        name: string;
      };
      db.close();

      expect(result.name).toBe("Alice");
    });

    it("ignores DELETE operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

      db.setAuthorizer(() => constants.SQLITE_IGNORE);

      db.prepare("DELETE FROM users WHERE id = ?").run(1);

      db.setAuthorizer(null);

      // Verify data was not deleted
      const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
        count: number;
      };
      db.close();

      expect(count.count).toBe(1);
    });
  });

  describe("error handling", () => {
    it("rethrows error when authorizer throws error", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => {
        throw new Error("Unknown error");
      });

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow("Unknown error");
      db.close();
    });

    it("throws error when authorizer returns nothing", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer((() => {
        // Returns undefined
      }) as unknown as () => number);

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow(
        "Authorizer callback must return an integer authorization code",
      );
      db.close();
    });

    it("throws error when authorizer returns NaN (string)", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => {
        return "1" as any;
      });

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow(
        "Authorizer callback must return an integer authorization code",
      );
      db.close();
    });

    it("throws error when authorizer returns an invalid code", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => {
        return 3; // Invalid - only SQLITE_OK (0), SQLITE_DENY (1), SQLITE_IGNORE (2) are valid
      });

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow("Authorizer callback returned a invalid authorization code");
      db.close();
    });
  });

  describe("clearing authorizer", () => {
    it("clears authorizer when set to null", () => {
      let callCount = 0;
      const authorizer = () => {
        callCount++;
        return constants.SQLITE_OK;
      };
      const db = new DatabaseSync(":memory:");
      const statement = db.prepare("SELECT 1");

      // Set authorizer and verify it's called
      db.setAuthorizer(authorizer);
      statement.run();
      expect(callCount).toBe(1);

      // Clear authorizer and verify it's no longer called
      db.setAuthorizer(null);
      statement.run();
      expect(callCount).toBe(1);
      db.close();
    });
  });

  describe("invalid callback types", () => {
    it("throws when callback is a string", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer("not a function" as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is a number", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer(1 as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is an object", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer({} as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is an array", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer([] as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is undefined", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer(undefined as any);
      }).toThrow(/function/);
      db.close();
    });
  });

  describe("authorization constants", () => {
    it("exports all required authorization result codes", () => {
      expect(constants.SQLITE_OK).toBeDefined();
      expect(constants.SQLITE_DENY).toBeDefined();
      expect(constants.SQLITE_IGNORE).toBeDefined();

      // Check actual values
      expect(constants.SQLITE_OK).toBe(0);
      expect(constants.SQLITE_DENY).toBe(1);
      expect(constants.SQLITE_IGNORE).toBe(2);
    });

    it("exports all required authorization action codes", () => {
      expect(constants.SQLITE_CREATE_INDEX).toBeDefined();
      expect(constants.SQLITE_CREATE_TABLE).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_INDEX).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_TABLE).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_VIEW).toBeDefined();
      expect(constants.SQLITE_CREATE_TRIGGER).toBeDefined();
      expect(constants.SQLITE_CREATE_VIEW).toBeDefined();
      expect(constants.SQLITE_DELETE).toBeDefined();
      expect(constants.SQLITE_DROP_INDEX).toBeDefined();
      expect(constants.SQLITE_DROP_TABLE).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_INDEX).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_TABLE).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_VIEW).toBeDefined();
      expect(constants.SQLITE_DROP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_DROP_VIEW).toBeDefined();
      expect(constants.SQLITE_INSERT).toBeDefined();
      expect(constants.SQLITE_PRAGMA).toBeDefined();
      expect(constants.SQLITE_READ).toBeDefined();
      expect(constants.SQLITE_SELECT).toBeDefined();
      expect(constants.SQLITE_TRANSACTION).toBeDefined();
      expect(constants.SQLITE_UPDATE).toBeDefined();
      expect(constants.SQLITE_ATTACH).toBeDefined();
      expect(constants.SQLITE_DETACH).toBeDefined();
      expect(constants.SQLITE_ALTER_TABLE).toBeDefined();
      expect(constants.SQLITE_REINDEX).toBeDefined();
      expect(constants.SQLITE_ANALYZE).toBeDefined();
      expect(constants.SQLITE_CREATE_VTABLE).toBeDefined();
      expect(constants.SQLITE_DROP_VTABLE).toBeDefined();
      expect(constants.SQLITE_FUNCTION).toBeDefined();
      expect(constants.SQLITE_SAVEPOINT).toBeDefined();
      expect(constants.SQLITE_COPY).toBeDefined();
      expect(constants.SQLITE_RECURSIVE).toBeDefined();
    });
  });

  describe("database state validation", () => {
    it("throws when database is not open", () => {
      const db = new DatabaseSync(":memory:");
      db.close();

      expect(() => {
        db.setAuthorizer(() => constants.SQLITE_OK);
      }).toThrow(/not open/);
    });
  });

  describe("complex scenarios", () => {
    it("can block specific table operations", () => {
      const db = createTestDatabase();
      db.exec("CREATE TABLE admin (id INTEGER, role TEXT)");

      db.setAuthorizer((_actionCode, tableName) => {
        // Block all operations on 'admin' table
        if (tableName === "admin") {
          return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });

      // Should work on users table
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (1, 'Test')");
      }).not.toThrow();

      // Should fail on admin table
      expect(() => {
        db.exec("INSERT INTO admin (id, role) VALUES (1, 'superuser')");
      }).toThrow(/not authorized/);
      db.close();
    });

    it("can log all database operations", () => {
      const operations: { action: number; table: string | null }[] = [];
      const db = createTestDatabase();

      db.setAuthorizer((actionCode, param1) => {
        operations.push({ action: actionCode, table: param1 });
        return constants.SQLITE_OK;
      });

      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
      db.exec("UPDATE users SET name = 'Bob' WHERE id = 1");
      db.exec("SELECT * FROM users");
      db.close();

      // Should have captured INSERT, UPDATE, SELECT, and READ operations
      expect(operations.length).toBeGreaterThan(3);
      expect(
        operations.some((op) => op.action === constants.SQLITE_INSERT),
      ).toBe(true);
      expect(
        operations.some((op) => op.action === constants.SQLITE_UPDATE),
      ).toBe(true);
      expect(
        operations.some((op) => op.action === constants.SQLITE_SELECT),
      ).toBe(true);
    });

    it("can implement read-only mode dynamically", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Original')");

      // Enable read-only mode
      db.setAuthorizer((actionCode) => {
        // Block all write operations
        if (
          actionCode === constants.SQLITE_INSERT ||
          actionCode === constants.SQLITE_UPDATE ||
          actionCode === constants.SQLITE_DELETE
        ) {
          return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });

      // Reads should work
      const result = db
        .prepare("SELECT name FROM users WHERE id = 1")
        .get() as {
        name: string;
      };
      expect(result.name).toBe("Original");

      // Writes should fail
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (2, 'New')");
      }).toThrow(/not authorized/);

      // Disable read-only mode
      db.setAuthorizer(null);

      // Now writes should work
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (2, 'New')");
      }).not.toThrow();
      db.close();
    });
  });
});
