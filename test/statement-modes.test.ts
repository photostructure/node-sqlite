/**
 * Tests for .pluck(), .raw(), .expand() — better-sqlite3-style statement modes via enhance()
 */
import { DatabaseSync, enhance } from "../src";

describe("pluck() Tests", () => {
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
      INSERT INTO users (name, age) VALUES ('Alice', 30);
      INSERT INTO users (name, age) VALUES ('Bob', 25);
      INSERT INTO users (name, age) VALUES ('Charlie', 35);
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("basic behavior", () => {
    test("pluck().get() returns first column value instead of row object", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const result = stmt.pluck().get(1);
      expect(result).toBe("Alice");
    });

    test("pluck().all() returns flat array of first column values", () => {
      const stmt = db.prepare("SELECT name FROM users ORDER BY id");
      const result = stmt.pluck().all();
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });

    test("pluck().iterate() yields first column values", () => {
      const stmt = db.prepare("SELECT name FROM users ORDER BY id");
      const result = [...stmt.pluck().iterate()];
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });

    test("without pluck, get() returns row object", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const result = stmt.get(1);
      expect(result).toEqual({ name: "Alice" });
    });

    test("without pluck, all() returns row objects", () => {
      const stmt = db.prepare("SELECT name, age FROM users WHERE id = ?");
      const result = stmt.all(1);
      expect(result).toEqual([{ name: "Alice", age: 30 }]);
    });
  });

  describe("multi-column", () => {
    test("pluck returns first column when multiple columns selected", () => {
      const stmt = db.prepare("SELECT id, name, age FROM users WHERE id = ?");
      const result = stmt.pluck().get(1);
      expect(result).toBe(1);
    });

    test("pluck().all() returns first column from multi-column query", () => {
      const stmt = db.prepare("SELECT age, name FROM users ORDER BY id");
      const result = stmt.pluck().all();
      expect(result).toEqual([30, 25, 35]);
    });
  });

  describe("toggle behavior", () => {
    test("pluck() with no args enables pluck mode", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = 1");
      stmt.pluck();
      expect(stmt.get()).toBe("Alice");
    });

    test("pluck(true) enables pluck mode", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = 1");
      stmt.pluck(true);
      expect(stmt.get()).toBe("Alice");
    });

    test("pluck(false) disables pluck mode", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = 1");
      stmt.pluck(true);
      stmt.pluck(false);
      expect(stmt.get()).toEqual({ name: "Alice" });
    });

    test("pluck can be toggled multiple times", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = 1");

      stmt.pluck(true);
      expect(stmt.get()).toBe("Alice");

      stmt.pluck(false);
      expect(stmt.get()).toEqual({ name: "Alice" });

      stmt.pluck();
      expect(stmt.get()).toBe("Alice");
    });
  });

  describe("chaining", () => {
    test("pluck() returns the statement for chaining", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const returned = stmt.pluck();
      expect(returned).toBe(stmt);
    });

    test("stmt.pluck().get() works as a one-liner", () => {
      const result = db
        .prepare("SELECT COUNT(*) as cnt FROM users")
        .pluck()
        .get();
      expect(result).toBe(3);
    });

    test("stmt.pluck().all() works as a one-liner", () => {
      const result = db
        .prepare("SELECT name FROM users ORDER BY id")
        .pluck()
        .all();
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });
  });

  describe("edge cases", () => {
    test("pluck().get() returns undefined when no rows match", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const result = stmt.pluck().get(999);
      expect(result).toBeUndefined();
    });

    test("pluck().all() returns empty array when no rows match", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const result = stmt.pluck().all(999);
      expect(result).toEqual([]);
    });

    test("pluck().iterate() yields nothing when no rows match", () => {
      const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
      const result = [...stmt.pluck().iterate(999)];
      expect(result).toEqual([]);
    });

    test("pluck works with NULL values", () => {
      db.exec("INSERT INTO users (name, age) VALUES (NULL, 40)");
      const stmt = db.prepare("SELECT name FROM users WHERE age = 40");
      expect(stmt.pluck().get()).toBeNull();
    });

    test("pluck works with integer values", () => {
      const result = db.prepare("SELECT 42").pluck().get();
      expect(result).toBe(42);
    });

    test("pluck works with blob values", () => {
      db.exec("CREATE TABLE blobs (data BLOB)");
      db.prepare("INSERT INTO blobs VALUES (?)").run(Buffer.from("hello"));
      const result = db.prepare("SELECT data FROM blobs").pluck().get();
      expect(Buffer.isBuffer(result) || result instanceof Uint8Array).toBe(
        true,
      );
    });
  });

  describe("interaction with setReturnArrays", () => {
    test("pluck works when setReturnArrays(true) was called", () => {
      const stmt = db.prepare("SELECT id, name FROM users WHERE id = 1");
      stmt.setReturnArrays(true);
      // With returnArrays, row is [1, "Alice"]; pluck should return row[0] = 1
      const result = stmt.pluck().get();
      expect(result).toBe(1);
    });

    test("pluck().all() works with array mode", () => {
      const stmt = db.prepare("SELECT name, age FROM users ORDER BY id");
      stmt.setReturnArrays(true);
      const result = stmt.pluck().all();
      // First column values from array rows
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });
  });

  describe("validation", () => {
    test("pluck(non-boolean) throws TypeError", () => {
      const stmt = db.prepare("SELECT 1");
      expect(() => (stmt as any).pluck("true")).toThrow(TypeError);
      expect(() => (stmt as any).pluck(1)).toThrow(TypeError);
      expect(() => (stmt as any).pluck(null)).toThrow(TypeError);
    });
  });

  describe("idempotency", () => {
    test("enhance() called twice does not break pluck", () => {
      const db2 = enhance(enhance(new DatabaseSync(":memory:")));
      db2.exec("CREATE TABLE t (v TEXT)");
      db2.exec("INSERT INTO t VALUES ('hello')");
      const result = db2.prepare("SELECT v FROM t").pluck().get();
      expect(result).toBe("hello");
      db2.close();
    });
  });

  describe("pragma integration", () => {
    test("pragma with simple: true returns scalar value", () => {
      const result = db.pragma("cache_size", { simple: true });
      expect(typeof result).toBe("number");
    });

    test("pragma with simple: true returns correct value", () => {
      db.pragma("user_version = 42");
      expect(db.pragma("user_version", { simple: true })).toBe(42);
    });

    test("pragma without simple returns row array", () => {
      const result = db.pragma("cache_size") as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(typeof (result[0] as any).cache_size).toBe("number");
    });
  });

  describe("with mock statement (simulating node:sqlite)", () => {
    test("pluck works on minimal mock with only all()", () => {
      // Simulate a node:sqlite-like statement with only all()
      const mockStmt = {
        all: () => [{ name: "Alice" }, { name: "Bob" }],
      };

      const mockDb = enhance({
        exec: () => {},
        prepare: (_sql: string) => mockStmt,
        get isTransaction() {
          return false;
        },
      });

      const stmt = mockDb.prepare("SELECT name FROM users");
      const result = stmt.pluck().all();
      expect(result).toEqual(["Alice", "Bob"]);
    });

    test("pluck works on mock with get() and all()", () => {
      const mockStmt = {
        get: (..._args: any[]) => ({ id: 1, name: "Alice" }),
        all: () => [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      };

      const mockDb = enhance({
        exec: () => {},
        prepare: (_sql: string) => mockStmt,
        get isTransaction() {
          return false;
        },
      });

      const stmt = mockDb.prepare("anything");
      expect(stmt.pluck().get()).toBe(1);
      expect(stmt.pluck().all()).toEqual([1, 2]);
    });
  });
});

