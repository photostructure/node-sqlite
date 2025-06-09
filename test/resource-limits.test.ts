import { afterEach, beforeEach, describe, expect, jest } from "@jest/globals";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "../src/index";
import { getTestTimeout } from "./test-utils";

describe("SQLite Resource Limits", () => {
  jest.setTimeout(getTestTimeout());
  let db: InstanceType<typeof DatabaseSync>;

  afterEach(() => {
    if (db && db.isOpen) {
      db.close();
    }
  });

  describe("SQL Statement Length Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle reasonably long SQL statements", () => {
      // Test with a reasonable number of columns
      const columnCount = 100;
      const longSQL = `SELECT ${Array(columnCount).fill("1").join(", ")}`;

      expect(() => {
        db.exec(longSQL);
      }).not.toThrow();
    });

    test("should demonstrate SQL statement length handling", () => {
      // SQLite's default SQL length limit is 1,000,000,000 bytes (1 billion)
      // That's too large to test practically, so let's just verify we can handle large statements
      const largeString = "x".repeat(1024 * 1024); // 1MB string
      const largeSQL = `SELECT '${largeString}' as data`;

      // This should work fine since it's well under the limit
      expect(() => {
        const result = db.prepare(largeSQL).get() as { data: string };
        expect(result.data.length).toBe(1024 * 1024);
      }).not.toThrow();
    });
  });

  describe("Column Count Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle tables with many columns", () => {
      // SQLite's default max columns is 2000
      const columnCount = 100;
      const columns = Array(columnCount)
        .fill(null)
        .map((_, i) => `col${i} TEXT`)
        .join(", ");

      expect(() => {
        db.exec(`CREATE TABLE many_cols (${columns})`);
      }).not.toThrow();
    });

    test("should enforce column count limit", () => {
      // Try to create a table with more than 2000 columns (SQLite default limit)
      const columnCount = 2001;
      const columns = Array(columnCount)
        .fill(null)
        .map((_, i) => `col${i} TEXT`)
        .join(", ");

      expect(() => {
        db.exec(`CREATE TABLE too_many_cols (${columns})`);
      }).toThrow();
    });

    test("should enforce compound SELECT column limit", () => {
      // SQLite has a limit on the number of result columns
      const columnCount = 2001; // Exceeds the 2000 column limit
      const select = Array(columnCount).fill("1").join(", ");

      expect(() => {
        db.exec(`SELECT ${select}`);
      }).toThrow(/too many columns/i);
    });
  });

  describe("Attached Database Limits", () => {
    let tempFiles: string[] = [];

    beforeEach(() => {
      db = new DatabaseSync(":memory:");
      tempFiles = [];
    });

    afterEach(async () => {
      // Wait for Windows file handles to be released
      if (process.platform === "win32") {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Clean up temp files with retries for Windows
      for (const file of tempFiles) {
        if (existsSync(file)) {
          let retries = process.platform === "win32" ? 3 : 1;
          while (retries > 0) {
            try {
              rmSync(file, { force: true });
              break;
            } catch {
              retries--;
              if (retries > 0) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              // Ignore errors on final attempt
            }
          }
        }
      }
    });

    test("should attach multiple databases", () => {
      // Create and attach a few databases
      for (let i = 0; i < 5; i++) {
        const tempFile = join(tmpdir(), `test-attach-${Date.now()}-${i}.db`);
        tempFiles.push(tempFile);

        // Create a database file
        const tempDb = new DatabaseSync(tempFile);
        tempDb.exec(`CREATE TABLE test${i} (id INTEGER)`);
        tempDb.close();

        // Attach it to main database
        expect(() => {
          db.exec(`ATTACH DATABASE '${tempFile}' AS db${i}`);
        }).not.toThrow();
      }
    });

    test("should enforce attached database limit", () => {
      // SQLite's default max attached databases is 10 (plus main = 11 total)
      const attachLimit = 10;

      // Attach databases up to the limit
      for (let i = 0; i < attachLimit; i++) {
        const tempFile = join(
          tmpdir(),
          `test-attach-limit-${Date.now()}-${i}.db`,
        );
        tempFiles.push(tempFile);

        const tempDb = new DatabaseSync(tempFile);
        tempDb.exec(`CREATE TABLE test${i} (id INTEGER)`);
        tempDb.close();

        db.exec(`ATTACH DATABASE '${tempFile}' AS db${i}`);
      }

      // Try to attach one more (should fail)
      const extraFile = join(tmpdir(), `test-attach-extra-${Date.now()}.db`);
      tempFiles.push(extraFile);

      const extraDb = new DatabaseSync(extraFile);
      extraDb.exec("CREATE TABLE test (id INTEGER)");
      extraDb.close();

      expect(() => {
        db.exec(`ATTACH DATABASE '${extraFile}' AS db_extra`);
      }).toThrow(/too many attached databases/i);
    });
  });

  describe("Query Depth and Complexity Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle nested subqueries", () => {
      db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      db.exec("INSERT INTO test VALUES (1, 'a'), (2, 'b'), (3, 'c')");

      // Create a moderately nested query
      const nestedQuery = `
        SELECT * FROM (
          SELECT * FROM (
            SELECT * FROM (
              SELECT * FROM test
            )
          )
        )
      `;

      expect(() => {
        db.prepare(nestedQuery).all();
      }).not.toThrow();
    });

    test("should enforce expression tree depth limit", () => {
      // SQLite has a default expression tree depth limit of 1000
      let deepExpression = "1";
      for (let i = 0; i < 1001; i++) {
        deepExpression = `(${deepExpression} + 1)`;
      }

      expect(() => {
        db.exec(`SELECT ${deepExpression}`);
      }).toThrow();
    });
  });

  describe("Table and Index Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle tables with many indexes", () => {
      db.exec(
        "CREATE TABLE test (id INTEGER PRIMARY KEY, a INT, b INT, c INT, d INT)",
      );

      // Create multiple indexes
      for (let i = 0; i < 10; i++) {
        db.exec(`CREATE INDEX idx${i} ON test (a, b)`);
      }

      // Should work fine
      expect(() => {
        db.exec("INSERT INTO test VALUES (1, 1, 2, 3, 4)");
      }).not.toThrow();
    });

    test("should enforce JOIN complexity limits", () => {
      // Create multiple tables
      for (let i = 0; i < 20; i++) {
        db.exec(`CREATE TABLE t${i} (id INTEGER)`);
      }

      // SQLite has limits on JOIN complexity (default 64 tables)
      // Building a query with many JOINs
      let joinQuery = "SELECT t0.id FROM t0";
      for (let i = 1; i < 65; i++) {
        joinQuery += ` CROSS JOIN t${i % 20} AS t${i}`;
      }

      expect(() => {
        db.prepare(joinQuery);
      }).toThrow(); // Should throw some error about too many joins/tables
    });
  });

  describe("Memory and Performance Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle large INSERT operations", () => {
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");

      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");
      const largeString = "x".repeat(1000);

      // Insert many rows
      expect(() => {
        for (let i = 0; i < 1000; i++) {
          stmt.run(i, largeString);
        }
      }).not.toThrow();
    });

    test("should handle LIKE pattern length limits", () => {
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");
      db.exec("INSERT INTO test VALUES (1, 'test data')");

      // Test with a reasonable LIKE pattern
      const normalPattern = "%test%";

      expect(() => {
        db.prepare("SELECT * FROM test WHERE data LIKE ?").all(normalPattern);
      }).not.toThrow();

      // SQLite's LIKE pattern limit is quite high (default 50000)
      // The actual limit may vary based on compile options
      const veryLongPattern = "%" + "x".repeat(100000) + "%";

      expect(() => {
        db.prepare("SELECT * FROM test WHERE data LIKE ?").all(veryLongPattern);
      }).toThrow(/LIKE or GLOB pattern too complex/i);
    });
  });

  describe("Trigger and View Limits", () => {
    beforeEach(() => {
      db = new DatabaseSync(":memory:");
    });

    test("should handle multiple triggers on a table", () => {
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      db.exec("CREATE TABLE audit (action TEXT, timestamp INTEGER)");

      // Create multiple triggers
      db.exec(`
        CREATE TRIGGER tr_insert AFTER INSERT ON test
        BEGIN
          INSERT INTO audit VALUES ('INSERT', strftime('%s', 'now'));
        END;
      `);

      db.exec(`
        CREATE TRIGGER tr_update AFTER UPDATE ON test
        BEGIN
          INSERT INTO audit VALUES ('UPDATE', strftime('%s', 'now'));
        END;
      `);

      db.exec(`
        CREATE TRIGGER tr_delete AFTER DELETE ON test
        BEGIN
          INSERT INTO audit VALUES ('DELETE', strftime('%s', 'now'));
        END;
      `);

      // Test triggers work
      db.exec("INSERT INTO test VALUES (1, 'test')");
      db.exec("UPDATE test SET value = 'updated' WHERE id = 1");
      db.exec("DELETE FROM test WHERE id = 1");

      const auditCount = db
        .prepare("SELECT COUNT(*) as count FROM audit")
        .get() as { count: number };
      expect(auditCount.count).toBe(3);
    });

    test("should handle complex view definitions", () => {
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec(
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL)",
      );

      // Create a complex view
      db.exec(`
        CREATE VIEW user_order_summary AS
        SELECT 
          u.id,
          u.name,
          COUNT(o.id) as order_count,
          SUM(o.total) as total_spent,
          AVG(o.total) as avg_order,
          MIN(o.total) as min_order,
          MAX(o.total) as max_order
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        GROUP BY u.id, u.name
      `);

      // Insert test data
      db.exec("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')");
      db.exec(
        "INSERT INTO orders VALUES (1, 1, 100.0), (2, 1, 200.0), (3, 2, 150.0)",
      );

      // Query the view
      const results = db.prepare("SELECT * FROM user_order_summary").all();
      expect(results).toHaveLength(2);
    });
  });
});
