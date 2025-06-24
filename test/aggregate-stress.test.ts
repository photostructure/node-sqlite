import { DatabaseSync } from "../src";

// Stress test specifically designed to trigger memory corruption in aggregate functions
describe("Aggregate Function Stress Test", () => {
  test("rapid type changes with large data", () => {
    const db = new DatabaseSync(":memory:");

    // Create table with various data types
    db.exec(`
      CREATE TABLE stress_test (
        id INTEGER PRIMARY KEY,
        int_val INTEGER,
        real_val REAL,
        text_val TEXT,
        blob_val BLOB,
        null_val NULL
      )
    `);

    // Insert diverse data
    const insert = db.prepare(`
      INSERT INTO stress_test (int_val, real_val, text_val, blob_val, null_val) 
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < 100; i++) {
      insert.run(
        i,
        Math.random() * 1000,
        `text_${i}_${"x".repeat(Math.floor(Math.random() * 100))}`,
        Buffer.from(`blob_${i}`),
        null,
      );
    }

    // 1. Aggregate that rapidly switches between all types
    db.aggregate("type_chaos", {
      start: null,
      step: (acc, _val) => {
        // Force type changes on every call
        if (acc === null) return 0;
        if (typeof acc === "number") return "string";
        if (typeof acc === "string") return Buffer.from("buffer");
        if (Buffer.isBuffer(acc)) return true;
        if (typeof acc === "boolean") return BigInt(42);
        if (typeof acc === "bigint") return null;
        return acc;
      },
    });

    // Run multiple times to stress memory management
    for (let i = 0; i < 50; i++) {
      const result = db
        .prepare("SELECT type_chaos(int_val) FROM stress_test")
        .get();
      expect(result).toBeDefined();
    }

    // 2. Test with GROUP BY to create multiple aggregate contexts
    for (let i = 0; i < 20; i++) {
      const results = db
        .prepare(
          `
        SELECT int_val % 10 as grp, type_chaos(int_val) 
        FROM stress_test 
        GROUP BY grp
      `,
        )
        .all();
      expect(results.length).toBeGreaterThan(0);
    }

    // 3. Test with nested queries and multiple aggregates
    db.aggregate("nested_chaos", {
      start: "",
      step: (acc, val) => {
        // Accumulate data as JSON string to avoid object issues
        const data = acc ? JSON.parse(acc) : { level: 0, data: [] };
        data.level++;
        data.data.push({ val: String(val), type: typeof val });
        return JSON.stringify(data);
      },
      result: (acc) => (acc ? JSON.parse(acc).level : 0),
    });

    const complexQuery = `
      WITH RECURSIVE cnt(x) AS (
        SELECT 1
        UNION ALL
        SELECT x+1 FROM cnt WHERE x<10
      )
      SELECT 
        cnt.x,
        type_chaos(s.int_val) as tc,
        nested_chaos(s.text_val) as nc
      FROM cnt, stress_test s
      WHERE s.id <= cnt.x
      GROUP BY cnt.x
    `;

    for (let i = 0; i < 5; i++) {
      const results = db.prepare(complexQuery).all();
      expect(results).toBeDefined();
    }

    db.close();
  });

  test("memory safety with string accumulation", () => {
    const db = new DatabaseSync(":memory:");

    db.exec("CREATE TABLE string_test (data TEXT)");

    // Insert progressively larger strings
    const insert = db.prepare("INSERT INTO string_test VALUES (?)");
    for (let i = 0; i < 100; i++) {
      insert.run("x".repeat(i * 10));
    }

    // Aggregate that accumulates strings
    db.aggregate("string_builder", {
      start: "",
      step: (acc, val) => {
        // Alternate between appending and replacing
        if (acc.length > 1000) {
          return val; // Reset when too large
        }
        return acc + val;
      },
    });

    // Run with different groupings
    for (let i = 0; i < 10; i++) {
      const result = db
        .prepare(
          `
        SELECT LENGTH(string_builder(data)) as len 
        FROM string_test 
        WHERE LENGTH(data) < ?
      `,
        )
        .get(i * 100);
      // When no rows match the WHERE clause, aggregate returns NULL
      expect(result.len === null || result.len >= 0).toBe(true);
    }

    db.close();
  });

  test("object reference lifecycle stress", () => {
    const db = new DatabaseSync(":memory:");

    db.exec("CREATE TABLE obj_test (id INTEGER, data TEXT)");

    // Insert data
    for (let i = 0; i < 50; i++) {
      db.prepare("INSERT INTO obj_test VALUES (?, ?)").run(i, `data_${i}`);
    }

    // Complex object aggregation - use JSON string to track state
    db.aggregate("obj_lifecycle", {
      start: JSON.stringify({ refs: [], counter: 0 }),
      step: (acc, val) => {
        // Parse and manipulate state
        const obj = JSON.parse(acc);
        obj.counter++;

        // Add reference (without circular refs which can't be stringified)
        obj.refs.push({ val: String(val), depth: obj.counter });

        // Occasionally reset to prevent unbounded growth
        if (obj.counter > 10) {
          return JSON.stringify({ refs: [], counter: 0 });
        }

        return JSON.stringify(obj);
      },
      result: (acc) => JSON.parse(acc).counter,
    });

    // Run multiple queries
    for (let i = 0; i < 20; i++) {
      const result = db
        .prepare("SELECT obj_lifecycle(data) as count FROM obj_test")
        .get();
      expect(result.count).toBeGreaterThanOrEqual(0);
    }

    db.close();
  });
});
