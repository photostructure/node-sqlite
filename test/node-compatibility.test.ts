import {
  DatabaseSync as OurDatabaseSync,
  constants as ourConstants,
} from "../src";

/**
 * Node.js Compatibility Tests
 *
 * This test file compares our implementation with Node.js's built-in node:sqlite module.
 *
 * IMPORTANT:
 * - These tests require Node.js 24+ with the --experimental-sqlite flag
 * - The node:sqlite comparison tests only work in CommonJS mode (not ESM)
 * - Run with: NODE_OPTIONS="--experimental-sqlite" npm run test:cjs -- test/node-compatibility.test.ts
 *
 * The tests will automatically skip node:sqlite comparisons if:
 * - Running on Node.js < 24
 * - The --experimental-sqlite flag is not set
 * - Running in ESM mode
 */

// Try to import Node.js built-in SQLite if available
let NodeSqlite: any = null;
let nodeAvailable = false;

// Check Node.js version - only run on Node.js 24+ where node:sqlite is available
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split(".")[0].substring(1), 10);
const hasNodeSqlite = majorVersion >= 24;

if (hasNodeSqlite) {
  try {
    // Use dynamic import for ESM compatibility, with fallback to require for CJS
    if (typeof require !== "undefined") {
      // CommonJS environment
      NodeSqlite = require("node:sqlite");
      nodeAvailable = true;
    } else {
      // ESM environment - would need top-level await or async test setup
      console.log(
        "node:sqlite compatibility tests not supported in ESM mode yet",
      );
      nodeAvailable = false;
    }
  } catch {
    console.log(
      "Node.js built-in SQLite not available - needs --experimental-sqlite flag",
    );
    nodeAvailable = false;
  }
} else {
  console.log(
    `Skipping node:sqlite compatibility tests - requires Node.js 24+ (current: ${nodeVersion})`,
  );
  nodeAvailable = false;
}