describe("raw() Tests", () => {
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
      INSERT INTO users (name, age) VALUES ('Alice', 30);
      INSERT INTO users (name, age) VALUES ('Bob', 25);
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("basic behavior", () => {
    test("raw().get() returns array instead of object", () => {
      const result = db
        .prepare("SELECT id, name, age FROM users WHERE id = 1")
        .raw()
        .get();
      expect(result).toEqual([1, "Alice", 30]);
    });

    test("raw().all() returns arrays instead of objects", () => {
      const result = db
        .prepare("SELECT id, name FROM users ORDER BY id")
        .raw()
        .all();
      expect(result).toEqual([
        [1, "Alice"],
        [2, "Bob"],
      ]);
    });

    test("raw().iterate() yields arrays", () => {
      const result = [
        ...db.prepare("SELECT id, name FROM users ORDER BY id").raw().iterate(),
      ];
      expect(result).toEqual([
        [1, "Alice"],
        [2, "Bob"],
      ]);
    });
  });

  describe("toggle behavior", () => {
    test("raw() with no args enables raw mode", () => {
      const stmt = db.prepare("SELECT id, name FROM users WHERE id = 1");
      stmt.raw();
      expect(stmt.get()).toEqual([1, "Alice"]);
    });

    test("raw(false) disables raw mode", () => {
      const stmt = db.prepare("SELECT id, name FROM users WHERE id = 1");
      stmt.raw();
      stmt.raw(false);
      expect(stmt.get()).toEqual({ id: 1, name: "Alice" });
    });

    test("raw() returns the statement for chaining", () => {
      const stmt = db.prepare("SELECT 1");
      expect(stmt.raw()).toBe(stmt);
    });
  });

  describe("validation", () => {
    test("raw(non-boolean) throws TypeError", () => {
      const stmt = db.prepare("SELECT 1");
      expect(() => (stmt as any).raw("true")).toThrow(TypeError);
      expect(() => (stmt as any).raw(1)).toThrow(TypeError);
    });
  });
});

