/**
 * Runtime tests to verify our API surface matches node:sqlite exactly
 */

import { DatabaseSync, Session, StatementSync, constants } from "../src";

describe("API Surface Tests", () => {
  describe("DatabaseSync class", () => {
    test("has all required static properties", () => {
      expect(typeof DatabaseSync).toBe("function");
      expect(DatabaseSync.name).toBe("DatabaseSync");
    });

    test("constructor overloads work", () => {
      // No args - database not opened yet
      const db1 = new DatabaseSync();
      expect(db1.isOpen).toBe(false);
      db1.open({ location: ":memory:" });
      expect(db1.location()).toBeNull(); // in-memory database should return null
      db1.close();

      // Path only
      const db2 = new DatabaseSync(":memory:");
      expect(db2.location()).toBeNull(); // in-memory database should return null
      expect(db2.isOpen).toBe(true);
      db2.close();

      // Path with options
      const db3 = new DatabaseSync(":memory:", { readOnly: false });
      expect(db3.location()).toBeNull(); // in-memory database should return null
      expect(db3.isOpen).toBe(true);
      db3.close();
    });

    test("has all required instance methods", () => {
      const db = new DatabaseSync(":memory:");

      // Core methods
      expect(typeof db.close).toBe("function");
      expect(typeof db.exec).toBe("function");
      expect(typeof db.prepare).toBe("function");
      expect(typeof db.open).toBe("function");

      // User functions
      expect(typeof db.function).toBe("function");
      expect(typeof db.aggregate).toBe("function");

      // Sessions
      expect(typeof db.createSession).toBe("function");
      expect(typeof db.applyChangeset).toBe("function");

      // Extensions
      expect(typeof db.enableLoadExtension).toBe("function");
      expect(typeof db.loadExtension).toBe("function");

      // Backup
      expect(typeof db.backup).toBe("function");

      db.close();
    });

    test("has all required instance properties", () => {
      const db = new DatabaseSync(":memory:");

      expect(typeof db.isOpen).toBe("boolean");
      expect(typeof db.isTransaction).toBe("boolean");
      expect(typeof db.location).toBe("function");

      db.close();
    });

    test("has Symbol.dispose if available", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        expect(typeof db[Symbol.dispose]).toBe("function");
        db.close();
      }
    });
  });

  describe("StatementSync class", () => {
    test("has all required static properties", () => {
      expect(typeof StatementSync).toBe("function");
      expect(StatementSync.name).toBe("StatementSync");
    });

    test("has all required instance methods", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
      const stmt = db.prepare("SELECT * FROM test");

      // Core methods
      expect(typeof stmt.run).toBe("function");
      expect(typeof stmt.get).toBe("function");
      expect(typeof stmt.all).toBe("function");
      expect(typeof stmt.iterate).toBe("function");

      // Configuration methods
      expect(typeof stmt.setReadBigInts).toBe("function");
      expect(typeof stmt.setAllowBareNamedParameters).toBe("function");
      expect(typeof stmt.setReturnArrays).toBe("function");

      // Metadata
      expect(typeof stmt.columns).toBe("function");

      // Finalization
      expect(typeof stmt.finalize).toBe("function");

      db.close();
    });

    test("has all required instance properties", () => {
      const db = new DatabaseSync(":memory:");
      const stmt = db.prepare("SELECT 1 as num");

      expect(typeof stmt.sourceSQL).toBe("string");
      expect(stmt.sourceSQL).toBe("SELECT 1 as num");

      // expandedSQL might be undefined
      expect(
        stmt.expandedSQL === undefined || typeof stmt.expandedSQL === "string",
      ).toBe(true);

      db.close();
    });

    test("has Symbol.dispose if available", () => {
      if (typeof Symbol !== "undefined" && Symbol.dispose) {
        const db = new DatabaseSync(":memory:");
        const stmt = db.prepare("SELECT 1");
        expect(typeof stmt[Symbol.dispose]).toBe("function");
        db.close();
      }
    });

    test("columns() returns correct metadata", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
      const stmt = db.prepare("SELECT id, name FROM test");

      const columns = stmt.columns();
      expect(Array.isArray(columns)).toBe(true);
      expect(columns).toHaveLength(2);
      expect(columns[0]).toHaveProperty("name", "id");
      expect(columns[1]).toHaveProperty("name", "name");

      db.close();
    });
  });

  describe("Session class", () => {
    test("has all required static properties", () => {
      expect(typeof Session).toBe("function");
      expect(Session.name).toBe("Session");
    });

    test("has all required instance methods", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

      const session = db.createSession();

      expect(typeof session.changeset).toBe("function");
      expect(typeof session.patchset).toBe("function");
      expect(typeof session.close).toBe("function");

      session.close();
      db.close();
    });
  });

  describe("constants object", () => {
    test("exports constants object", () => {
      expect(typeof constants).toBe("object");
      expect(constants).not.toBeNull();
    });

    test("has all open constants", () => {
      expect(typeof constants.SQLITE_OPEN_READONLY).toBe("number");
      expect(typeof constants.SQLITE_OPEN_READWRITE).toBe("number");
      expect(typeof constants.SQLITE_OPEN_CREATE).toBe("number");
    });

    test("has all changeset constants", () => {
      expect(typeof constants.SQLITE_CHANGESET_OMIT).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_REPLACE).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_ABORT).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_DATA).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_NOTFOUND).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_CONFLICT).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_CONSTRAINT).toBe("number");
      expect(typeof constants.SQLITE_CHANGESET_FOREIGN_KEY).toBe("number");
    });

    test("changeset constant values match expected", () => {
      // These should match SQLite's values
      expect(constants.SQLITE_CHANGESET_OMIT).toBe(0);
      expect(constants.SQLITE_CHANGESET_REPLACE).toBe(1);
      expect(constants.SQLITE_CHANGESET_ABORT).toBe(2);
    });
  });

  describe("Type compatibility", () => {
    test("accepts all SQL input types", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data BLOB, text TEXT, num REAL)");
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?, ?, ?)");

      // All these types should be accepted
      expect(() => stmt.run(null, null, null, null)).not.toThrow();
      expect(() =>
        stmt.run(123, Buffer.from("data"), "text", 3.14),
      ).not.toThrow();
      expect(() =>
        stmt.run(BigInt(456), new Uint8Array([1, 2, 3]), "more text", 2.71),
      ).not.toThrow();

      db.close();
    });

    test("returns correct SQL output types", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, data BLOB, text TEXT, num REAL)");

      const insert = db.prepare("INSERT INTO test VALUES (?, ?, ?, ?)");
      insert.run(123, Buffer.from("blob data"), "text value", 3.14159);

      const select = db.prepare("SELECT * FROM test");
      const row = select.get();

      expect(typeof row.id).toBe("number");
      expect(row.data).toBeInstanceOf(Uint8Array);
      expect(typeof row.text).toBe("string");
      expect(typeof row.num).toBe("number");

      db.close();
    });
  });

  describe("Options interfaces", () => {
    test("DatabaseSyncOptions accepts all fields", () => {
      const opts = {
        location: ":memory:",
        readOnly: false,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: true,
        timeout: 5000,
        allowExtension: false,
      };

      expect(() => new DatabaseSync(":memory:", opts)).not.toThrow();
    });

    test("SessionOptions accepts all fields", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");

      const opts = {
        table: "test",
        db: "main",
      };

      expect(() => db.createSession(opts)).not.toThrow();
      db.close();
    });

    test("ChangesetApplyOptions accepts all fields", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

      const session = db.createSession();
      db.exec("INSERT INTO test VALUES (1, 'test')");
      const changeset = session.changeset();
      session.close();

      const opts = {
        onConflict: (_conflictType: number) => constants.SQLITE_CHANGESET_OMIT,
        filter: (tableName: string) => tableName === "test",
      };

      // This might fail if no changes, but we're testing the options are accepted
      expect(() => db.applyChangeset(changeset, opts)).not.toThrow();
      db.close();
    });
  });

  describe("Method signatures", () => {
    test("prepare() returns StatementSync instance", () => {
      const db = new DatabaseSync(":memory:");
      const stmt = db.prepare("SELECT 1");

      expect(stmt).toBeInstanceOf(StatementSync);
      expect(stmt.constructor.name).toBe("StatementSync");

      db.close();
    });

    test("run() returns changes object", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");

      const result = stmt.run("test");

      expect(typeof result).toBe("object");
      expect(typeof result.changes).toBe("number");
      expect(typeof result.lastInsertRowid).toBe("number");
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(1);

      db.close();
    });

    test("iterate() returns proper iterator", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      const stmt = db.prepare("SELECT * FROM test");
      const iterator = stmt.iterate();

      // Check it's an iterator
      expect(typeof iterator[Symbol.iterator]).toBe("function");
      expect(typeof iterator.next).toBe("function");

      // Test iteration
      const values = [];
      for (const row of iterator) {
        values.push(row.id);
      }
      expect(values).toEqual([1, 2, 3]);

      db.close();
    });

    test("backup() returns Promise<number>", async () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER)");

      const backupPromise = db.backup(":memory:");
      // Check it's a promise by checking for then method
      expect(typeof backupPromise.then).toBe("function");
      expect(typeof backupPromise.catch).toBe("function");

      const result = await backupPromise;
      expect(typeof result).toBe("number");

      db.close();
    });
  });
});
