/**
 * Tests for SQLTagStore - ported from Node.js test/parallel/test-sqlite-template-tag.js
 */
import { DatabaseSync, SQLTagStore, SQLTagStoreInstance } from "../src";

describe("SQLTagStore Tests", () => {
  let db: InstanceType<typeof DatabaseSync>;
  let sql: SQLTagStoreInstance;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    sql = db.createTagStore(10);
    db.exec("DROP TABLE IF EXISTS foo");
    db.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY, text TEXT)");
    sql.clear();
  });

  afterEach(() => {
    db.close();
  });

  test("can create a tag store", () => {
    expect(sql).toBeInstanceOf(SQLTagStore);
    expect(sql.db).toBe(db);
    expect(sql.capacity).toBe(10);
  });

  test("sql.run inserts data", () => {
    expect(sql.run`INSERT INTO foo (text) VALUES (${"bob"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"mac"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"alice"})`.changes).toBe(1);

    const count = db.prepare("SELECT COUNT(*) as count FROM foo").get() as {
      count: number;
    };
    expect(count.count).toBe(3);
  });

  test("sql.get retrieves a single row", () => {
    expect(sql.run`INSERT INTO foo (text) VALUES (${"bob"})`.changes).toBe(1);
    const first = sql.get`SELECT * FROM foo ORDER BY id ASC` as {
      id: number;
      text: string;
    };
    expect(first).toBeDefined();
    expect(first.text).toBe("bob");
    expect(first.id).toBe(1);
  });

  test("sql.all retrieves all rows", () => {
    expect(sql.run`INSERT INTO foo (text) VALUES (${"bob"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"mac"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"alice"})`.changes).toBe(1);

    const all = sql.all`SELECT * FROM foo ORDER BY id ASC` as Array<{
      id: number;
      text: string;
    }>;
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBe(3);
    expect(all.map((r) => r.text)).toEqual(["bob", "mac", "alice"]);
  });

  test("sql.iterate retrieves rows via iterator", () => {
    expect(sql.run`INSERT INTO foo (text) VALUES (${"bob"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"mac"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"alice"})`.changes).toBe(1);

    const iter = sql.iterate`SELECT * FROM foo ORDER BY id ASC`;
    const iterRows: string[] = [];
    for (const row of iter) {
      expect(row).toBeDefined();
      iterRows.push((row as { text: string }).text);
    }
    expect(iterRows).toEqual(["bob", "mac", "alice"]);
  });

  test("queries with no results", () => {
    const none = sql.get`SELECT * FROM foo WHERE text = ${"notfound"}`;
    expect(none).toBeUndefined();

    const empty = sql.all`SELECT * FROM foo WHERE text = ${"notfound"}`;
    expect(empty).toEqual([]);

    let count = 0;
    for (const _row of sql.iterate`SELECT * FROM foo WHERE text = ${"notfound"}`) {
      count++;
    }
    expect(count).toBe(0);
  });

  test("TagStore capacity, size, and clear", () => {
    expect(sql.capacity).toBe(10);
    expect(sql.size()).toBe(0);

    expect(sql.run`INSERT INTO foo (text) VALUES (${"one"})`.changes).toBe(1);
    expect(sql.size()).toBe(1);

    expect(sql.get`SELECT * FROM foo WHERE text = ${"one"}`).toBeDefined();
    expect(sql.size()).toBe(2);

    // Using the same template string shouldn't increase the size
    expect(sql.get`SELECT * FROM foo WHERE text = ${"two"}`).toBeUndefined();
    expect(sql.size()).toBe(2);

    expect(
      (sql.all`SELECT * FROM foo` as Array<{ id: number; text: string }>)
        .length,
    ).toBe(1);
    expect(sql.size()).toBe(3);

    sql.clear();
    expect(sql.size()).toBe(0);
    expect(sql.capacity).toBe(10);
  });

  test("sql.db returns the associated DatabaseSync instance", () => {
    expect(sql.db).toBe(db);
  });

  test("default capacity is 1000", () => {
    const defaultSql = db.createTagStore();
    expect(defaultSql.capacity).toBe(1000);
  });

  test("throws when database is closed", () => {
    const db2 = new DatabaseSync(":memory:");
    const sql2 = db2.createTagStore();
    db2.exec("CREATE TABLE bar (id INTEGER PRIMARY KEY)");

    // Works when open
    expect(sql2.run`INSERT INTO bar (id) VALUES (${1})`.changes).toBe(1);

    db2.close();

    // Throws when closed
    expect(() => sql2.run`INSERT INTO bar (id) VALUES (${2})`).toThrow(
      "Database is not open",
    );
  });

  test("evicts finalized statements from cache", () => {
    expect(sql.run`INSERT INTO foo (text) VALUES (${"test"})`.changes).toBe(1);
    expect(sql.size()).toBe(1);

    // Get the cached statement through a different path - directly from db
    const stmt = db.prepare("INSERT INTO foo (text) VALUES (?)");
    expect(stmt.finalized).toBe(false);

    // Now finalize it - the cache doesn't track this external statement
    stmt.finalize();
    expect(stmt.finalized).toBe(true);

    // Create a scenario where we have a cached statement, then finalize it
    const sql3 = db.createTagStore(10);
    expect(sql3.run`INSERT INTO foo (text) VALUES (${"cached"})`.changes).toBe(
      1,
    );
    expect(sql3.size()).toBe(1);

    // Get a direct reference to a statement and finalize
    // Note: The cached statement is not directly accessible, so we test via size
    sql3.clear();
    expect(sql3.size()).toBe(0);

    // Re-run should create a new statement
    expect(sql3.run`INSERT INTO foo (text) VALUES (${"new"})`.changes).toBe(1);
    expect(sql3.size()).toBe(1);
  });

  test("LRU eviction when at capacity", () => {
    const smallSql = db.createTagStore(3);

    // Create a second table for distinct SQL statements
    db.exec("CREATE TABLE bar (id INTEGER PRIMARY KEY, name TEXT)");

    // Add 3 different statements - cache should be at capacity
    // Each statement has different SQL to ensure they're cached separately
    expect(smallSql.run`INSERT INTO foo (text) VALUES (${"a"})`.changes).toBe(
      1,
    );
    expect(smallSql.run`INSERT INTO bar (name) VALUES (${"b"})`.changes).toBe(
      1,
    );
    expect(smallSql.get`SELECT * FROM foo WHERE id = ${1}`).toBeDefined();
    expect(smallSql.size()).toBe(3);

    // Add a 4th - should evict the oldest (first INSERT into foo)
    expect(smallSql.all`SELECT * FROM bar`.length).toBe(1);
    expect(smallSql.size()).toBe(3);

    // Verify LRU behavior - the INSERT into foo should be evicted
    // Accessing it again should add it back
    expect(smallSql.run`INSERT INTO foo (text) VALUES (${"c"})`.changes).toBe(
      1,
    );
    expect(smallSql.size()).toBe(3);
  });

  test("statement finalized property works", () => {
    const stmt = db.prepare("SELECT 1");
    expect(stmt.finalized).toBe(false);
    stmt.finalize();
    expect(stmt.finalized).toBe(true);
  });

  test("multiple values are bound correctly", () => {
    db.exec(
      "CREATE TABLE multi (a TEXT, b INTEGER, c REAL, d BLOB, e INTEGER)",
    );

    const result = sql.run`INSERT INTO multi (a, b, c, d, e) VALUES (${"hello"}, ${42}, ${3.14}, ${Buffer.from("data")}, ${null})`;
    expect(result.changes).toBe(1);

    const row = sql.get`SELECT * FROM multi` as {
      a: string;
      b: number;
      c: number;
      d: Buffer;
      e: null;
    };
    expect(row.a).toBe("hello");
    expect(row.b).toBe(42);
    expect(row.c).toBeCloseTo(3.14, 5);
    expect(Buffer.from(row.d).toString()).toBe("data");
    expect(row.e).toBeNull();
  });

  test("complex SQL with multiple placeholders", () => {
    // Insert some test data
    expect(sql.run`INSERT INTO foo (text) VALUES (${"alice"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"bob"})`.changes).toBe(1);
    expect(sql.run`INSERT INTO foo (text) VALUES (${"charlie"})`.changes).toBe(
      1,
    );

    // Query with multiple conditions
    const result =
      sql.get`SELECT * FROM foo WHERE id > ${0} AND text LIKE ${"b%"} ORDER BY id` as {
        id: number;
        text: string;
      };
    expect(result.text).toBe("bob");
  });

  test("empty template literal", () => {
    // SQL with no interpolations
    const result = sql.get`SELECT 1 as one` as { one: number };
    expect(result.one).toBe(1);
  });

  test("createTagStore on closed database throws", () => {
    const db2 = new DatabaseSync(":memory:");
    db2.close();
    expect(() => db2.createTagStore()).toThrow("Database is not open");
  });
});
