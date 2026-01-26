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

    test("throws RangeError for values outside JavaScript safe integer range", () => {
      // Node.js sqlite throws RangeError when reading values outside safe integer range
      // without setReadBigInts(true) enabled. This is intentional to prevent silent data loss.
      const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");
      const selectStmt = db.prepare("SELECT value FROM test WHERE id = ?");

      // Test values outside the JavaScript safe integer range
      const testCases = [
        { value: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
        { value: BigInt(Number.MIN_SAFE_INTEGER) - 1n },
        { value: 9007199254740992n }, // MAX_SAFE_INTEGER + 1
        { value: -9007199254740992n }, // MIN_SAFE_INTEGER - 1
        { value: 9223372036854775807n }, // INT64_MAX
        { value: -9223372036854775808n }, // INT64_MIN
      ];

      testCases.forEach((testCase) => {
        const result = stmt.run(testCase.value);
        // Reading without setReadBigInts(true) should throw RangeError
        // Note: we can't use expect().toThrow(RangeError) because Jest wraps the error
        let error: Error | undefined;
        try {
          selectStmt.get(result.lastInsertRowid);
        } catch (e) {
          error = e as Error;
        }
        expect(error).toBeDefined();
        expect(error!.name).toBe("RangeError");
        expect(error!.message).toContain("too large");
      });

      // With setReadBigInts(true), values can be read correctly
      selectStmt.setReadBigInts(true);
      testCases.forEach((testCase) => {
        const result = stmt.run(testCase.value);
        const row = selectStmt.get(result.lastInsertRowid) as { value: bigint };
        expect(typeof row.value).toBe("bigint");
        expect(row.value).toBe(testCase.value);
      });
    });

    test("lastInsertRowid throws RangeError for large values without setReadBigInts", () => {
      // Create a table with explicit rowid
      db.exec("CREATE TABLE rowid_test (data TEXT);");

      // Test safe rowid values
      db.exec("INSERT INTO rowid_test (rowid, data) VALUES (42, 'test1')");
      let result = db.prepare("SELECT last_insert_rowid() as rowid").get() as {
        rowid: number;
      };
      expect(typeof result.rowid).toBe("number");
      expect(result.rowid).toBe(42);

      // Test rowid at MAX_SAFE_INTEGER
      db.exec(
        `INSERT INTO rowid_test (rowid, data) VALUES (${Number.MAX_SAFE_INTEGER}, 'test2')`,
      );
      result = db.prepare("SELECT last_insert_rowid() as rowid").get() as {
        rowid: number;
      };
      expect(typeof result.rowid).toBe("number");
      expect(result.rowid).toBe(Number.MAX_SAFE_INTEGER);

      // Test rowid beyond MAX_SAFE_INTEGER - throws RangeError without setReadBigInts(true)
      db.exec(
        `INSERT INTO rowid_test (rowid, data) VALUES (${Number.MAX_SAFE_INTEGER + 1}, 'test3')`,
      );
      const stmt = db.prepare("SELECT last_insert_rowid() as rowid");
      // Note: we can't use expect().toThrow(RangeError) because Jest wraps the error
      let error: Error | undefined;
      try {
        stmt.get();
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.name).toBe("RangeError");
      expect(error!.message).toContain("too large");

      // With setReadBigInts(true), large rowid can be read
      stmt.setReadBigInts(true);
      const bigResult = stmt.get() as { rowid: bigint };
      expect(typeof bigResult.rowid).toBe("bigint");
      expect(bigResult.rowid).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
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