describe("expand() Tests", () => {
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
      INSERT INTO users (name) VALUES ('Alice');
      INSERT INTO users (name) VALUES ('Bob');
      INSERT INTO posts (user_id, title) VALUES (1, 'Hello World');
      INSERT INTO posts (user_id, title) VALUES (1, 'Second Post');
      INSERT INTO posts (user_id, title) VALUES (2, 'Bob''s Post');
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("basic behavior", () => {
    test("expand().get() namespaces columns by table", () => {
      const result = db
        .prepare(
          "SELECT u.id, u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id WHERE u.id = 1 LIMIT 1",
        )
        .expand()
        .get();
      expect(result).toEqual({
        users: { id: 1, name: "Alice" },
        posts: { title: "Hello World" },
      });
    });

    test("expand().all() returns array of namespaced objects", () => {
      const result = db
        .prepare(
          "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id WHERE u.id = 1 ORDER BY p.id",
        )
        .expand()
        .all();
      expect(result).toEqual([
        { users: { name: "Alice" }, posts: { title: "Hello World" } },
        { users: { name: "Alice" }, posts: { title: "Second Post" } },
      ]);
    });

    test("expand().iterate() yields namespaced objects", () => {
      const result = [
        ...db
          .prepare(
            "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id ORDER BY p.id",
          )
          .expand()
          .iterate(),
      ];
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        users: { name: "Alice" },
        posts: { title: "Hello World" },
      });
    });
  });

  describe("expression columns use $ namespace", () => {
    test("computed columns go under $", () => {
      const result = db
        .prepare(
          "SELECT u.name, COUNT(*) as post_count FROM users u JOIN posts p ON u.id = p.user_id GROUP BY u.id ORDER BY u.id",
        )
        .expand()
        .all();
      expect(result).toEqual([
        { users: { name: "Alice" }, $: { post_count: 2 } },
        { users: { name: "Bob" }, $: { post_count: 1 } },
      ]);
    });

    test("all expression columns go under $ for pure expressions", () => {
      const result = db
        .prepare("SELECT 1 + 1 as val, 'hello' as greeting")
        .expand()
        .get();
      expect(result).toEqual({ $: { val: 2, greeting: "hello" } });
    });
  });

  describe("single table query", () => {
    test("expand with single table wraps under table name", () => {
      const result = db
        .prepare("SELECT id, name FROM users WHERE id = 1")
        .expand()
        .get();
      expect(result).toEqual({ users: { id: 1, name: "Alice" } });
    });
  });

  describe("duplicate column names", () => {
    // This is the canonical case expand mode exists to handle: when a query
    // has columns with the same name from different sources, flat objects
    // lose data (last value wins). Expand mode must preserve all values.
    let entryDb: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

    beforeEach(() => {
      entryDb = enhance(new DatabaseSync(":memory:"));
      entryDb.exec(`
        CREATE TABLE entries (a TEXT, b INTEGER, c REAL);
        INSERT INTO entries VALUES ('foo', 1, 3.14);
      `);
    });

    afterEach(() => {
      entryDb.close();
    });

    test("expand preserves both columns when names collide", () => {
      const stmt = entryDb.prepare("SELECT *, 2 + 3.5 AS c FROM entries");
      const result = stmt.expand().get();
      // Table column c (3.14) and expression c (5.5) both preserved
      expect(result).toEqual({
        entries: { a: "foo", b: 1, c: 3.14 },
        $: { c: 5.5 },
      });
    });

    test("expand.all() preserves duplicate columns", () => {
      entryDb.exec("INSERT INTO entries VALUES ('bar', 2, 2.71)");
      const result = entryDb
        .prepare("SELECT *, 2 + 3.5 AS c FROM entries ORDER BY b")
        .expand()
        .all();
      expect(result).toEqual([
        { entries: { a: "foo", b: 1, c: 3.14 }, $: { c: 5.5 } },
        { entries: { a: "bar", b: 2, c: 2.71 }, $: { c: 5.5 } },
      ]);
    });

    test("expand.iterate() preserves duplicate columns", () => {
      const result = [
        ...entryDb
          .prepare("SELECT *, 2 + 3.5 AS c FROM entries")
          .expand()
          .iterate(),
      ];
      expect(result).toEqual([
        { entries: { a: "foo", b: 1, c: 3.14 }, $: { c: 5.5 } },
      ]);
    });
  });

  describe("toggle behavior", () => {
    test("expand(false) disables expand mode", () => {
      const stmt = db.prepare("SELECT id, name FROM users WHERE id = 1");
      stmt.expand();
      stmt.expand(false);
      expect(stmt.get()).toEqual({ id: 1, name: "Alice" });
    });

    test("expand() returns the statement for chaining", () => {
      const stmt = db.prepare("SELECT 1");
      expect(stmt.expand()).toBe(stmt);
    });
  });

  describe("validation", () => {
    test("expand(non-boolean) throws TypeError", () => {
      const stmt = db.prepare("SELECT 1");
      expect(() => (stmt as any).expand("true")).toThrow(TypeError);
    });

    test("expand works on mock with columns() but no setReturnArrays()", () => {
      // Exercises the expandRowFromObject fallback path for mocks that provide
      // column metadata but don't support native array mode.
      const mockDb = enhance({
        exec: () => {},
        prepare: (_sql: string) => ({
          all: () => [
            { id: 1, name: "Alice", title: "Hello" },
            { id: 2, name: "Bob", title: "World" },
          ],
          get: () => ({ id: 1, name: "Alice", title: "Hello" }),
          columns: () => [
            { name: "id", table: "users" },
            { name: "name", table: "users" },
            { name: "title", table: "posts" },
          ],
          // Note: no setReturnArrays — forces object-based expand
        }),
        get isTransaction() {
          return false;
        },
      });

      const stmt = mockDb.prepare("SELECT u.id, u.name, p.title FROM ...");
      stmt.expand();

      expect(stmt.get()).toEqual({
        users: { id: 1, name: "Alice" },
        posts: { title: "Hello" },
      });

      expect(stmt.all()).toEqual([
        { users: { id: 1, name: "Alice" }, posts: { title: "Hello" } },
        { users: { id: 2, name: "Bob" }, posts: { title: "World" } },
      ]);
    });

    test("expand() throws on statement without columns() method", () => {
      const mockDb = enhance({
        exec: () => {},
        prepare: (_sql: string) => ({
          all: () => [{ a: 1 }],
        }),
        get isTransaction() {
          return false;
        },
      });

      const stmt = mockDb.prepare("SELECT 1");
      expect(() => stmt.expand()).toThrow(TypeError);
      expect(() => stmt.expand()).toThrow(/columns\(\)/);
    });
  });
});

