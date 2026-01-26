import { backup, DatabaseSync } from "../src";

describe("Callback Function Error Handling", () => {
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

  describe("User-defined functions", () => {
    test("function throwing error should not segfault", () => {
      db.function("error_func", (value: number) => {
        if (value > 15) {
          throw new Error("Value too large!");
        }
        return value * 2;
      });

      // First call should work
      const result1 = db.prepare("SELECT error_func(10) as result").get();
      expect(result1.result).toBe(20);

      // Second call should throw
      expect(() => {
        db.prepare("SELECT error_func(20) as result").get();
      }).toThrow();
    });

    test("function with various error types", () => {
      const errorCases = [
        {
          name: "throw_string",
          func: () => {
            throw "String error";
          },
        },
        {
          name: "throw_number",
          func: () => {
            throw 42;
          },
        },
        {
          name: "throw_object",
          func: () => {
            throw { message: "Object error" };
          },
        },
        {
          name: "throw_null",
          func: () => {
            throw null;
          },
        },
        {
          name: "throw_undefined",
          func: () => {
            throw undefined;
          },
        },
        {
          name: "type_error",
          func: () => {
            const x: any = null;
            return x.someProperty; // TypeError
          },
        },
        {
          name: "reference_error",
          func: () => {
            // @ts-expect-error nonExistentVariable is not defined
            return nonExistentVariable; // ReferenceError
          },
        },
      ];

      for (const { name, func } of errorCases) {
        db.function(name, func);

        expect(() => {
          db.prepare(`SELECT ${name}() as result`).get();
        }).toThrow();
      }
    });

    test("function with invalid return value", () => {
      // Test functions returning promises or other non-serializable values
      db.function("return_promise", () => {
        return Promise.resolve(42);
      });

      db.function("return_symbol", () => {
        return Symbol("test");
      });

      db.function("return_function", () => {
        return () => "nested function";
      });

      // Promise return throws "Asynchronous user-defined functions are not supported"
      expect(() => {
        db.prepare("SELECT return_promise() as result").get();
      }).toThrow(/asynchronous/i);

      // Symbol conversion throws an error, which is expected
      expect(() => {
        db.prepare("SELECT return_symbol() as result").get();
      }).toThrow();

      // Functions as return values also throw
      expect(() => {
        db.prepare("SELECT return_function() as result").get();
      }).toThrow();
    });

    test("varargs function with error", () => {
      db.function("varargs_error", { varargs: true }, (...args: any[]) => {
        if (args.length > 2) {
          throw new Error("Too many arguments!");
        }
        return args.reduce((sum, val) => sum + (val || 0), 0);
      });

      // Should work with 2 args
      const result1 = db
        .prepare("SELECT varargs_error(10, 20) as result")
        .get();
      expect(result1.result).toBe(30);

      // Should throw with 3 args
      expect(() => {
        db.prepare("SELECT varargs_error(10, 20, 30) as result").get();
      }).toThrow(); // Just verify that an error is thrown
    });
  });

  describe("Aggregate functions", () => {
    test("aggregate step throwing error should not segfault", () => {
      db.aggregate("error_sum", {
        start: 0,
        step: (acc, value) => {
          if (value > 15) {
            throw new Error("Value too large in aggregate!");
          }
          return acc + value;
        },
      });

      expect(() => {
        db.prepare("SELECT error_sum(value) as total FROM test_data").get();
      }).toThrow();
    });

    test("aggregate result throwing error should not segfault", () => {
      db.aggregate("error_avg", {
        start: { sum: 0, count: 0 },
        step: (acc, value) => ({ sum: acc.sum + value, count: acc.count + 1 }),
        result: (_acc) => {
          throw new Error("Result calculation failed!");
        },
      });

      expect(() => {
        db.prepare("SELECT error_avg(value) as average FROM test_data").get();
      }).toThrow();
    });

    test("aggregate inverse throwing error should not segfault", () => {
      db.exec("CREATE TABLE window_test (x INTEGER, y INTEGER)");
      db.exec(
        "INSERT INTO window_test VALUES (1, 10), (2, 20), (3, 30), (4, 40)",
      );

      db.aggregate("error_window_sum", {
        start: 0,
        step: (acc, value) => acc + value,
        inverse: (_acc, _value) => {
          throw new Error("Inverse calculation failed!");
        },
      });

      expect(() => {
        db.prepare(
          `
          SELECT x, error_window_sum(y) OVER (
            ORDER BY x ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
          ) as rolling_sum
          FROM window_test
        `,
        ).all();
      }).toThrow();
    });
  });

  describe("Backup progress callback", () => {
    test("progress callback throwing error should not crash", async () => {
      const tempDb = new DatabaseSync(":memory:");
      tempDb.exec("CREATE TABLE test (id INTEGER)");
      tempDb.exec("INSERT INTO test VALUES (1), (2), (3)");

      let callCount = 0;

      // Progress callback that throws after first call
      const progressCallback = (_info: any) => {
        callCount++;
        if (callCount > 1) {
          throw new Error("Progress callback error!");
        }
      };

      // Backup should complete successfully despite error in progress callback
      await expect(
        backup(tempDb, ":memory:", {
          progress: progressCallback,
          rate: 1, // Small rate to ensure multiple progress calls
        }),
      ).resolves.toBeGreaterThan(0);

      // The backup might complete in one batch for small databases
      expect(callCount).toBeGreaterThanOrEqual(1);
      tempDb.close();
    });
  });

  describe("Edge cases", () => {
    test("function called after database closed should not segfault", () => {
      const tempDb = new DatabaseSync(":memory:");
      tempDb.function("test_func", () => "hello");

      // Verify function works
      const result = tempDb.prepare("SELECT test_func() as result").get();
      expect(result.result).toBe("hello");

      // Close database
      tempDb.close();

      // Try to use function on closed database - should throw, not segfault
      expect(() => {
        tempDb.function("another_func", () => "world");
      }).toThrow();
    });

    test("recursive function calls should handle errors", () => {
      let depth = 0;
      db.function("recursive_func", (n: number): number => {
        depth++;
        if (depth > 5) {
          throw new Error("Recursion too deep!");
        }
        if (n <= 0) {
          return 0;
        }
        // Call ourselves through SQL
        const result = db
          .prepare("SELECT recursive_func(?) as result")
          .get(n - 1);
        return n + result.result;
      });

      // Reset depth counter
      depth = 0;

      // This should work (depth = 4)
      const result1 = db.prepare("SELECT recursive_func(3) as result").get();
      expect(result1.result).toBe(6); // 3 + 2 + 1 + 0

      // Reset depth counter
      depth = 0;

      // This should throw (depth would be > 5)
      expect(() => {
        db.prepare("SELECT recursive_func(10) as result").get();
      }).toThrow(); // Just verify that an error is thrown
    });
  });
});
