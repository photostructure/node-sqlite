import { DatabaseSync, DatabaseSyncInstance } from "../src";

describe("NULL and Zero-Length TEXT/BLOB Handling", () => {
  let db: DatabaseSyncInstance;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db && db.isOpen) {
      db.close();
    }
  });

  describe("TEXT column NULL handling", () => {
    test("handles NULL TEXT in object mode (stmt.get())", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, NULL)");

      const stmt = db.prepare("SELECT * FROM test WHERE id = ?");
      const row = stmt.get(1);

      expect(row).toBeDefined();
      expect(row.id).toBe(1);
      expect(row.value).toBeNull();
    });

    test("handles NULL TEXT in array mode (stmt.all())", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, NULL)");

      const stmt = db.prepare("SELECT * FROM test");
      const rows = stmt.all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].value).toBeNull();
    });

    test("handles zero-length TEXT in object mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, '')");

      const stmt = db.prepare("SELECT * FROM test WHERE id = ?");
      const row = stmt.get(1);

      expect(row).toBeDefined();
      expect(row.id).toBe(1);
      expect(row.value).toBe("");
    });

    test("handles zero-length TEXT in array mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, '')");

      const stmt = db.prepare("SELECT * FROM test");
      const rows = stmt.all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].value).toBe("");
    });

    test("handles mixed NULL, empty, and non-empty TEXT values", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, NULL), (2, ''), (3, 'hello')");

      const stmt = db.prepare("SELECT * FROM test ORDER BY id");
      const rows = stmt.all();

      expect(rows).toHaveLength(3);
      expect(rows[0].value).toBeNull();
      expect(rows[1].value).toBe("");
      expect(rows[2].value).toBe("hello");
    });
  });

  describe("BLOB column NULL handling", () => {
    test("handles NULL BLOB in object mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      db.exec("INSERT INTO test VALUES (1, NULL)");

      const stmt = db.prepare("SELECT * FROM test WHERE id = ?");
      const row = stmt.get(1);

      expect(row).toBeDefined();
      expect(row.id).toBe(1);
      expect(row.data).toBeNull();
    });

    test("handles NULL BLOB in array mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      db.exec("INSERT INTO test VALUES (1, NULL)");

      const stmt = db.prepare("SELECT * FROM test");
      const rows = stmt.all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].data).toBeNull();
    });

    test("handles zero-length BLOB in object mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      stmt.run(1, Buffer.alloc(0));

      const selectStmt = db.prepare("SELECT * FROM test WHERE id = ?");
      const row = selectStmt.get(1);

      expect(row).toBeDefined();
      expect(row.id).toBe(1);
      // SQLite treats zero-length BLOB as NULL
      expect(row.data).toBeNull();
    });

    test("handles zero-length BLOB in array mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      stmt.run(1, Buffer.alloc(0));

      const selectStmt = db.prepare("SELECT * FROM test");
      const rows = selectStmt.all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      // SQLite treats zero-length BLOB as NULL
      expect(rows[0].data).toBeNull();
    });

    test("handles mixed NULL, empty, and non-empty BLOB values", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      stmt.run(1, null);
      stmt.run(2, Buffer.alloc(0)); // SQLite treats this as NULL
      stmt.run(3, Buffer.from("hello"));

      const selectStmt = db.prepare("SELECT * FROM test ORDER BY id");
      const rows = selectStmt.all();

      expect(rows).toHaveLength(3);
      expect(rows[0].data).toBeNull();
      expect(rows[1].data).toBeNull(); // Zero-length BLOB becomes NULL
      expect(Buffer.isBuffer(rows[2].data)).toBe(true);
      expect(rows[2].data.toString()).toBe("hello");
    });
  });

  describe("Iterator mode NULL handling", () => {
    test("handles NULL TEXT in iterator mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, NULL), (2, ''), (3, 'hello')");

      const stmt = db.prepare("SELECT * FROM test ORDER BY id");
      const results = [];

      for (const row of stmt.iterate()) {
        results.push(row);
      }

      expect(results).toHaveLength(3);
      expect(results[0].value).toBeNull();
      expect(results[1].value).toBe("");
      expect(results[2].value).toBe("hello");
    });

    test("handles NULL BLOB in iterator mode", () => {
      db.exec("CREATE TABLE test (id INTEGER, data BLOB)");
      const insertStmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      insertStmt.run(1, null);
      insertStmt.run(2, Buffer.alloc(0)); // SQLite treats this as NULL
      insertStmt.run(3, Buffer.from("test"));

      const stmt = db.prepare("SELECT * FROM test ORDER BY id");
      const results = [];

      for (const row of stmt.iterate()) {
        results.push(row);
      }

      expect(results).toHaveLength(3);
      expect(results[0].data).toBeNull();
      expect(results[1].data).toBeNull(); // Zero-length BLOB becomes NULL
      expect(Buffer.isBuffer(results[2].data)).toBe(true);
      expect(results[2].data.toString()).toBe("test");
    });
  });
});
