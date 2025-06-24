import { DatabaseSync } from "../src";

describe("Aggregate Functions Error Handling", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        value INTEGER
      )
    `);

    const insert = db.prepare("INSERT INTO test_data (value) VALUES (?)");
    insert.run(10);
    insert.run(20);
    insert.run(30);
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  test("aggregate step function throwing error should not segfault", () => {
    // This test reproduces the segfault issue
    expect(() => {
      db.aggregate("error_sum", {
        start: 0,
        step: (acc, value) => {
          if (value > 15) {
            throw new Error("Value too large!");
          }
          return acc + value;
        },
      });

      // This should catch the error instead of segfaulting
      db.prepare("SELECT error_sum(value) as total FROM test_data").get();
    }).toThrow("Value too large!");
  });

  test("aggregate result function throwing error should not segfault", () => {
    expect(() => {
      db.aggregate("error_avg", {
        start: { sum: 0, count: 0 },
        step: (acc, value) => ({ sum: acc.sum + value, count: acc.count + 1 }),
        result: (_acc) => {
          throw new Error("Result calculation failed!");
        },
      });

      db.prepare("SELECT error_avg(value) as average FROM test_data").get();
    }).toThrow("Result calculation failed!");
  });

  test("aggregate inverse function throwing error should not segfault", () => {
    // Test with window functions that use inverse
    db.exec("CREATE TABLE window_test (x INTEGER, y INTEGER)");
    db.exec(
      "INSERT INTO window_test VALUES (1, 10), (2, 20), (3, 30), (4, 40)",
    );

    expect(() => {
      db.aggregate("error_window_sum", {
        start: 0,
        step: (acc, value) => acc + value,
        inverse: (_acc, _value) => {
          throw new Error("Inverse calculation failed!");
        },
      });

      // Use window function that requires inverse
      db.prepare(
        `
        SELECT x, error_window_sum(y) OVER (
          ORDER BY x ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) as rolling_sum
        FROM window_test
      `,
      ).all();
    }).toThrow("Inverse calculation failed!");
  });

  test("aggregate step function returning various error types", () => {
    // Test different error types
    const errorCases = [
      {
        name: "throw_string",
        error: () => {
          throw "String error";
        },
      },
      {
        name: "throw_number",
        error: () => {
          throw 42;
        },
      },
      {
        name: "throw_object",
        error: () => {
          throw { message: "Object error" };
        },
      },
      {
        name: "throw_null",
        error: () => {
          throw null;
        },
      },
      {
        name: "throw_undefined",
        error: () => {
          throw undefined;
        },
      },
    ];

    for (const { name, error } of errorCases) {
      expect(() => {
        db.aggregate(name, {
          start: 0,
          step: error,
        });

        db.prepare(`SELECT ${name}(value) as result FROM test_data`).get();
      }).toThrow();
    }
  });

  test("aggregate function with async function should be rejected", () => {
    // Async functions are not supported in SQLite aggregates
    // The async function returns a Promise which is not a valid SQLite type
    db.aggregate("async_func", {
      start: 0,
      step: async (acc, value) => {
        // Even without throwing, async functions return Promises
        return acc + value;
      },
    });

    // SQLite should throw an error because Promises are not valid return types
    expect(() => {
      db.prepare("SELECT async_func(value) as result FROM test_data").get();
    }).toThrow("User-defined function returned invalid type");
  });

  test("aggregate function accessing invalid memory should not segfault", () => {
    // Test accessing properties of null/undefined
    expect(() => {
      db.aggregate("null_access", {
        start: null,
        step: (acc, value) => {
          // This would cause a TypeError
          return acc.someProperty + value;
        },
      });

      db.prepare("SELECT null_access(value) as result FROM test_data").get();
    }).toThrow();
  });
});
