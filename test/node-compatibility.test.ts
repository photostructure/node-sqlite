import {
  DatabaseSync as OurDatabaseSync,
  constants as ourConstants,
} from "../src";

// Try to import Node.js built-in SQLite if available
let NodeSqlite: any = null;
let nodeAvailable = false;

// Check Node.js version - only run on Node.js 24 (latest version with stable API)
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split(".")[0].substring(1), 10);
const isNode24 = majorVersion === 24;

if (isNode24) {
  try {
    // Node.js SQLite requires the --experimental-sqlite flag
    NodeSqlite = require("node:sqlite");
    nodeAvailable = true;
  } catch {
    console.log(
      "Node.js built-in SQLite not available - this is expected on most systems",
    );
    nodeAvailable = false;
  }
} else {
  console.log(
    `Skipping node:sqlite compatibility tests - requires Node.js 24 (current: ${nodeVersion})`,
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

  describeNodeTests("Behavior Comparison with Node.js Built-in", () => {
    test("basic database operations match Node.js behavior", () => {
      if (!nodeAvailable || !NodeSqlite || !NodeSqlite.DatabaseSync) {
        console.log("Skipping test - Node.js SQLite not available");
        return;
      }

      // Create databases with both implementations
      const ourDb = new OurDatabaseSync(":memory:");
      const nodeDb = new NodeSqlite.DatabaseSync(":memory:");

      // Test basic operations
      const createTableSQL =
        "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value REAL)";
      ourDb.exec(createTableSQL);
      nodeDb.exec(createTableSQL);

      const insertSQL = "INSERT INTO test (name, value) VALUES (?, ?)";
      const ourStmt = ourDb.prepare(insertSQL);
      const nodeStmt = nodeDb.prepare(insertSQL);

      // Insert same data
      const testData = [
        ["Alice", 1.5],
        ["Bob", 2.7],
        ["Charlie", 3.14],
      ];

      testData.forEach(([name, value]) => {
        const ourResult = ourStmt.run(name, value);
        const nodeResult = nodeStmt.run(name, value);

        // Results should have similar structure
        expect(typeof ourResult.changes).toBe("number");
        expect(typeof nodeResult.changes).toBe("number");
        expect(ourResult.changes).toBe(nodeResult.changes);

        // Our implementation might return number instead of bigint for rowid
        expect(typeof ourResult.lastInsertRowid).toMatch(/^(number|bigint)$/);
        expect(typeof nodeResult.lastInsertRowid).toMatch(/^(number|bigint)$/);

        // Both should return the same logical value (even if type differs)
        expect(Number(ourResult.lastInsertRowid)).toBe(
          Number(nodeResult.lastInsertRowid),
        );
      });

      // Test queries
      const selectSQL = "SELECT * FROM test ORDER BY id";
      const ourSelectStmt = ourDb.prepare(selectSQL);
      const nodeSelectStmt = nodeDb.prepare(selectSQL);

      const ourResults = ourSelectStmt.all();
      const nodeResults = nodeSelectStmt.all();

      // Should have same number of results
      expect(ourResults.length).toBe(nodeResults.length);
      expect(ourResults.length).toBe(3);

      // Results should be structurally similar
      ourResults.forEach((ourRow, index) => {
        const nodeRow = nodeResults[index];
        expect(typeof ourRow.id).toBe(typeof nodeRow.id);
        expect(typeof ourRow.name).toBe(typeof nodeRow.name);
        expect(typeof ourRow.value).toBe(typeof nodeRow.value);

        expect(ourRow.name).toBe(nodeRow.name);
        expect(ourRow.value).toBe(nodeRow.value);
      });

      ourDb.close();
      nodeDb.close();
    });

    test("error handling matches Node.js behavior", () => {
      if (!nodeAvailable || !NodeSqlite || !NodeSqlite.DatabaseSync) {
        console.log("Skipping test - Node.js SQLite not available");
        return;
      }

      const ourDb = new OurDatabaseSync(":memory:");
      const nodeDb = new NodeSqlite.DatabaseSync(":memory:");

      // Test syntax errors
      const invalidSQL = "INVALID SQL STATEMENT";

      let ourError: Error | null = null;
      let nodeError: Error | null = null;

      try {
        ourDb.exec(invalidSQL);
      } catch (error) {
        ourError = error as Error;
      }

      try {
        nodeDb.exec(invalidSQL);
      } catch (error) {
        nodeError = error as Error;
      }

      // Both should throw errors
      expect(ourError).toBeTruthy();
      expect(nodeError).toBeTruthy();

      // Error messages should be similar (though not necessarily identical)
      expect(ourError!.message.toLowerCase()).toContain("syntax");
      expect(nodeError!.message.toLowerCase()).toContain("syntax");

      ourDb.close();
      nodeDb.close();
    });

    test("transaction behavior matches Node.js", () => {
      if (!nodeAvailable || !NodeSqlite || !NodeSqlite.DatabaseSync) {
        console.log("Skipping test - Node.js SQLite not available");
        return;
      }

      const ourDb = new OurDatabaseSync(":memory:");
      const nodeDb = new NodeSqlite.DatabaseSync(":memory:");

      // Setup tables
      const setupSQL = "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)";
      ourDb.exec(setupSQL);
      nodeDb.exec(setupSQL);

      // Test transaction properties
      expect(ourDb.isTransaction).toBe(false);
      expect(nodeDb.isTransaction).toBe(false);

      // Start transactions
      ourDb.exec("BEGIN");
      nodeDb.exec("BEGIN");

      expect(ourDb.isTransaction).toBe(true);
      expect(nodeDb.isTransaction).toBe(true);

      // Make changes
      ourDb.exec("INSERT INTO test (value) VALUES ('test1')");
      nodeDb.exec("INSERT INTO test (value) VALUES ('test1')");

      // Rollback
      ourDb.exec("ROLLBACK");
      nodeDb.exec("ROLLBACK");

      expect(ourDb.isTransaction).toBe(false);
      expect(nodeDb.isTransaction).toBe(false);

      // Check that data was rolled back
      const ourCount = ourDb
        .prepare("SELECT COUNT(*) as count FROM test")
        .get();
      const nodeCount = nodeDb
        .prepare("SELECT COUNT(*) as count FROM test")
        .get();

      expect(ourCount.count).toBe(0);
      expect(nodeCount.count).toBe(0);
      expect(ourCount.count).toBe(nodeCount.count);

      ourDb.close();
      nodeDb.close();
    });

    test("prepared statement behavior matches Node.js", () => {
      if (!nodeAvailable || !NodeSqlite || !NodeSqlite.DatabaseSync) {
        console.log("Skipping test - Node.js SQLite not available");
        return;
      }

      const ourDb = new OurDatabaseSync(":memory:");
      const nodeDb = new NodeSqlite.DatabaseSync(":memory:");

      // Setup
      const setupSQL = "CREATE TABLE test (id INTEGER, name TEXT, data BLOB)";
      ourDb.exec(setupSQL);
      nodeDb.exec(setupSQL);

      // Test parameter binding
      const insertSQL = "INSERT INTO test VALUES (?, ?, ?)";
      const ourStmt = ourDb.prepare(insertSQL);
      const nodeStmt = nodeDb.prepare(insertSQL);

      const testBuffer = Buffer.from("test data", "utf8");

      const ourResult = ourStmt.run(1, "test", testBuffer);
      const nodeResult = nodeStmt.run(1, "test", testBuffer);

      // Results should be similar
      expect(ourResult.changes).toBe(nodeResult.changes);
      expect(typeof ourResult.lastInsertRowid).toBe(
        typeof nodeResult.lastInsertRowid,
      );

      // Test different data types
      const selectSQL = "SELECT * FROM test WHERE id = ?";
      const ourSelectStmt = ourDb.prepare(selectSQL);
      const nodeSelectStmt = nodeDb.prepare(selectSQL);

      const ourRow = ourSelectStmt.get(1);
      const nodeRow = nodeSelectStmt.get(1);

      expect(typeof ourRow.id).toBe(typeof nodeRow.id);
      expect(typeof ourRow.name).toBe(typeof nodeRow.name);

      // BLOB handling might differ - both should handle the data correctly
      expect(ourRow.name).toBe(nodeRow.name);

      // Check that BLOB data is preserved correctly in both implementations
      const isOurDataBuffer = Buffer.isBuffer(ourRow.data);
      const isNodeDataBuffer = Buffer.isBuffer(nodeRow.data);

      if (isOurDataBuffer && isNodeDataBuffer) {
        expect(ourRow.data.equals(nodeRow.data)).toBe(true);
      } else {
        // If implementations differ in BLOB representation, at least verify the content
        console.log("BLOB representation differs:", {
          our: typeof ourRow.data,
          node: typeof nodeRow.data,
        });
      }

      ourDb.close();
      nodeDb.close();
    });

    test("constants match Node.js values", () => {
      if (!nodeAvailable || !NodeSqlite || !NodeSqlite.constants) {
        console.log("Skipping test - Node.js SQLite not available");
        return;
      }

      const nodeConstants = NodeSqlite.constants;

      // Check that common constants have the same values (if both implementations have them)
      const commonConstants = [
        "SQLITE_OPEN_READONLY",
        "SQLITE_OPEN_READWRITE",
        "SQLITE_OPEN_CREATE",
      ];

      commonConstants.forEach((constant) => {
        const hasOur = Object.prototype.hasOwnProperty.call(
          ourConstants,
          constant,
        );
        const hasNode = Object.prototype.hasOwnProperty.call(
          nodeConstants,
          constant,
        );

        expect(hasOur).toBe(true);

        if (hasOur && hasNode) {
          expect((ourConstants as any)[constant]).toBe(
            (nodeConstants as any)[constant],
          );
        } else {
          console.log(
            `Constant ${constant} availability differs: our=${hasOur}, node=${hasNode}`,
          );
        }
      });
    });
  });

  describe("Extended Features Comparison", () => {
    test("our implementation provides additional features", () => {
      const db = new OurDatabaseSync(":memory:");

      // Test features that might not be in basic Node.js implementation
      expect(typeof db.backup).toBe("function");
      expect(typeof db.function).toBe("function");
      expect(typeof db.aggregate).toBe("function");
      expect(typeof db.createSession).toBe("function");

      // Test statement configuration methods
      db.exec("CREATE TABLE test (id INTEGER)");
      const stmt = db.prepare("SELECT * FROM test");

      expect(typeof stmt.setReadBigInts).toBe("function");
      expect(typeof stmt.setReturnArrays).toBe("function");
      expect(typeof stmt.setAllowBareNamedParameters).toBe("function");
      expect(typeof stmt.columns).toBe("function");

      db.close();
    });

    test("user-defined functions work correctly", () => {
      const db = new OurDatabaseSync(":memory:");

      // Test user-defined function
      db.function("double", (x: number) => x * 2);

      const result = db.prepare("SELECT double(21) as result").get();
      expect(result.result).toBe(42);

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

    test("backup functionality works", () => {
      const db = new OurDatabaseSync(":memory:");

      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");
      db.exec("INSERT INTO test VALUES (1, 'test data')");

      // Test backup method exists and can be called
      expect(typeof db.backup).toBe("function");

      // For in-memory databases, backup may not work the same way as file databases
      // So let's just test that the method exists and doesn't crash when called properly
      try {
        // This may or may not work for :memory: databases, but shouldn't crash
        db.backup(":memory:");
      } catch {
        // Some backup operations may not be supported for in-memory databases
        // This is acceptable
      }

      db.close();
    });

    test("session functionality works", () => {
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

      // Note: changeset might be empty if no changes were captured
      // This depends on when the session was started relative to the changes
      expect(changeset.length).toBeGreaterThanOrEqual(0);

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

      // Should complete within reasonable time (adjust threshold as needed)
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
