import {
  DatabaseSync,
  constants,
  type DatabaseSyncInstance,
  type Session,
} from "../src/index";
import { useTempDir } from "./test-utils";

describe("SQLite Sessions", () => {
  const { getDbPath, closeDatabases } = useTempDir("sqlite-session-test-", {
    cleanupWalFiles: true,
  });
  let db: DatabaseSyncInstance;

  beforeEach(() => {
    db = new DatabaseSync();
  });

  afterEach(() => {
    closeDatabases(db);
  });

  describe("createSession", () => {
    beforeEach(() => {
      db.open({ location: ":memory:" });
      // Create test table
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT,
          email TEXT
        )
      `);
    });

    it("should create a session object", () => {
      const session = db.createSession();
      expect(session).toBeDefined();
      expect(session).toHaveProperty("changeset");
      expect(session).toHaveProperty("patchset");
      expect(session).toHaveProperty("close");
    });

    it("should create a session for a specific table", () => {
      const session = db.createSession({ table: "users" });
      expect(session).toBeDefined();

      // Make changes
      db.exec(
        "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')",
      );

      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Buffer);
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
    });

    it("should create a session for all tables when no table specified", () => {
      const session = db.createSession();

      // Create another table
      db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)");

      // Make changes to both tables
      db.exec(
        "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')",
      );
      db.exec("INSERT INTO products (name) VALUES ('Widget')");

      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Buffer);
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
    });

    it("should support custom database name", () => {
      // Attach another database
      const attachPath = getDbPath("attached.db");
      db.exec(`ATTACH DATABASE '${attachPath}' AS other`);
      db.exec("CREATE TABLE other.data (id INTEGER PRIMARY KEY, value TEXT)");

      const session = db.createSession({ db: "other", table: "data" });
      expect(session).toBeDefined();

      db.exec("INSERT INTO other.data (value) VALUES ('test')");

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
    });

    it("should throw error when database is closed", () => {
      db.close();
      expect(() => db.createSession()).toThrow(/database is not open/);
    });
  });

  describe("changeset and patchset", () => {
    let session: Session;

    beforeEach(() => {
      db.open({ location: ":memory:" });
      db.exec(`
        CREATE TABLE test (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);
      session = db.createSession({ table: "test" });
    });

    afterEach(() => {
      if (session) {
        try {
          session.close();
        } catch {
          // Ignore if already closed
        }
      }
    });

    it("should generate empty changeset for no changes", () => {
      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Buffer);
      expect(changeset.length).toBe(0);

      // Verify empty changeset can be applied without effect
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      testDb.exec("INSERT INTO test VALUES (1, 'unchanged')");

      const result = testDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify nothing changed
      const row = testDb.prepare("SELECT * FROM test WHERE id = 1").get();
      expect(row.value).toBe("unchanged");
      testDb.close();
    });

    it("should generate changeset for INSERT operations", () => {
      db.exec("INSERT INTO test (id, value) VALUES (1, 'one'), (2, 'two')");

      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Buffer);
      expect(changeset.length).toBeGreaterThan(0);

      // Verify changeset contains expected data
      // SQLite changesets have a specific binary format with table names and values
      const changesetStr = changeset.toString("binary");
      expect(changesetStr).toContain("test"); // Should contain table name
      expect(changesetStr).toContain("one"); // Should contain first value
      expect(changesetStr).toContain("two"); // Should contain second value

      // Apply changeset to empty database and verify it recreates the data
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

      const result = testDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify the inserts were applied correctly
      const rows = testDb.prepare("SELECT * FROM test ORDER BY id").all();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1, value: "one" });
      expect(rows[1]).toEqual({ id: 2, value: "two" });
      testDb.close();
    });

    it("should generate changeset for UPDATE operations", () => {
      // Insert initial data
      db.exec("INSERT INTO test (id, value) VALUES (1, 'initial')");

      // Create new session to track only the update
      session.close();
      session = db.createSession({ table: "test" });

      db.exec("UPDATE test SET value = 'updated' WHERE id = 1");

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      // Verify changeset contains update data
      const changesetStr = changeset.toString("binary");
      expect(changesetStr).toContain("test"); // Table name
      expect(changesetStr).toContain("updated"); // New value

      // Apply changeset to database with initial data
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      testDb.exec("INSERT INTO test (id, value) VALUES (1, 'initial')");

      const result = testDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify the update was applied correctly
      const row = testDb.prepare("SELECT * FROM test WHERE id = 1").get();
      expect(row.value).toBe("updated");
      testDb.close();
    });

    it("should generate changeset for DELETE operations", () => {
      // Insert initial data
      db.exec("INSERT INTO test (id, value) VALUES (1, 'to_delete')");

      // Create new session to track only the delete
      session.close();
      session = db.createSession({ table: "test" });

      db.exec("DELETE FROM test WHERE id = 1");

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      // Verify changeset contains delete operation data
      const changesetStr = changeset.toString("binary");
      expect(changesetStr).toContain("test"); // Table name
      expect(changesetStr).toContain("to_delete"); // Deleted value

      // Apply changeset to database with same initial data
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      testDb.exec("INSERT INTO test (id, value) VALUES (1, 'to_delete')");

      const result = testDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify the delete was applied correctly
      const count = testDb
        .prepare("SELECT COUNT(*) as cnt FROM test")
        .get().cnt;
      expect(count).toBe(0);
      testDb.close();
    });

    it("should generate patchset", () => {
      db.exec("INSERT INTO test (id, value) VALUES (1, 'one')");

      const patchset = session.patchset();
      expect(patchset).toBeInstanceOf(Buffer);
      expect(patchset.length).toBeGreaterThan(0);

      // Patchset should be smaller than or equal to changeset
      const changeset = session.changeset();
      expect(patchset.length).toBeLessThanOrEqual(changeset.length);
    });

    it("should throw error when session is closed", () => {
      session.close();
      expect(() => session.changeset()).toThrow(/session is not open/);
      expect(() => session.patchset()).toThrow(/session is not open/);
    });

    it("should generate changeset with mixed operations", () => {
      // Start with some initial data
      db.exec(`
        INSERT INTO test (id, value) VALUES 
        (1, 'keep'),
        (2, 'update_me'),
        (3, 'delete_me')
      `);

      // Create new session to track changes
      session.close();
      session = db.createSession({ table: "test" });

      // Perform mixed operations
      db.exec("INSERT INTO test (id, value) VALUES (4, 'new')");
      db.exec("UPDATE test SET value = 'updated' WHERE id = 2");
      db.exec("DELETE FROM test WHERE id = 3");

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      // Apply to a database with the same initial state
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      testDb.exec(`
        INSERT INTO test (id, value) VALUES 
        (1, 'keep'),
        (2, 'update_me'),
        (3, 'delete_me')
      `);

      const result = testDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify all operations were applied correctly
      const rows = testDb.prepare("SELECT * FROM test ORDER BY id").all();
      expect(rows).toHaveLength(3); // 1 kept, 1 updated, 1 deleted, 1 inserted
      expect(rows[0]).toEqual({ id: 1, value: "keep" });
      expect(rows[1]).toEqual({ id: 2, value: "updated" });
      expect(rows[2]).toEqual({ id: 4, value: "new" });
      testDb.close();
    });

    it("should verify changeset ordering and completeness", () => {
      // Test that changesets capture operations in the correct order
      const ops: string[] = [];

      // Track operations
      for (let i = 1; i <= 3; i++) {
        db.exec(`INSERT INTO test (id, value) VALUES (${i}, 'value${i}')`);
        ops.push(`INSERT id=${i}`);
      }

      const changeset1 = session.changeset();

      // Apply to empty database and verify order
      const testDb = new DatabaseSync(":memory:");
      testDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      testDb.applyChangeset(changeset1);

      // Continue with updates
      session.close();
      session = db.createSession({ table: "test" });

      db.exec("UPDATE test SET value = 'modified1' WHERE id = 1");
      db.exec("UPDATE test SET value = 'modified3' WHERE id = 3");

      const changeset2 = session.changeset();

      // Apply updates to test database
      testDb.applyChangeset(changeset2);

      // Verify final state
      const rows = testDb.prepare("SELECT * FROM test ORDER BY id").all();
      expect(rows).toEqual([
        { id: 1, value: "modified1" },
        { id: 2, value: "value2" },
        { id: 3, value: "modified3" },
      ]);
      testDb.close();
    });

    it("should handle changesets with various data types", () => {
      // Create table with multiple data types
      db.exec(`
        CREATE TABLE data_types (
          id INTEGER PRIMARY KEY,
          int_val INTEGER,
          real_val REAL,
          text_val TEXT,
          blob_val BLOB,
          null_val TEXT
        )
      `);

      session.close();
      session = db.createSession({ table: "data_types" });

      // Insert data with various types including NULL
      db.exec(`
        INSERT INTO data_types VALUES 
        (1, 42, 3.14159, 'hello', X'DEADBEEF', NULL),
        (2, -123, -2.5, '', X'', 'not null')
      `);

      const changeset = session.changeset();

      // Apply to empty database
      const testDb = new DatabaseSync(":memory:");
      testDb.exec(`
        CREATE TABLE data_types (
          id INTEGER PRIMARY KEY,
          int_val INTEGER,
          real_val REAL,
          text_val TEXT,
          blob_val BLOB,
          null_val TEXT
        )
      `);

      testDb.applyChangeset(changeset);

      // Verify all data types were preserved correctly
      const rows = testDb.prepare("SELECT * FROM data_types ORDER BY id").all();
      expect(rows).toHaveLength(2);

      // Check first row
      expect(rows[0].id).toBe(1);
      expect(rows[0].int_val).toBe(42);
      expect(rows[0].real_val).toBeCloseTo(3.14159);
      expect(rows[0].text_val).toBe("hello");
      expect(rows[0].blob_val).toBeInstanceOf(Buffer);
      expect(rows[0].blob_val.toString("hex").toUpperCase()).toBe("DEADBEEF");
      expect(rows[0].null_val).toBeNull();

      // Check second row
      expect(rows[1].id).toBe(2);
      expect(rows[1].int_val).toBe(-123);
      expect(rows[1].real_val).toBe(-2.5);
      expect(rows[1].text_val).toBe("");
      expect(rows[1].blob_val).toBeInstanceOf(Buffer);
      expect(rows[1].blob_val.length).toBe(0);
      expect(rows[1].null_val).toBe("not null");

      testDb.close();
    });
  });

  describe("applyChangeset", () => {
    let sourceDb: DatabaseSyncInstance;
    let targetDb: DatabaseSyncInstance;

    beforeEach(() => {
      sourceDb = new DatabaseSync(":memory:");
      targetDb = new DatabaseSync(":memory:");

      // Create identical schema in both databases
      const schema = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT,
          email TEXT
        )
      `;
      sourceDb.exec(schema);
      targetDb.exec(schema);
    });

    afterEach(() => {
      if (sourceDb && sourceDb.isOpen) sourceDb.close();
      if (targetDb && targetDb.isOpen) targetDb.close();
    });

    it("should apply changeset successfully", () => {
      // Record changes in source database
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec(
        "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')",
      );
      sourceDb.exec(
        "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')",
      );

      const changeset = session.changeset();
      session.close();

      // Apply changeset to target database
      const result = targetDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify data was applied
      const users = targetDb.prepare("SELECT * FROM users ORDER BY id").all();
      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        name: "Alice",
        email: "alice@example.com",
      });
      expect(users[1]).toMatchObject({ name: "Bob", email: "bob@example.com" });
    });

    it("should apply UPDATE changes", () => {
      // Insert initial data in both databases
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@old.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@old.com')",
      );

      // Record update in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET email = 'alice@new.com' WHERE id = 1");

      const changeset = session.changeset();
      session.close();

      // Apply to target
      const result = targetDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify update was applied
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user).toMatchObject({ name: "Alice", email: "alice@new.com" });
    });

    it("should apply DELETE changes", () => {
      // Insert initial data in both databases
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'ToDelete', 'delete@example.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'ToDelete', 'delete@example.com')",
      );

      // Record delete in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("DELETE FROM users WHERE id = 1");

      const changeset = session.changeset();
      session.close();

      // Apply to target
      const result = targetDb.applyChangeset(changeset);
      expect(result).toBe(true);

      // Verify delete was applied
      const count = targetDb
        .prepare("SELECT COUNT(*) as cnt FROM users")
        .get().cnt;
      expect(count).toBe(0);
    });

    it("should handle conflicts with onConflict callback", () => {
      // Insert conflicting data
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Record another insert with same ID in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (2, 'Charlie', 'charlie@source.com')",
      );
      // Try to insert with existing ID (this would normally fail, so let's update instead)
      session.close();

      // Create a changeset that will conflict
      const session2 = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session2.changeset();
      session2.close();

      let conflictCalled = false;
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (_conflictType: number) => {
          conflictCalled = true;
          // Replace the conflicting row
          return constants.SQLITE_CHANGESET_REPLACE;
        },
      });

      expect(result).toBe(true);
      expect(conflictCalled).toBe(true);
    });

    it("should handle UPDATE/UPDATE conflicts", () => {
      // Insert same initial data in both databases
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Update in target database
      targetDb.exec("UPDATE users SET email = 'alice@target.com' WHERE id = 1");

      // Record different update in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET email = 'alice@source.com' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      let conflictType: number | undefined;
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (type: number) => {
          conflictType = type;
          // Choose to keep the target's version
          return constants.SQLITE_CHANGESET_OMIT;
        },
      });

      expect(result).toBe(true);
      expect(conflictType).toBe(constants.SQLITE_CHANGESET_DATA);

      // Verify target's version was kept
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user.email).toBe("alice@target.com");
    });

    it("should handle INSERT/INSERT conflicts", () => {
      // Insert data in target only
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@target.com')",
      );

      // Record insert with same ID in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@source.com')",
      );
      const changeset = session.changeset();
      session.close();

      let conflictType: number | undefined;
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (type: number) => {
          conflictType = type;
          // Replace with source version
          return constants.SQLITE_CHANGESET_REPLACE;
        },
      });

      expect(result).toBe(true);
      expect(conflictType).toBe(constants.SQLITE_CHANGESET_CONFLICT);

      // Verify source's version replaced target's
      const user = targetDb.prepare("SELECT * FROM users WHERE id = 1").get();
      expect(user.name).toBe("Alice");
      expect(user.email).toBe("alice@source.com");
    });

    it("should handle DELETE/UPDATE conflicts", () => {
      // Insert initial data in both databases
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );

      // Delete in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("DELETE FROM users WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      // Update in target before applying changeset
      targetDb.exec(
        "UPDATE users SET email = 'alice@updated.com' WHERE id = 1",
      );

      let conflictType: number | undefined;
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (type: number) => {
          conflictType = type;
          // Abort on this conflict
          return constants.SQLITE_CHANGESET_ABORT;
        },
      });

      expect(result).toBe(false); // Should return false when aborted
      expect(conflictType).toBe(constants.SQLITE_CHANGESET_DATA);

      // Verify row still exists (delete was not applied)
      const count = targetDb
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE id = 1")
        .get().cnt;
      expect(count).toBe(1);
    });

    it("should handle multiple conflicts in one changeset", () => {
      // Set up initial data
      sourceDb.exec(`
        INSERT INTO users (id, name, email) VALUES 
        (1, 'Alice', 'alice@example.com'),
        (2, 'Bob', 'bob@example.com'),
        (3, 'Charlie', 'charlie@example.com')
      `);
      targetDb.exec(`
        INSERT INTO users (id, name, email) VALUES 
        (1, 'Alice', 'alice@example.com'),
        (2, 'Bob', 'bob@example.com'),
        (3, 'Charlie', 'charlie@example.com')
      `);

      // Make conflicting changes in target
      targetDb.exec("UPDATE users SET email = 'alice@target.com' WHERE id = 1");
      targetDb.exec("DELETE FROM users WHERE id = 2");

      // Record different changes in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET email = 'alice@source.com' WHERE id = 1");
      sourceDb.exec("UPDATE users SET email = 'bob@source.com' WHERE id = 2");
      sourceDb.exec("DELETE FROM users WHERE id = 3");
      const changeset = session.changeset();
      session.close();

      const conflicts: Array<{ type: number; resolution: number }> = [];
      const result = targetDb.applyChangeset(changeset, {
        onConflict: (type: number) => {
          let resolution: number;
          if (type === constants.SQLITE_CHANGESET_DATA) {
            // For data conflicts, use source version
            resolution = constants.SQLITE_CHANGESET_REPLACE;
          } else if (type === constants.SQLITE_CHANGESET_NOTFOUND) {
            // For not found, skip the change
            resolution = constants.SQLITE_CHANGESET_OMIT;
          } else {
            // For other conflicts, abort
            resolution = constants.SQLITE_CHANGESET_ABORT;
          }
          conflicts.push({ type, resolution });
          return resolution;
        },
      });

      expect(result).toBe(true);
      expect(conflicts.length).toBe(2); // Should have 2 conflicts
      expect(conflicts[0].type).toBe(constants.SQLITE_CHANGESET_DATA); // UPDATE/UPDATE conflict
      expect(conflicts[1].type).toBe(constants.SQLITE_CHANGESET_NOTFOUND); // UPDATE on deleted row

      // Verify final state
      const users = targetDb.prepare("SELECT * FROM users ORDER BY id").all();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ id: 1, email: "alice@source.com" }); // Replaced
    });

    it("should filter tables with filter callback", () => {
      // Create another table
      sourceDb.exec(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)",
      );
      targetDb.exec(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)",
      );

      // Record changes to both tables
      const session = sourceDb.createSession();
      sourceDb.exec(
        "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')",
      );
      sourceDb.exec("INSERT INTO products (name) VALUES ('Widget')");

      const changeset = session.changeset();
      session.close();

      // Apply with filter to only allow users table
      const filterCalls: string[] = [];
      const result = targetDb.applyChangeset(changeset, {
        filter: (tableName: string) => {
          filterCalls.push(tableName);
          return tableName === "users";
        },
      });

      expect(result).toBe(true);
      expect(filterCalls).toContain("users");
      expect(filterCalls).toContain("products");

      // Verify only users table was updated
      const userCount = targetDb
        .prepare("SELECT COUNT(*) as cnt FROM users")
        .get().cnt;
      const productCount = targetDb
        .prepare("SELECT COUNT(*) as cnt FROM products")
        .get().cnt;
      expect(userCount).toBe(1);
      expect(productCount).toBe(0);
    });

    it("should return false when changeset is aborted", () => {
      // First, add some data to both databases
      sourceDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
      );
      targetDb.exec(
        "INSERT INTO users (id, name, email) VALUES (1, 'Bob', 'bob@example.com')",
      );

      // Now create a conflicting update in source
      const session = sourceDb.createSession({ table: "users" });
      sourceDb.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1");
      const changeset = session.changeset();
      session.close();

      let onConflictCalled = false;
      const result = targetDb.applyChangeset(changeset, {
        onConflict: () => {
          onConflictCalled = true;
          return constants.SQLITE_CHANGESET_ABORT;
        },
      });

      expect(onConflictCalled).toBe(true);
      expect(result).toBe(false);
    });

    it("should throw error for invalid changeset data", () => {
      const invalidChangeset = Buffer.from("invalid data");
      expect(() => targetDb.applyChangeset(invalidChangeset)).toThrow(
        /Failed to apply changeset/,
      );
    });

    it("should throw error when database is closed", () => {
      const changeset = Buffer.from([]);
      targetDb.close();
      expect(() => targetDb.applyChangeset(changeset)).toThrow(
        /database is not open/,
      );
    });
  });

  describe("Session lifecycle", () => {
    it("should handle multiple sessions", () => {
      db.open({ location: ":memory:" });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

      const session1 = db.createSession({ table: "test" });
      const session2 = db.createSession({ table: "test" });

      db.exec("INSERT INTO test (value) VALUES ('one')");

      const changeset1 = session1.changeset();
      const changeset2 = session2.changeset();

      expect(changeset1.length).toBeGreaterThan(0);
      expect(changeset2.length).toBeGreaterThan(0);
      expect(changeset1).toEqual(changeset2);

      session1.close();
      session2.close();
    });

    it("should clean up sessions when database is closed", () => {
      db.open({ location: ":memory:" });
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

      const session = db.createSession({ table: "test" });
      db.exec("INSERT INTO test (value) VALUES ('test')");

      // Close database without closing session
      db.close();

      // Session should no longer be usable
      expect(() => session.changeset()).toThrow();
    });
  });
});
