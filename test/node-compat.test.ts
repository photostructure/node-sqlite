/**
 * Node.js Compatibility Tests
 *
 * Tests converted from Node.js SQLite test suite to verify compatibility.
 *
 * ✅ Tests that pass show our implementation is compatible
 * ⚠️  Tests marked .skip document known differences from Node.js that could be addressed
 *
 * Source: https://github.com/nodejs/node/blob/main/test/parallel/test-sqlite-custom-functions.js
 */

import { DatabaseSync } from "../src";

describe("Node.js Compatibility: Custom Functions", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  // ✅ Core functionality that works identically to Node.js
  describe("Core Functionality (Compatible)", () => {
    test("useBigIntArguments: converts arguments to BigInts when true", () => {
      let value: any;
      const result = db.function(
        "custom",
        { useBigIntArguments: true },
        (arg: any) => {
          value = arg;
        },
      );
      expect(result).toBeUndefined();
      db.prepare("SELECT custom(5) AS custom").get();
      expect(value).toBe(5n);
    });

    test("useBigIntArguments: uses number primitives when false", () => {
      let value: any;
      db.function("custom", { useBigIntArguments: false }, (arg: any) => {
        value = arg;
      });
      db.prepare("SELECT custom(5) AS custom").get();
      expect(value).toBe(5);
    });

    test("useBigIntArguments: defaults to false", () => {
      let value: any;
      db.function("custom", (arg: any) => {
        value = arg;
      });
      db.prepare("SELECT custom(5) AS custom").get();
      expect(value).toBe(5);
    });

    test("varargs: supports variable number of arguments when true", () => {
      let value: any;
      db.function("custom", { varargs: true }, (...args: any[]) => {
        value = args;
      });
      db.prepare("SELECT custom(5, 4, 3, 2, 1) AS custom").get();
      expect(value).toEqual([5, 4, 3, 2, 1]);
    });

    test("varargs: uses function.length when false", () => {
      let value: any;
      db.function("custom", { varargs: false }, (a: any, b: any, c: any) => {
        value = [a, b, c];
      });
      db.prepare("SELECT custom(1, 2, 3) AS custom").get();
      expect(value).toEqual([1, 2, 3]);
    });

    test("varargs: defaults to false", () => {
      let value: any;
      db.function("custom", (a: any, b: any, c: any) => {
        value = [a, b, c];
      });
      db.prepare("SELECT custom(7, 8, 9) AS custom").get();
      expect(value).toEqual([7, 8, 9]);
    });

    test("varargs: throws if incorrect number of arguments provided", () => {
      db.function("custom", (a: any, b: any, c: any, d: any) => {});
      expect(() => {
        db.prepare("SELECT custom(1, 2, 3) AS custom").get();
      }).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            /wrong number of arguments to function custom\(\)/,
          ),
        }),
      );
    });

    test("deterministic: creates deterministic function when true", () => {
      db.function("isDeterministic", { deterministic: true }, () => 42);
      const result = db.exec(`
        CREATE TABLE t1 (
          a INTEGER PRIMARY KEY,
          b INTEGER GENERATED ALWAYS AS (isDeterministic()) VIRTUAL
        )
      `);
      expect(result).toBeUndefined();
    });

    test("deterministic: creates non-deterministic function when false", () => {
      db.function("isNonDeterministic", { deterministic: false }, () => 42);
      expect(() => {
        db.exec(`
          CREATE TABLE t1 (
            a INTEGER PRIMARY KEY,
            b INTEGER GENERATED ALWAYS AS (isNonDeterministic()) VIRTUAL
          )
        `);
      }).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            /non-deterministic functions prohibited in generated columns/,
          ),
        }),
      );
    });

    test("directOnly: sets SQLite direct only flag when true", () => {
      db.function("fn", { deterministic: true, directOnly: true }, () => 42);
      expect(() => {
        db.exec(`
          CREATE TABLE t1 (
            a INTEGER PRIMARY KEY,
            b INTEGER GENERATED ALWAYS AS (fn()) VIRTUAL
          )
        `);
      }).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/unsafe use of fn\(\)/),
        }),
      );
    });

    test("propagates JavaScript errors", () => {
      const err = new Error("boom");
      db.function("throws", () => {
        throw err;
      });
      const stmt = db.prepare("SELECT throws()");
      expect(() => {
        stmt.get();
      }).toThrow(err);
    });
  });

  // Issues and differences from Node.js
  describe("Issues and Differences from Node.js", () => {
    test("✅ FIXED: BigInt range validation now working", () => {
      // ✅ FIXED: Our implementation now properly throws for unsafe numbers
      // Node.js: Throws ERR_OUT_OF_RANGE for numbers > MAX_SAFE_INTEGER
      const value = Number.MAX_SAFE_INTEGER + 1;
      db.function("custom", (arg: any) => {
        // This should never be called due to range validation
        fail("Function should not be called with unsafe numbers");
      });

      // Now correctly throws like Node.js does
      expect(() => {
        db.prepare(`SELECT custom(${value}) AS custom`).get();
      }).toThrow(
        /Value is too large to be represented as a JavaScript number: 9007199254740992/,
      );
    });

    test("⚠️ Minor: Argument validation messages differ", () => {
      // Our implementation: "Expected at least 2 arguments: name and function"
      // Node.js: "The "name" argument must be a string"
      expect(() => {
        (db as any).function();
      }).toThrow(/Expected at least 2 arguments/); // Our current message
    });

    test("⚠️ Minor: Option validation is less strict", () => {
      // Our implementation: Accepts null options gracefully
      // Node.js: Validates options parameter type strictly
      expect(() => {
        (db as any).function("foo", null, () => {});
      }).not.toThrow(); // We accept null options

      expect(() => {
        (db as any).function("foo", { useBigIntArguments: null }, () => {});
      }).not.toThrow(); // We don't validate option types
    });

    test("✅ Binary data format is actually compatible", () => {
      // Testing shows our implementation returns Uint8Array correctly
      db.function("getBinary", () => new Uint8Array([1, 2, 3]));
      const result = db.prepare("SELECT getBinary() as data").get();
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.data)).toEqual([1, 2, 3]);
    });

    test("⚠️ Minor: Error message capitalization differs", () => {
      // Our implementation: "Database is not open"
      // Node.js: "database is not open" (lowercase)
      const closedDb = new DatabaseSync(":memory:");
      closedDb.close();
      expect(() => {
        closedDb.function("foo", () => {});
      }).toThrow(/Database is not open/); // Our current message (capitalized)
    });
  });

  test("basic argument types work correctly", () => {
    let receivedArgs: any[] = [];
    db.function("testArgs", (i: any, f: any, s: any, n: any) => {
      receivedArgs = [i, f, s, n];
      return 42;
    });

    const stmt = db.prepare("SELECT testArgs(5, 3.14, 'foo', null) as result");
    const result = stmt.get();

    expect(receivedArgs[0]).toBe(5); // integer
    expect(receivedArgs[1]).toBeCloseTo(3.14); // float
    expect(receivedArgs[2]).toBe("foo"); // string
    expect(receivedArgs[3]).toBe(null); // null
    expect(result.result).toBe(42);
  });
});
