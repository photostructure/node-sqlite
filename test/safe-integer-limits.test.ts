import { DatabaseSync } from "../src";

describe("JavaScript Safe Integer Limits", () => {
  let db: any;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test (
        id INTEGER PRIMARY KEY,
        value INTEGER
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("when setReadBigInts is false (default)", () => {
    test("returns numbers for values within JavaScript safe integer range", () => {
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");
      const selectStmt = db.prepare("SELECT value FROM test WHERE id = ?");

      // Test values near the JavaScript safe integer limits
      const testCases = [
        { value: Number.MAX_SAFE_INTEGER, type: "number" },
        { value: Number.MAX_SAFE_INTEGER - 1, type: "number" },
        { value: Number.MIN_SAFE_INTEGER, type: "number" },
        { value: Number.MIN_SAFE_INTEGER + 1, type: "number" },
        { value: 0, type: "number" },
        { value: 42, type: "number" },
        { value: -42, type: "number" },
        { value: 2147483647, type: "number" }, // INT32_MAX
        { value: -2147483648, type: "number" }, // INT32_MIN
        { value: 2147483648, type: "number" }, // INT32_MAX + 1
        { value: -2147483649, type: "number" }, // INT32_MIN - 1
      ];

      testCases.forEach((testCase) => {
        const result = stmt.run(testCase.value);
        const row = selectStmt.get(result.lastInsertRowid);

        expect(typeof row.value).toBe(testCase.type);
        expect(row.value).toBe(testCase.value);
      });
    });

    test("returns BigInt for values outside JavaScript safe integer range", () => {
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");
      const selectStmt = db.prepare("SELECT value FROM test WHERE id = ?");

      // Test values outside the JavaScript safe integer range
      const testCases = [
        { value: BigInt(Number.MAX_SAFE_INTEGER) + 1n, expectedType: "bigint" },
        { value: BigInt(Number.MIN_SAFE_INTEGER) - 1n, expectedType: "bigint" },
        { value: 9007199254740992n, expectedType: "bigint" }, // MAX_SAFE_INTEGER + 1
        { value: -9007199254740992n, expectedType: "bigint" }, // MIN_SAFE_INTEGER - 1
        { value: 9223372036854775807n, expectedType: "bigint" }, // INT64_MAX
        { value: -9223372036854775808n, expectedType: "bigint" }, // INT64_MIN
      ];

      testCases.forEach((testCase) => {
        const result = stmt.run(testCase.value);
        const row = selectStmt.get(result.lastInsertRowid);

        expect(typeof row.value).toBe(testCase.expectedType);
        expect(row.value).toBe(testCase.value);
      });
    });

    test("lastInsertRowid returns number for safe values and BigInt for large values", () => {
      // Create a table with explicit rowid
      db.exec("CREATE TABLE rowid_test (data TEXT);");

      // Test safe rowid values
      db.exec("INSERT INTO rowid_test (rowid, data) VALUES (42, 'test1')");
      let result = db.prepare("SELECT last_insert_rowid() as rowid").get();
      expect(typeof result.rowid).toBe("number");
      expect(result.rowid).toBe(42);

      // Test rowid at MAX_SAFE_INTEGER
      db.exec(
        `INSERT INTO rowid_test (rowid, data) VALUES (${Number.MAX_SAFE_INTEGER}, 'test2')`,
      );
      result = db.prepare("SELECT last_insert_rowid() as rowid").get();
      expect(typeof result.rowid).toBe("number");
      expect(result.rowid).toBe(Number.MAX_SAFE_INTEGER);

      // Test rowid beyond MAX_SAFE_INTEGER
      db.exec(
        `INSERT INTO rowid_test (rowid, data) VALUES (${Number.MAX_SAFE_INTEGER + 1}, 'test3')`,
      );
      result = db.prepare("SELECT last_insert_rowid() as rowid").get();
      expect(typeof result.rowid).toBe("bigint");
      expect(result.rowid).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    });
  });

  describe("when setReadBigInts is true", () => {
    test("returns BigInt for all integer values", () => {
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");
      const selectStmt = db.prepare("SELECT value FROM test WHERE id = ?");
      selectStmt.setReadBigInts(true);

      const testCases = [
        0,
        42,
        -42,
        2147483647, // INT32_MAX
        -2147483648, // INT32_MIN
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ];

      testCases.forEach((value) => {
        const result = stmt.run(value);
        const row = selectStmt.get(result.lastInsertRowid);

        expect(typeof row.value).toBe("bigint");
        expect(row.value).toBe(BigInt(value));
      });
    });
  });
});
