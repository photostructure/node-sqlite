import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "../src/index";

// TypeScript already has gc declaration in @types/node, no need to redeclare

// Only run memory tests when explicitly requested
const shouldRunMemoryTests = process.env.TEST_MEMORY === "1";

const describeMemoryTests = shouldRunMemoryTests ? describe : describe.skip;

describeMemoryTests("Memory Tests", () => {
  // Force garbage collection if available
  const gc = global.gc;

  beforeAll(() => {
    if (!gc) {
      throw new Error("Memory tests require --expose-gc flag");
    }
  });

  function getMemoryUsage(): number {
    if (gc) gc();
    return process.memoryUsage().heapUsed;
  }

  function runMemoryTest(
    testName: string,
    testFn: () => void,
    options: {
      iterations?: number;
      warmupIterations?: number;
      maxSlopeKBPerIteration?: number;
      errorMargin?: number;
    } = {},
  ) {
    const {
      iterations = 100,
      warmupIterations = 10,
      maxSlopeKBPerIteration = 10,
      errorMargin = 0.1,
    } = options;

    test(testName, () => {
      const measurements: number[] = [];

      // Warm up
      for (let i = 0; i < warmupIterations; i++) {
        testFn();
        if (gc) gc();
      }

      // Take measurements
      for (let i = 0; i < iterations; i++) {
        // run gc() before each measurement:
        getMemoryUsage();
        testFn();
        const after = getMemoryUsage();
        measurements.push(after);

        // Force GC every 10 iterations
        if (i % 10 === 0 && gc) {
          gc();
        }
      }

      // Calculate linear regression
      const n = measurements.length;
      const sumX = (n * (n - 1)) / 2;
      const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
      const sumY = measurements.reduce((a, b) => a + b, 0);
      const sumXY = measurements.reduce((sum, y, x) => sum + x * y, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const slopeKBPerIteration = slope / 1024;

      // Calculate R-squared
      const meanY = sumY / n;
      const ssTotal = measurements.reduce(
        (sum, y) => sum + Math.pow(y - meanY, 2),
        0,
      );
      const ssResidual = measurements.reduce((sum, y, x) => {
        const predicted = meanY + slope * (x - sumX / n);
        return sum + Math.pow(y - predicted, 2);
      }, 0);
      const rSquared = 1 - ssResidual / ssTotal;

      console.log(`${testName}:`);
      console.log(`  Slope: ${slopeKBPerIteration.toFixed(2)} KB/iteration`);
      console.log(`  R-squared: ${rSquared.toFixed(4)}`);
      console.log(
        `  Initial memory: ${(measurements[0] / 1024 / 1024).toFixed(2)} MB`,
      );
      console.log(
        `  Final memory: ${(measurements[n - 1] / 1024 / 1024).toFixed(2)} MB`,
      );

      // Only consider it a leak if R-squared is high (good linear fit)
      // and slope is significantly positive
      if (
        rSquared > 1 - errorMargin &&
        slopeKBPerIteration > maxSlopeKBPerIteration
      ) {
        throw new Error(
          `Memory leak detected: ${slopeKBPerIteration.toFixed(2)} KB/iteration ` +
            `(max allowed: ${maxSlopeKBPerIteration} KB/iteration)`,
        );
      }
    });
  }

  runMemoryTest("open and close in-memory databases", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");
    const stmt = db.prepare("INSERT INTO test (data) VALUES (?)");
    for (let i = 0; i < 10; i++) {
      stmt.run(`data_${i}`);
    }
    db.close();
  });

  runMemoryTest("prepare and finalize statements", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

    for (let i = 0; i < 10; i++) {
      const stmt = db.prepare("INSERT INTO test (data) VALUES (?)");
      stmt.run(`data_${i}`);
      // Statement should be automatically finalized when it goes out of scope
    }

    db.close();
  });

  runMemoryTest("execute many queries", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");
    const insert = db.prepare("INSERT INTO test (data) VALUES (?)");
    const select = db.prepare("SELECT * FROM test WHERE id = ?");

    for (let i = 0; i < 100; i++) {
      insert.run(`data_${i}`);
    }

    for (let i = 1; i <= 100; i++) {
      select.get(i);
    }

    db.close();
  });

  runMemoryTest("create and drop tables", () => {
    const db = new DatabaseSync(":memory:");

    for (let i = 0; i < 10; i++) {
      db.exec(`CREATE TABLE test_${i} (id INTEGER PRIMARY KEY, data TEXT)`);
      db.exec(`INSERT INTO test_${i} (data) VALUES ('test')`);
      db.exec(`DROP TABLE test_${i}`);
    }

    db.close();
  });

  runMemoryTest("file database operations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sqlite-mem-test-"));
    const dbPath = join(tempDir, "test.db");

    try {
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

      const insert = db.prepare("INSERT INTO test (data) VALUES (?)");
      for (let i = 0; i < 50; i++) {
        insert.run(`data_${i}`);
      }

      db.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  runMemoryTest("user-defined functions", () => {
    const db = new DatabaseSync(":memory:");

    // Create and remove functions repeatedly
    for (let i = 0; i < 10; i++) {
      db.function(`test_func_${i}`, (x: number) => x * 2);

      const result = db.prepare(`SELECT test_func_${i}(5) as result`).get();
      if (result.result !== 10) {
        throw new Error("Function failed");
      }
    }

    db.close();
  });

  runMemoryTest("aggregate functions", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE numbers (n INTEGER)");

    const insert = db.prepare("INSERT INTO numbers VALUES (?)");
    for (let i = 1; i <= 100; i++) {
      insert.run(i);
    }

    // Create aggregate functions
    for (let i = 0; i < 5; i++) {
      db.aggregate(`sum_${i}`, {
        start: 0,
        step: (acc: number, val: number) => acc + val,
      });

      const result = db
        .prepare(`SELECT sum_${i}(n) as total FROM numbers`)
        .get();
      if (result.total !== 5050) {
        throw new Error("Aggregate function failed");
      }
    }

    db.close();
  });

  runMemoryTest(
    "large text data",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE large_text (id INTEGER PRIMARY KEY, data TEXT)");

      const largeText = "x".repeat(10000);
      const insert = db.prepare("INSERT INTO large_text (data) VALUES (?)");
      const select = db.prepare("SELECT data FROM large_text WHERE id = ?");

      for (let i = 0; i < 20; i++) {
        const testData = largeText + "y";
        const result = insert.run(testData);
        if (!result.lastInsertRowid) {
          throw new Error("No lastInsertRowid returned");
        }
        const row = select.get(Number(result.lastInsertRowid)) as
          | { data: string }
          | undefined;
        if (!row || row.data.length !== 10001) {
          throw new Error(
            `Data mismatch: expected 10001, got ${row?.data.length || 0}`,
          );
        }
      }

      db.close();
    },
    { maxSlopeKBPerIteration: 50 },
  ); // Allow more memory for large data

  runMemoryTest("transactions", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

    const insert = db.prepare("INSERT INTO test (data) VALUES (?)");

    for (let i = 0; i < 10; i++) {
      db.exec("BEGIN");
      for (let j = 0; j < 10; j++) {
        insert.run(`data_${i}_${j}`);
      }
      if (i % 2 === 0) {
        db.exec("COMMIT");
      } else {
        db.exec("ROLLBACK");
      }
    }

    db.close();
  });

  runMemoryTest("statement iteration", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

    const insert = db.prepare("INSERT INTO test (data) VALUES (?)");
    for (let i = 0; i < 100; i++) {
      insert.run(`data_${i}`);
    }

    const select = db.prepare("SELECT * FROM test");

    // Iterate multiple times
    for (let i = 0; i < 10; i++) {
      let count = 0;
      for (const _ of select.iterate()) {
        count++;
      }
      if (count !== 100) {
        throw new Error(`Expected 100 rows, got ${count}`);
      }
    }

    db.close();
  });

  runMemoryTest(
    "large dataset insertion and retrieval",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec(`
        CREATE TABLE large_dataset (
          id INTEGER PRIMARY KEY,
          name TEXT,
          data TEXT,
          created_at TEXT
        )
      `);

      const insert = db.prepare(
        "INSERT INTO large_dataset (name, data, created_at) VALUES (?, ?, ?)",
      );
      const select = db.prepare("SELECT * FROM large_dataset WHERE id = ?");

      // Insert 1000 records in this iteration
      for (let i = 0; i < 1000; i++) {
        const data = JSON.stringify({
          index: i,
          timestamp: Date.now(),
          randomData: Math.random().toString(36).repeat(10),
        });

        const result = insert.run(`User${i}`, data, new Date().toISOString());

        // Verify every 100th record
        if (i % 100 === 0) {
          const row = select.get(Number(result.lastInsertRowid));
          if (!row || row.name !== `User${i}`) {
            throw new Error(`Data verification failed for record ${i}`);
          }
        }
      }

      db.close();
    },
    { maxSlopeKBPerIteration: 100, iterations: 50 },
  );

  runMemoryTest(
    "bulk operations with transactions",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec(
        "CREATE TABLE bulk_test (id INTEGER PRIMARY KEY, value INTEGER, text_data TEXT)",
      );

      const insert = db.prepare(
        "INSERT INTO bulk_test (value, text_data) VALUES (?, ?)",
      );

      // Perform bulk operation in transaction
      db.exec("BEGIN");
      for (let i = 0; i < 500; i++) {
        insert.run(i * 2, `bulk_data_${i}_`.repeat(5));
      }
      db.exec("COMMIT");

      // Query back some data
      const select = db.prepare(
        "SELECT COUNT(*) as count FROM bulk_test WHERE value > ?",
      );
      const result = select.get(100);
      if (result.count === 0) {
        throw new Error("Bulk operation verification failed");
      }

      db.close();
    },
    { maxSlopeKBPerIteration: 80, iterations: 30 },
  );

  runMemoryTest(
    "complex queries on large dataset",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec(`
        CREATE TABLE complex_data (
          id INTEGER PRIMARY KEY,
          category TEXT,
          value REAL,
          json_data TEXT,
          created_date TEXT
        );
        CREATE INDEX idx_category ON complex_data(category);
        CREATE INDEX idx_value ON complex_data(value);
      `);

      const insert = db.prepare(
        "INSERT INTO complex_data (category, value, json_data, created_date) VALUES (?, ?, ?, ?)",
      );

      // Insert test data
      const categories = ["A", "B", "C", "D"];
      for (let i = 0; i < 200; i++) {
        const category = categories[i % categories.length];
        const value = Math.random() * 1000;
        const jsonData = JSON.stringify({
          nested: { value: i, data: "test".repeat(10) },
          array: Array(5).fill(i),
        });
        insert.run(category, value, jsonData, new Date().toISOString());
      }

      // Execute complex queries
      const queries = [
        "SELECT category, AVG(value) as avg_value FROM complex_data GROUP BY category",
        "SELECT * FROM complex_data WHERE value > 500 ORDER BY value DESC LIMIT 10",
        "SELECT category, COUNT(*) as count FROM complex_data WHERE json_data LIKE '%\"value\":1%' GROUP BY category",
        "SELECT * FROM complex_data WHERE category IN ('A', 'C') AND value BETWEEN 100 AND 800",
      ];

      queries.forEach((sql) => {
        const stmt = db.prepare(sql);
        const results = stmt.all();
        if (!Array.isArray(results)) {
          throw new Error(`Query failed: ${sql}`);
        }
      });

      db.close();
    },
    { maxSlopeKBPerIteration: 50, iterations: 50 },
  );

  runMemoryTest(
    "BLOB data handling",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec(
        "CREATE TABLE blob_test (id INTEGER PRIMARY KEY, blob_data BLOB)",
      );

      const insert = db.prepare("INSERT INTO blob_test (blob_data) VALUES (?)");
      const select = db.prepare("SELECT blob_data FROM blob_test WHERE id = ?");

      // Create various sized buffers
      const buffers = [
        Buffer.alloc(1024, 0xaa), // 1KB
        Buffer.alloc(8192, 0xbb), // 8KB
        Buffer.alloc(32768, 0xcc), // 32KB
      ];

      for (let i = 0; i < buffers.length; i++) {
        const result = insert.run(buffers[i]);
        const row = select.get(Number(result.lastInsertRowid));

        if (!row || !Buffer.isBuffer(row.blob_data)) {
          throw new Error("BLOB data not retrieved correctly");
        }

        if (!row.blob_data.equals(buffers[i])) {
          throw new Error("BLOB data corruption detected");
        }
      }

      db.close();
    },
    { maxSlopeKBPerIteration: 200, iterations: 20 },
  );

  runMemoryTest(
    "multiple database operations",
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), "sqlite-multi-db-test-"));

      try {
        const db1 = new DatabaseSync(join(tempDir, "db1.sqlite"));
        const db2 = new DatabaseSync(join(tempDir, "db2.sqlite"));

        // Set up both databases
        db1.exec("CREATE TABLE test1 (id INTEGER PRIMARY KEY, data TEXT)");
        db2.exec("CREATE TABLE test2 (id INTEGER PRIMARY KEY, data TEXT)");

        const insert1 = db1.prepare("INSERT INTO test1 (data) VALUES (?)");
        const insert2 = db2.prepare("INSERT INTO test2 (data) VALUES (?)");

        // Alternate operations between databases
        for (let i = 0; i < 50; i++) {
          insert1.run(`data1_${i}`);
          insert2.run(`data2_${i}`);

          // Occasional cross-database verification
          if (i % 10 === 0) {
            const count1 = db1
              .prepare("SELECT COUNT(*) as count FROM test1")
              .get();
            const count2 = db2
              .prepare("SELECT COUNT(*) as count FROM test2")
              .get();
            if (count1.count !== count2.count) {
              throw new Error("Database sync issue detected");
            }
          }
        }

        db1.close();
        db2.close();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
    { maxSlopeKBPerIteration: 60, iterations: 30 },
  );

  runMemoryTest(
    "prepared statement reuse",
    () => {
      const db = new DatabaseSync(":memory:");
      db.exec(
        "CREATE TABLE reuse_test (id INTEGER PRIMARY KEY, category TEXT, value INTEGER)",
      );

      // Create multiple prepared statements that will be reused
      const statements = {
        insert: db.prepare(
          "INSERT INTO reuse_test (category, value) VALUES (?, ?)",
        ),
        selectByCategory: db.prepare(
          "SELECT * FROM reuse_test WHERE category = ?",
        ),
        selectByValue: db.prepare("SELECT * FROM reuse_test WHERE value > ?"),
        update: db.prepare(
          "UPDATE reuse_test SET value = value + 1 WHERE category = ?",
        ),
        delete: db.prepare("DELETE FROM reuse_test WHERE value < ?"),
      };

      const categories = ["alpha", "beta", "gamma"];

      // Heavy reuse of prepared statements
      for (let i = 0; i < 20; i++) {
        const category = categories[i % categories.length];

        // Insert data
        statements.insert.run(category, i * 10);

        // Query data multiple ways
        statements.selectByCategory.all(category);
        statements.selectByValue.all(i * 5);

        // Modify data
        if (i % 3 === 0) {
          statements.update.run(category);
        }

        // Cleanup old data
        if (i % 5 === 0) {
          statements.delete.run(i * 2);
        }
      }

      db.close();
    },
    { maxSlopeKBPerIteration: 30, iterations: 50 },
  );
});
