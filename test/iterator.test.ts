import { DatabaseSync } from "../src";

describe("Statement Iterator Tests", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        name TEXT,
        value INTEGER
      )
    `);

    // Insert test data
    const insert = db.prepare(
      "INSERT INTO test_data (name, value) VALUES (?, ?)",
    );
    insert.run("alice", 100);
    insert.run("bob", 200);
    insert.run("charlie", 300);
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  test("basic iterator functionality", () => {
    const stmt = db.prepare("SELECT * FROM test_data ORDER BY id");
    const iterator = stmt.iterate();

    // First iteration
    let result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 1, name: "alice", value: 100 });

    // Second iteration
    result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 2, name: "bob", value: 200 });

    // Third iteration
    result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 3, name: "charlie", value: 300 });

    // Fourth iteration - should be done
    result = iterator.next();
    expect(result.done).toBe(true);
    expect(result.value).toBeNull();
  });

  test("iterator with parameters", () => {
    const stmt = db.prepare(
      "SELECT * FROM test_data WHERE value > ? ORDER BY id",
    );
    const iterator = stmt.iterate(150);

    // Should only get bob and charlie
    let result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 2, name: "bob", value: 200 });

    result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 3, name: "charlie", value: 300 });

    result = iterator.next();
    expect(result.done).toBe(true);
    expect(result.value).toBeNull();
  });

  test("iterator is iterable (for...of)", () => {
    const stmt = db.prepare("SELECT name, value FROM test_data ORDER BY id");
    const iterator = stmt.iterate();

    const results = [];
    for (const row of iterator) {
      results.push(row);
    }

    expect(results).toEqual([
      { name: "alice", value: 100 },
      { name: "bob", value: 200 },
      { name: "charlie", value: 300 },
    ]);
  });

  test("iterator return method", () => {
    const stmt = db.prepare("SELECT * FROM test_data ORDER BY id");
    const iterator = stmt.iterate();

    // Get first result
    let result = iterator.next();
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ id: 1, name: "alice", value: 100 });

    // Call return to end iteration early
    result = iterator.return!();
    expect(result.done).toBe(true);
    expect(result.value).toBeNull();

    // Subsequent calls should still return done
    result = iterator.next();
    expect(result.done).toBe(true);
    expect(result.value).toBeNull();
  });

  test("multiple iterators on same statement", () => {
    const stmt = db.prepare("SELECT name FROM test_data ORDER BY id");

    // Create first iterator and get one result
    const iter1 = stmt.iterate();
    const result1 = iter1.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual({ name: "alice" });

    // Create second iterator - this resets the statement
    const iter2 = stmt.iterate();
    const result2 = iter2.next();

    // iter2 should start from the beginning
    expect(result2.done).toBe(false);
    expect(result2.value).toEqual({ name: "alice" });

    // iter1 is now in an inconsistent state due to the reset
    // This is expected SQLite behavior - only one active cursor per statement
  });

  test("iterator with empty result set", () => {
    const stmt = db.prepare("SELECT * FROM test_data WHERE value > 1000");
    const iterator = stmt.iterate();

    const result = iterator.next();
    expect(result.done).toBe(true);
    expect(result.value).toBeNull();
  });

  test("iterator with finalized statement should throw", () => {
    const stmt = db.prepare("SELECT * FROM test_data");
    const iterator = stmt.iterate();

    // Finalize the statement
    stmt.finalize();

    // Iterator should throw on next call
    expect(() => iterator.next()).toThrow(/finalized/i);
  });

  test("iterator spread operator", () => {
    const stmt = db.prepare("SELECT name FROM test_data ORDER BY id");
    const iterator = stmt.iterate();

    // Using spread operator
    const results = [...iterator];

    expect(results).toEqual([
      { name: "alice" },
      { name: "bob" },
      { name: "charlie" },
    ]);
  });

  test("iterator Array.from", () => {
    const stmt = db.prepare("SELECT value FROM test_data ORDER BY id");
    const iterator = stmt.iterate();

    // Using Array.from
    const results = Array.from(iterator);

    expect(results).toEqual([{ value: 100 }, { value: 200 }, { value: 300 }]);
  });
});
