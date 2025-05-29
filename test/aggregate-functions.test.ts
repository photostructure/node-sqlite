import { DatabaseSync } from "../src";

describe("Aggregate Functions Tests", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        value INTEGER,
        category TEXT
      )
    `);

    // Insert test data
    const insert = db.prepare(
      "INSERT INTO test_data (value, category) VALUES (?, ?)",
    );
    insert.run(10, "A");
    insert.run(20, "A");
    insert.run(30, "B");
    insert.run(40, "B");
    insert.run(50, "A");
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  test("basic sum aggregate function", () => {
    // Create a simple sum function
    db.aggregate("my_sum", {
      start: 0,
      step: (acc, value) => acc + value,
    });

    // Test the aggregate function
    const result = db
      .prepare("SELECT my_sum(value) as total FROM test_data")
      .get();
    expect(result.total).toBe(150); // 10 + 20 + 30 + 40 + 50
  });

  test("basic count aggregate function", () => {
    // Create a count function that accepts a value parameter (even if unused)
    db.aggregate("my_count", {
      start: 0,
      step: (acc, value) => acc + 1,
    });

    const result = db
      .prepare("SELECT my_count(value) as count FROM test_data")
      .get();
    expect(result.count).toBe(5);
  });

  test("aggregate with result function", () => {
    // Create an average function
    db.aggregate("my_avg", {
      start: { sum: 0, count: 0 },
      step: (acc, value) => ({ sum: acc.sum + value, count: acc.count + 1 }),
      result: (acc) => (acc.count > 0 ? acc.sum / acc.count : 0),
    });

    const result = db
      .prepare("SELECT my_avg(value) as average FROM test_data")
      .get();
    expect(result.average).toBe(30); // 150 / 5
  });

  test("aggregate with GROUP BY", () => {
    // Test sum by category
    db.aggregate("sum_by_category", {
      start: 0,
      step: (acc, value) => acc + value,
    });

    const results = db
      .prepare(
        "SELECT category, sum_by_category(value) as total FROM test_data GROUP BY category ORDER BY category",
      )
      .all();
    expect(results).toEqual([
      { category: "A", total: 80 }, // 10 + 20 + 50
      { category: "B", total: 70 }, // 30 + 40
    ]);
  });

  test("aggregate with multiple arguments", () => {
    // Create a weighted sum function
    db.aggregate("weighted_sum", {
      start: 0,
      step: (acc, value, weight) => acc + value * weight,
    });

    const result = db
      .prepare("SELECT weighted_sum(value, 2) as weighted_total FROM test_data")
      .get();
    expect(result.weighted_total).toBe(300); // (10 + 20 + 30 + 40 + 50) * 2
  });

  test("aggregate with BigInt support", () => {
    db.aggregate("big_sum", {
      start: 0n,
      step: (acc, value) => acc + BigInt(value),
      useBigIntArguments: true,
    });

    const result = db
      .prepare("SELECT big_sum(value) as big_total FROM test_data")
      .get();
    expect(result.big_total).toBe(150); // Should work with BigInt
  });

  test("aggregate with null handling", () => {
    // Insert some null values
    db.exec('INSERT INTO test_data (value, category) VALUES (NULL, "C")');
    db.exec('INSERT INTO test_data (value, category) VALUES (NULL, "C")');

    // Create a null-safe sum
    db.aggregate("null_safe_sum", {
      start: 0,
      step: (acc, value) => (value === null ? acc : acc + value),
    });

    const result = db
      .prepare("SELECT null_safe_sum(value) as total FROM test_data")
      .get();
    expect(result.total).toBe(150); // Should ignore nulls
  });

  test("aggregate error handling", () => {
    // Test with missing required options
    expect(() => {
      db.aggregate("bad_func", {} as any);
    }).toThrow();

    // Test with invalid step function
    expect(() => {
      db.aggregate("bad_step", {
        start: 0,
        step: "not a function" as any,
      });
    }).toThrow();
  });

  test("aggregate with deterministic flag", () => {
    db.aggregate("deterministic_sum", {
      start: 0,
      step: (acc, value) => acc + value,
      deterministic: true,
    });

    // Should work the same way
    const result = db
      .prepare("SELECT deterministic_sum(value) as total FROM test_data")
      .get();
    expect(result.total).toBe(150);
  });

  test("aggregate with varargs", () => {
    db.aggregate("varargs_sum", {
      start: 0,
      step: (acc, ...values) =>
        acc + values.reduce((sum, val) => sum + (val || 0), 0),
      varargs: true,
    });

    // Test with multiple columns
    const result = db
      .prepare("SELECT varargs_sum(value, id) as total FROM test_data")
      .get();
    // Should sum values (150) and ids (1+2+3+4+5 = 15) = 165
    expect(result.total).toBe(165);
  });
});
