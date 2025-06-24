import { DatabaseSync } from "../src";

// Quick memory test for aggregate functions
describe("Aggregate Function Memory Test", () => {
  test("aggregate functions don't leak memory", () => {
    const db = new DatabaseSync(":memory:");

    // Create a test table with data
    db.exec(`
      CREATE TABLE test_data (
        id INTEGER PRIMARY KEY,
        value INTEGER,
        text_value TEXT
      )
    `);

    // Insert test data
    const insert = db.prepare(
      "INSERT INTO test_data (value, text_value) VALUES (?, ?)",
    );
    for (let i = 0; i < 1000; i++) {
      insert.run(i, `text_${i}`);
    }

    // Test various aggregate scenarios that might trigger memory issues

    // 1. Aggregate with type changes (potential memory corruption)
    db.aggregate("type_changer", {
      start: 0,
      step: (acc, value) => {
        // Alternate between different types
        if (typeof acc === "number") return `string_${acc}`;
        if (typeof acc === "string")
          return { count: parseInt(acc.split("_")[1] || "0") };
        if (typeof acc === "object") return acc.count + value;
        return 0;
      },
    });

    // Run multiple times to stress test memory management
    for (let i = 0; i < 10; i++) {
      const result = db
        .prepare("SELECT type_changer(value) as result FROM test_data")
        .get();
      expect(result).toBeDefined();
    }

    // 2. Aggregate with string accumulation (tests string memory management)
    db.aggregate("string_concat", {
      start: "",
      step: (acc, value) => acc + value.toString() + ",",
    });

    for (let i = 0; i < 5; i++) {
      const result = db
        .prepare(
          "SELECT string_concat(value) as result FROM test_data WHERE id <= 100",
        )
        .get();
      expect(typeof result.result).toBe("string");
    }

    // 3. Aggregate with object references (create fresh object each time to avoid mutation)
    db.aggregate("object_accumulator", {
      start: { items: [] },
      step: (acc, value) => {
        // Create new object to avoid mutating shared state
        return { items: [...acc.items, value] };
      },
      result: (acc) => acc.items.length,
    });

    for (let i = 0; i < 5; i++) {
      const result = db
        .prepare(
          "SELECT object_accumulator(value) as count FROM test_data WHERE id <= 50",
        )
        .get();
      expect(result.count).toBe(50);
    }

    // 4. Test with GROUP BY (multiple aggregate contexts)
    db.aggregate("group_sum", {
      start: 0,
      step: (acc, value) => acc + value,
    });

    const groupResults = db
      .prepare(
        `
      SELECT value % 10 as grp, group_sum(value) as total 
      FROM test_data 
      GROUP BY grp
    `,
      )
      .all();
    expect(groupResults.length).toBe(10);

    // Clean up
    db.close();
  });

  test("aggregate functions handle rapid type changes", () => {
    const db = new DatabaseSync(":memory:");

    db.exec("CREATE TABLE rapid_test (val)");

    // Insert various types
    const insert = db.prepare("INSERT INTO rapid_test VALUES (?)");
    insert.run(42);
    insert.run("hello");
    insert.run(null);
    insert.run(3.14);
    insert.run("world");

    // Aggregate that changes types frequently
    db.aggregate("type_switcher", {
      start: null,
      step: (acc, val) => {
        // Force rapid type changes
        if (val === null) return "null_value";
        if (typeof val === "number") return { num: val };
        if (typeof val === "string") return val.length;
        return acc;
      },
    });

    // Run multiple times
    for (let i = 0; i < 100; i++) {
      const result = db
        .prepare("SELECT type_switcher(val) as result FROM rapid_test")
        .get();
      expect(result).toBeDefined();
    }

    db.close();
  });
});
