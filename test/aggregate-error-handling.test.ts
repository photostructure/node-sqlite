import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { DatabaseSync } from "../src";
import { getTestTimeout, projectRoot } from "./test-utils";

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
}

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

  test.each([
    ["an object", {}],
    ["a Buffer", Buffer.alloc(1)],
  ])("a step error with %s accumulator reaches the caller", (_type, start) => {
    // SQLite calls xFinal after a failed step. Rebuilding an object or Buffer
    // accumulator there ran N-API calls that fail while the step's exception
    // is pending, and node-addon-api's handling of that failure cleared the
    // exception, so get() returned undefined without an error.
    db.aggregate("step_fails", {
      start,
      step: () => {
        throw new Error("step failed");
      },
    });
    expect(() =>
      db.prepare("SELECT step_fails() FROM test_data").get(),
    ).toThrow("step failed");
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

  // The Promise check on a step's result reads `then` through node-addon-api,
  // which throws a C++ exception when the getter throws. That exception
  // unwound through sqlite3_step(); from exec() it also skipped the end of the
  // statement, after which close() failed with "database cannot be closed
  // while in a callback".
  describe.each([
    ["exec()", (sql: string) => db.exec(sql)],
    ["prepare().all()", (sql: string) => db.prepare(sql).all()],
  ])("a result whose then getter throws, through %s", (_name, run) => {
    const thenThrows = (error: Error) => ({
      get then(): never {
        throw error;
      },
    });

    test("from step reaches the caller, and close() succeeds", () => {
      const error = new Error("then getter failed");
      db.aggregate("step_then", {
        start: 0,
        step: (_acc: unknown, _value: unknown) => thenThrows(error),
      });

      expect(
        thrownBy(() => run("SELECT step_then(value) FROM test_data")),
      ).toBe(error);
      expect(db.prepare("SELECT count(*) AS n FROM test_data").get()).toEqual({
        n: 3,
      });
      expect(() => db.close()).not.toThrow();
    });

    test("from inverse reaches the caller, and close() succeeds", () => {
      const error = new Error("then getter failed");
      db.aggregate("inverse_then", {
        start: 0,
        step: (acc: number, value: number) => acc + value,
        inverse: (_acc: unknown, _value: unknown) => thenThrows(error),
      });

      expect(
        thrownBy(() =>
          run(`
            SELECT inverse_then(value) OVER (
              ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
            ) FROM test_data
          `),
        ),
      ).toBe(error);
      expect(db.prepare("SELECT count(*) AS n FROM test_data").get()).toEqual({
        n: 3,
      });
      expect(() => db.close()).not.toThrow();
    });
  });

  // SQLite calls xFinal for a window aggregate that is still accumulating when
  // its statement is finalized, and at exit that happens after JavaScript can
  // no longer run. Rebuilding a Uint8Array accumulator then fails, and
  // node-addon-api's C++ exception aborted the process with "terminate called
  // after throwing an instance of 'Napi::Error'".
  test.each(["the main thread", "a worker"])(
    "exiting %s while a window aggregate is mid-query does not abort",
    (where) => {
      const entry = path.join(projectRoot(), "dist", "index.cjs");
      const query = `
        const { DatabaseSync } = require(${JSON.stringify(entry)});
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE t(x); INSERT INTO t VALUES (1), (2)");
        db.aggregate("bytes", {
          start: null,
          step: (_acc, x) => new Uint8Array([x]),
          inverse: (acc) => acc,
        });
        // Keep the statement until exit, so only teardown finalizes it.
        globalThis.rows = db
          .prepare("SELECT bytes(x) OVER (ROWS UNBOUNDED PRECEDING) FROM t")
          .iterate();
        globalThis.rows.next();
      `;
      const script =
        where === "a worker"
          ? `const { Worker } = require("node:worker_threads");
             new Worker(${JSON.stringify(query)}, { eval: true });`
          : query;

      const result = spawnSync(process.execPath, ["--eval", script], {
        encoding: "utf8",
        timeout: getTestTimeout(),
      });

      expect({
        status: result.status,
        signal: result.signal,
        stderr: result.stderr,
      }).toEqual({ status: 0, signal: null, stderr: "" });
    },
    getTestTimeout(),
  );
});