describe("mode mutual exclusion", () => {
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec(`
      CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT);
      INSERT INTO t VALUES (1, 'a');
      INSERT INTO t VALUES (2, 'b');
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("pluck disables raw mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.raw();
    expect(stmt.get()).toEqual([1, "a"]); // raw mode
    stmt.pluck();
    expect(stmt.get()).toBe(1); // pluck mode, not raw
  });

  test("raw disables pluck mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.pluck();
    expect(stmt.get()).toBe(1); // pluck mode
    stmt.raw();
    expect(stmt.get()).toEqual([1, "a"]); // raw mode, not pluck
  });

  test("expand disables pluck mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.pluck();
    expect(stmt.get()).toBe(1); // pluck mode
    stmt.expand();
    expect(stmt.get()).toEqual({ t: { id: 1, val: "a" } }); // expand mode
  });

  test("pluck disables expand mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.expand();
    expect(stmt.get()).toEqual({ t: { id: 1, val: "a" } }); // expand mode
    stmt.pluck();
    expect(stmt.get()).toBe(1); // pluck mode
  });

  test("pluck(false) when in raw mode is a no-op", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.raw();
    stmt.pluck(false); // should be no-op since mode is raw, not pluck
    expect(stmt.get()).toEqual([1, "a"]); // still raw
  });

  test("raw(false) when in pluck mode is a no-op", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.pluck();
    stmt.raw(false); // should be no-op since mode is pluck, not raw
    expect(stmt.get()).toBe(1); // still pluck
  });

  test("expand(false) when in pluck mode is a no-op", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.pluck();
    stmt.expand(false); // no-op
    expect(stmt.get()).toBe(1); // still pluck
  });

  test("raw disables expand mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.expand();
    expect(stmt.get()).toEqual({ t: { id: 1, val: "a" } });
    stmt.raw();
    expect(stmt.get()).toEqual([1, "a"]);
  });

  test("expand disables raw mode", () => {
    const stmt = db.prepare("SELECT id, val FROM t WHERE id = 1");
    stmt.raw();
    expect(stmt.get()).toEqual([1, "a"]);
    stmt.expand();
    expect(stmt.get()).toEqual({ t: { id: 1, val: "a" } });
  });
});

describe("comprehensive mode-switching sequence", () => {
  // Mirrors better-sqlite3's canonical test from test/21.statement.get.js.
  // Exercises ALL mode transitions on a single statement with duplicate column
  // names to verify both mode logic and data integrity.
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec(`
      CREATE TABLE entries (a TEXT, b INTEGER, c REAL);
      INSERT INTO entries VALUES ('foo', 1, 3.14);
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("all mode transitions produce correct results", () => {
    const stmt = db.prepare("SELECT *, 2 + 3.5 AS c FROM entries");

    const expanded = {
      entries: { a: "foo", b: 1, c: 3.14 },
      $: { c: 5.5 },
    };
    // Flat: merged object, expression c (5.5) overwrites table c (3.14)
    const row = { a: "foo", b: 1, c: 5.5 };
    const plucked = "foo";
    const raw = ["foo", 1, 3.14, 5.5];

    // Default is flat
    expect(stmt.get()).toEqual(row);

    // flat → pluck(true)
    expect(stmt.pluck(true).get()).toEqual(plucked);
    // Stays in pluck
    expect(stmt.get()).toEqual(plucked);
    // pluck → flat via pluck(false)
    expect(stmt.pluck(false).get()).toEqual(row);
    expect(stmt.get()).toEqual(row);

    // flat → pluck via pluck() (no args = true)
    expect(stmt.pluck().get()).toEqual(plucked);
    expect(stmt.get()).toEqual(plucked);

    // pluck → expand
    expect(stmt.expand().get()).toEqual(expanded);
    expect(stmt.get()).toEqual(expanded);
    // expand → flat via expand(false)
    expect(stmt.expand(false).get()).toEqual(row);
    expect(stmt.get()).toEqual(row);

    // flat → expand(true)
    expect(stmt.expand(true).get()).toEqual(expanded);
    expect(stmt.get()).toEqual(expanded);
    // expand → pluck
    expect(stmt.pluck(true).get()).toEqual(plucked);
    expect(stmt.get()).toEqual(plucked);

    // pluck → raw
    expect(stmt.raw().get()).toEqual(raw);
    expect(stmt.get()).toEqual(raw);
    // raw → flat via raw(false)
    expect(stmt.raw(false).get()).toEqual(row);
    expect(stmt.get()).toEqual(row);

    // flat → raw(true)
    expect(stmt.raw(true).get()).toEqual(raw);
    expect(stmt.get()).toEqual(raw);
    // raw → expand
    expect(stmt.expand(true).get()).toEqual(expanded);
    expect(stmt.get()).toEqual(expanded);
  });
});

describe("stmt.database", () => {
  let db: ReturnType<typeof enhance<InstanceType<typeof DatabaseSync>>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
    db.exec("INSERT INTO t VALUES (1, 'a')");
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
  });

  test("stmt.database returns the db instance", () => {
    const stmt = db.prepare("SELECT 1");
    expect(stmt.database).toBe(db);
  });

  test("stmt.database.isOpen is true while db is open", () => {
    const stmt = db.prepare("SELECT 1");
    expect(stmt.database.isOpen).toBe(true);
  });

  test("stmt.database.isOpen is false after db.close()", () => {
    const stmt = db.prepare("SELECT 1");
    db.close();
    expect(stmt.database.isOpen).toBe(false);
  });

  test("multiple statements share the same database reference", () => {
    const stmt1 = db.prepare("SELECT 1");
    const stmt2 = db.prepare("SELECT 2");
    expect(stmt1.database).toBe(stmt2.database);
  });

  test("stmt.database is non-enumerable", () => {
    const stmt = db.prepare("SELECT 1");
    expect(Object.keys(stmt)).not.toContain("database");
    expect(stmt.database).toBeDefined();
  });

  test("stmt.database is read-only", () => {
    const stmt = db.prepare("SELECT 1");
    expect(() => {
      (stmt as any).database = "nope";
    }).toThrow();
  });

  test("works with mock database", () => {
    const mockDb = enhance({
      exec: () => {},
      prepare: (_sql: string) => ({
        all: () => [{ v: 1 }],
      }),
      get isTransaction() {
        return false;
      },
    });

    const stmt = mockDb.prepare("SELECT 1");
    expect(stmt.database).toBe(mockDb);
  });

  test("double-enhance preserves stmt.database identity", () => {
    const db2 = enhance(enhance(new DatabaseSync(":memory:")));
    db2.exec("CREATE TABLE t2 (v TEXT)");
    const stmt = db2.prepare("SELECT 1");
    expect(stmt.database).toBe(db2);
    db2.close();
  });
});