describe("Node.js API Compatibility Tests", () => {
  const describeNodeTests = nodeAvailable ? describe : describe.skip;

  describe("API Surface Comparison", () => {
    test("our module exports match expected Node.js API", () => {
      // Test our exports regardless of Node.js availability
      expect(OurDatabaseSync).toBeDefined();
      expect(typeof OurDatabaseSync).toBe("function");
      expect(ourConstants).toBeDefined();
      expect(typeof ourConstants).toBe("object");

      // Check that the most important constants exist
      const essentialConstants = [
        "SQLITE_OPEN_READONLY",
        "SQLITE_OPEN_READWRITE",
        "SQLITE_OPEN_CREATE",
      ];

      essentialConstants.forEach((constant) => {
        expect(ourConstants).toHaveProperty(constant);
        expect(typeof (ourConstants as any)[constant]).toBe("number");
      });

      // Check that we have some constants (our implementation may have different sets)
      const constantKeys = Object.keys(ourConstants);
      expect(constantKeys.length).toBeGreaterThan(0);
      expect(constantKeys).toContain("SQLITE_OPEN_READONLY");
      expect(constantKeys).toContain("SQLITE_OPEN_READWRITE");
      expect(constantKeys).toContain("SQLITE_OPEN_CREATE");
    });

    test("DatabaseSync class has expected methods", () => {
      const db = new OurDatabaseSync(":memory:");

      // Check instance methods
      expect(typeof db.close).toBe("function");
      expect(typeof db.exec).toBe("function");
      expect(typeof db.prepare).toBe("function");
      expect(typeof db.backup).toBe("function");
      expect(typeof db.function).toBe("function");
      expect(typeof db.aggregate).toBe("function");
      expect(typeof db.createSession).toBe("function");
      expect(typeof db.applyChangeset).toBe("function");
      expect(typeof db.enableLoadExtension).toBe("function");
      expect(typeof db.loadExtension).toBe("function");

      // Check properties
      expect(typeof db.isOpen).toBe("boolean");
      expect(typeof db.location).toBe("function");
      expect(typeof db.isTransaction).toBe("boolean");

      db.close();
    });

    test("StatementSync class has expected methods", () => {
      const db = new OurDatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER, name TEXT)");

      const stmt = db.prepare("SELECT * FROM test WHERE id = ?");

      // Check statement methods
      expect(typeof stmt.get).toBe("function");
      expect(typeof stmt.all).toBe("function");
      expect(typeof stmt.run).toBe("function");
      expect(typeof stmt.iterate).toBe("function");
      expect(typeof stmt.columns).toBe("function");
      expect(typeof stmt.setReadBigInts).toBe("function");
      expect(typeof stmt.setReturnArrays).toBe("function");
      expect(typeof stmt.setAllowBareNamedParameters).toBe("function");

      // Check properties
      expect(typeof stmt.sourceSQL).toBe("string");

      db.close();
    });
  });

  // Tests that run against both implementations when node:sqlite is available
  describeNodeTests("Behavior Comparison with Node.js Built-in", () => {
    // Helper to run the same test against both implementations
    function testBothImplementations(
      name: string,
      testFn: (DatabaseSync: any, _implName: string) => void,
    ) {
      test(name, () => {
        // Always test our implementation
        testFn(OurDatabaseSync, "@photostructure/sqlite");

        // Test Node.js implementation if available
        if (nodeAvailable && NodeSqlite?.DatabaseSync) {
          testFn(NodeSqlite.DatabaseSync, "node:sqlite");
        }
      });
    }

    testBothImplementations(
      "basic database operations",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Test basic operations
        const createTableSQL =
          "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value REAL)";
        db.exec(createTableSQL);

        const insertSQL = "INSERT INTO test (name, value) VALUES (?, ?)";
        const stmt = db.prepare(insertSQL);

        // Insert data
        const testData = [
          ["Alice", 1.5],
          ["Bob", 2.7],
          ["Charlie", 3.14],
        ];

        testData.forEach(([name, value]) => {
          const result = stmt.run(name, value);
          expect(typeof result.changes).toBe("number");
          expect(result.changes).toBe(1);
          expect(typeof result.lastInsertRowid).toMatch(/^(number|bigint)$/);
        });

        // Test queries
        const selectSQL = "SELECT * FROM test ORDER BY id";
        const selectStmt = db.prepare(selectSQL);
        const results = selectStmt.all();

        expect(results.length).toBe(3);
        results.forEach((row: any, index: number) => {
          expect(row.name).toBe(testData[index][0]);
          expect(row.value).toBe(testData[index][1]);
        });

        db.close();
      },
    );

    testBothImplementations("error handling", (DatabaseSync, _implName) => {
      const db = new DatabaseSync(":memory:");

      // Test syntax errors
      const invalidSQL = "INVALID SQL STATEMENT";
      expect(() => {
        db.exec(invalidSQL);
      }).toThrow(/syntax/i);

      db.close();
    });

    testBothImplementations(
      "transaction behavior",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Setup table
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

        // Test transaction properties
        expect(db.isTransaction).toBe(false);

        // Start transaction
        db.exec("BEGIN");
        expect(db.isTransaction).toBe(true);

        // Make changes
        db.exec("INSERT INTO test (value) VALUES ('test1')");

        // Rollback
        db.exec("ROLLBACK");
        expect(db.isTransaction).toBe(false);

        // Check that data was rolled back
        const count = db.prepare("SELECT COUNT(*) as count FROM test").get();
        expect(count.count).toBe(0);

        db.close();
      },
    );

    testBothImplementations(
      "prepared statement behavior",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Setup
        db.exec("CREATE TABLE test (id INTEGER, name TEXT, data BLOB)");

        // Test parameter binding
        const insertSQL = "INSERT INTO test VALUES (?, ?, ?)";
        const stmt = db.prepare(insertSQL);

        const testBuffer = Buffer.from("test data", "utf8");
        const result = stmt.run(1, "test", testBuffer);

        expect(result.changes).toBe(1);

        // Test different data types
        const selectSQL = "SELECT * FROM test WHERE id = ?";
        const selectStmt = db.prepare(selectSQL);
        const row = selectStmt.get(1);

        expect(row.id).toBe(1);
        expect(row.name).toBe("test");

        // BLOB data should be preserved
        if (Buffer.isBuffer(row.data)) {
          expect(row.data.toString()).toBe("test data");
        } else if (row.data instanceof Uint8Array) {
          expect(Buffer.from(row.data).toString()).toBe("test data");
        }

        db.close();
      },
    );

    // Custom functions tests from node-compat.test.ts
    testBothImplementations(
      "custom functions - basic functionality",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Basic function
        db.function("double", (x: number) => x * 2);
        const result = db.prepare("SELECT double(21) as result").get();
        expect(result.result).toBe(42);

        // Function with multiple arguments
        db.function("add_numbers", (a: number, b: number) => a + b);
        const addResult = db
          .prepare("SELECT add_numbers(10, 32) as result")
          .get();
        expect(addResult.result).toBe(42);

        db.close();
      },
    );

    testBothImplementations(
      "custom functions - useBigIntArguments",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Test with useBigIntArguments: true
        let value: any;
        db.function("custom", { useBigIntArguments: true }, (arg: any) => {
          value = arg;
        });
        db.prepare("SELECT custom(5) AS custom").get();
        expect(value).toBe(5n);

        // Test with useBigIntArguments: false (default)
        db.function("custom2", (arg: any) => {
          value = arg;
        });
        db.prepare("SELECT custom2(5) AS custom").get();
        expect(value).toBe(5);

        db.close();
      },
    );

    testBothImplementations(
      "custom functions - varargs",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Test with varargs: true
        let value: any;
        db.function("custom", { varargs: true }, (...args: any[]) => {
          value = args;
        });
        db.prepare("SELECT custom(5, 4, 3, 2, 1) AS custom").get();
        expect(value).toEqual([5, 4, 3, 2, 1]);

        // Test with varargs: false (default) - uses function.length
        db.function("custom2", (a: any, b: any, c: any) => {
          value = [a, b, c];
        });
        db.prepare("SELECT custom2(7, 8, 9) AS custom").get();
        expect(value).toEqual([7, 8, 9]);

        // Test error when wrong number of arguments
        db.function("fixed", () => {});
        expect(() => {
          db.prepare("SELECT fixed(1, 2, 3) AS result").get();
        }).toThrow(/wrong number of arguments/);

        db.close();
      },
    );

    testBothImplementations(
      "custom functions - deterministic",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        // Deterministic functions can be used in generated columns
        db.function("isDeterministic", { deterministic: true }, () => 42);
        expect(() => {
          db.exec(`
            CREATE TABLE t1 (
              a INTEGER PRIMARY KEY,
              b INTEGER GENERATED ALWAYS AS (isDeterministic()) VIRTUAL
            )
          `);
        }).not.toThrow();

        // Non-deterministic functions cannot
        db.function("isNonDeterministic", { deterministic: false }, () => 42);
        expect(() => {
          db.exec(`
            CREATE TABLE t2 (
              a INTEGER PRIMARY KEY,
              b INTEGER GENERATED ALWAYS AS (isNonDeterministic()) VIRTUAL
            )
          `);
        }).toThrow(/non-deterministic functions prohibited/);

        db.close();
      },
    );

    testBothImplementations(
      "custom functions - error propagation",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        const err = new Error("boom");
        db.function("throws", () => {
          throw err;
        });

        const stmt = db.prepare("SELECT throws()");
        expect(() => {
          stmt.get();
        }).toThrow(err);

        db.close();
      },
    );

    testBothImplementations(
      "custom functions - data type handling",
      (DatabaseSync, _implName) => {
        const db = new DatabaseSync(":memory:");

        let receivedArgs: any[] = [];
        db.function("testArgs", (i: any, f: any, s: any, n: any) => {
          receivedArgs = [i, f, s, n];
          return 42;
        });

        const stmt = db.prepare(
          "SELECT testArgs(5, 3.14, 'foo', null) as result",
        );
        const result = stmt.get();

        expect(receivedArgs[0]).toBe(5); // integer
        expect(receivedArgs[1]).toBeCloseTo(3.14); // float
        expect(receivedArgs[2]).toBe("foo"); // string
        expect(receivedArgs[3]).toBe(null); // null
        expect(result.result).toBe(42);

        // Test binary data
        db.function("getBinary", () => new Uint8Array([1, 2, 3]));
        const binaryResult = db.prepare("SELECT getBinary() as data").get();
        expect(binaryResult.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(binaryResult.data)).toEqual([1, 2, 3]);

        db.close();
      },
    );

    // Direct comparison tests when both implementations are available
    if (nodeAvailable && NodeSqlite?.DatabaseSync) {
      test("constants match between implementations", () => {
        const nodeConstants = NodeSqlite.constants;

        // Check that common constants have the same values
        const commonConstants = [
          "SQLITE_OPEN_READONLY",
          "SQLITE_OPEN_READWRITE",
          "SQLITE_OPEN_CREATE",
        ];

        commonConstants.forEach((constant) => {
          if (
            Object.prototype.hasOwnProperty.call(ourConstants, constant) &&
            Object.prototype.hasOwnProperty.call(nodeConstants, constant)
          ) {
            expect((ourConstants as any)[constant]).toBe(
              (nodeConstants as any)[constant],
            );
          }
        });
      });

      test("side-by-side operation comparison", () => {
        const ourDb = new OurDatabaseSync(":memory:");
        const nodeDb = new NodeSqlite.DatabaseSync(":memory:");

        // Run identical operations
        const sql = "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)";
        ourDb.exec(sql);
        nodeDb.exec(sql);

        const insertStmt = "INSERT INTO test (value) VALUES (?)";
        const ourStmt = ourDb.prepare(insertStmt);
        const nodeStmt = nodeDb.prepare(insertStmt);

        // Insert same data
        for (let i = 0; i < 5; i++) {
          const ourResult = ourStmt.run(`value_${i}`);
          const nodeResult = nodeStmt.run(`value_${i}`);

          expect(ourResult.changes).toBe(nodeResult.changes);
          expect(Number(ourResult.lastInsertRowid)).toBe(
            Number(nodeResult.lastInsertRowid),
          );
        }

        // Query and compare results
        const ourResults = ourDb.prepare("SELECT * FROM test").all();
        const nodeResults = nodeDb.prepare("SELECT * FROM test").all();

        expect(ourResults).toEqual(nodeResults);

        ourDb.close();
        nodeDb.close();
      });
    }
  });

  describe("Extended Features (Our Implementation)", () => {
    test("aggregate functions work correctly", () => {
      const db = new OurDatabaseSync(":memory:");

      // Test aggregate function
      db.exec("CREATE TABLE numbers (n INTEGER)");
      db.exec("INSERT INTO numbers VALUES (1), (2), (3), (4), (5)");

      db.aggregate("my_sum", {
        start: 0,
        step: (acc: number, val: number) => acc + val,
      });

      const sumResult = db
        .prepare("SELECT my_sum(n) as total FROM numbers")
        .get();
      expect(sumResult.total).toBe(15);

      db.close();
    });

    test("backup functionality exists", async () => {
      const db = new OurDatabaseSync(":memory:");

      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");
      db.exec("INSERT INTO test VALUES (1, 'test data')");

      // Test backup method exists
      expect(typeof db.backup).toBe("function");

      // For in-memory databases, backup may have limitations
      await db.backup(":memory:");

      db.close();
    });

    test("session functionality exists", () => {
      const db = new OurDatabaseSync(":memory:");

      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

      const session = db.createSession();
      expect(session).toBeDefined();

      // Make changes
      db.exec("INSERT INTO test VALUES (1, 'original')");
      db.exec("UPDATE test SET value = 'modified' WHERE id = 1");

      // Generate changeset
      const changeset = session.changeset();
      expect(Buffer.isBuffer(changeset)).toBe(true);

      session.close();
      db.close();
    });
  });

  describe("Performance Characteristics", () => {
    test("basic operations complete within reasonable time", () => {
      const db = new OurDatabaseSync(":memory:");

      const startTime = Date.now();

      // Setup table
      db.exec("CREATE TABLE perf_test (id INTEGER PRIMARY KEY, data TEXT)");

      // Insert many records
      const stmt = db.prepare("INSERT INTO perf_test (data) VALUES (?)");

      db.exec("BEGIN");
      for (let i = 0; i < 1000; i++) {
        stmt.run(`data_${i}`);
      }
      db.exec("COMMIT");

      // Query records
      const selectStmt = db.prepare("SELECT COUNT(*) as count FROM perf_test");
      const result = selectStmt.get();
      expect(result.count).toBe(1000);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000); // 1 second

      console.log(`Performance test completed in ${duration}ms`);

      db.close();
    });

    test("large result sets are handled efficiently", () => {
      const db = new OurDatabaseSync(":memory:");

      db.exec(
        "CREATE TABLE large_test (id INTEGER PRIMARY KEY, value INTEGER)",
      );

      // Insert 10k records
      const stmt = db.prepare("INSERT INTO large_test (value) VALUES (?)");

      const startInsert = Date.now();
      db.exec("BEGIN");
      for (let i = 0; i < 10000; i++) {
        stmt.run(i * 2);
      }
      db.exec("COMMIT");
      const insertTime = Date.now() - startInsert;

      // Query all records
      const startQuery = Date.now();
      const selectStmt = db.prepare("SELECT * FROM large_test ORDER BY id");
      const results = selectStmt.all();
      const queryTime = Date.now() - startQuery;

      expect(results.length).toBe(10000);
      expect(results[0].value).toBe(0);
      expect(results[9999].value).toBe(19998);

      // Performance should be reasonable
      expect(insertTime).toBeLessThan(2000); // 2 seconds for inserts
      expect(queryTime).toBeLessThan(1000); // 1 second for query

      console.log(
        `Large dataset test: ${insertTime}ms insert, ${queryTime}ms query`,
      );

      db.close();
    });
  });
});
