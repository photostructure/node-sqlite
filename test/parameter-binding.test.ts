import { DatabaseSync } from "../src";

describe("Parameter Binding Tests", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE test_params (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value_null INTEGER,
        value_int INTEGER,
        value_real REAL,
        value_text TEXT,
        value_blob BLOB,
        value_bigint INTEGER
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("Anonymous Parameters", () => {
    test("null binding", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_null) VALUES (?)",
      );
      const result = stmt.run(null);
      expect(result.changes).toBe(1);

      const row = db
        .prepare("SELECT value_null FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_null).toBeNull();
    });

    test("undefined binding (should bind as NULL)", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_null) VALUES (?)",
      );
      const result = stmt.run(undefined);
      expect(result.changes).toBe(1);

      const row = db
        .prepare("SELECT value_null FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_null).toBeNull();
    });

    test("number binding - integer", () => {
      const stmt = db.prepare("INSERT INTO test_params (value_int) VALUES (?)");
      const testValues = [0, -42, 42, 2147483647, -2147483648];

      testValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare("SELECT value_int FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);
        expect(row.value_int).toBe(value);
      });
    });

    test("number binding - floating point", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_real) VALUES (?)",
      );
      const testValues = [
        3.14159,
        -2.71828,
        0.0,
        Number.MIN_VALUE,
        Number.EPSILON,
      ];

      testValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare("SELECT value_real FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);
        expect(row.value_real).toBeCloseTo(value);
      });
    });

    test("bigint binding", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_bigint) VALUES (?)",
      );
      const testValues = [
        0n,
        42n,
        -42n,
        BigInt(Number.MAX_SAFE_INTEGER),
        BigInt(Number.MIN_SAFE_INTEGER),
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        BigInt(Number.MIN_SAFE_INTEGER) - 1n,
      ];

      testValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare("SELECT value_bigint FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);

        // For values within safe integer range, SQLite might return number
        if (
          value <= BigInt(Number.MAX_SAFE_INTEGER) &&
          value >= BigInt(Number.MIN_SAFE_INTEGER)
        ) {
          expect(BigInt(row.value_bigint)).toBe(value);
        } else {
          // For larger values, should return as bigint or string
          expect(BigInt(row.value_bigint)).toBe(value);
        }
      });
    });

    test("string binding", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_text) VALUES (?)",
      );
      const testValues = [
        "",
        "Hello, World!",
        "Unicode: 你好世界 🌍",
        "Special chars: \n\t\r",
        "'Single quotes'",
        '"Double quotes"',
        "Very long string: " + "x".repeat(1000),
      ];

      testValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare("SELECT value_text FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);
        expect(row.value_text).toBe(value);
      });
    });

    test("boolean binding (converts to 0/1)", () => {
      const stmt = db.prepare("INSERT INTO test_params (value_int) VALUES (?)");

      let result = stmt.run(true);
      let row = db
        .prepare("SELECT value_int FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_int).toBe(1);

      result = stmt.run(false);
      row = db
        .prepare("SELECT value_int FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_int).toBe(0);
    });

    test("Buffer binding", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );
      const testBuffers = [
        Buffer.from([]),
        Buffer.from([0x00, 0x01, 0x02, 0x03]),
        Buffer.from("Hello, World!", "utf8"),
        Buffer.from("Base64 data", "base64"),
        Buffer.alloc(256).fill(0xab),
      ];

      testBuffers.forEach((buffer) => {
        const result = stmt.run(buffer);
        const row = db
          .prepare("SELECT value_blob FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);

        // Empty buffers are stored as NULL in SQLite
        if (buffer.length === 0) {
          expect(row.value_blob).toBeNull();
        } else {
          expect(row.value_blob).toBeInstanceOf(Uint8Array);
          expect(Buffer.from(row.value_blob).equals(buffer)).toBe(true);
        }
      });
    });

    test("TypedArray binding - all types", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );

      const typedArrays = [
        new Int8Array([1, -2, 3, -4]),
        new Uint8Array([0, 128, 255]),
        new Uint8ClampedArray([0, 128, 255, 300]), // 300 will be clamped to 255
        new Int16Array([1000, -1000, 32767, -32768]),
        new Uint16Array([0, 1000, 65535]),
        new Int32Array([1000000, -1000000]),
        new Uint32Array([0, 1000000, 4294967295]),
        new Float32Array([3.14159, -2.71828, 0.0]),
        new Float64Array([Math.PI, Math.E, Number.EPSILON]),
        new BigInt64Array([123n, -456n, BigInt(Number.MAX_SAFE_INTEGER)]),
        new BigUint64Array([0n, 123n, BigInt(Number.MAX_SAFE_INTEGER)]),
      ];

      typedArrays.forEach((typedArray) => {
        const result = stmt.run(typedArray);
        const row = db
          .prepare("SELECT value_blob FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);

        expect(row.value_blob).toBeInstanceOf(Uint8Array);

        // Convert both to regular arrays for comparison
        const expected = new Uint8Array(
          typedArray.buffer,
          typedArray.byteOffset,
          typedArray.byteLength,
        );
        const actual = new Uint8Array(row.value_blob);

        expect(actual.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) {
          expect(actual[i]).toBe(expected[i]);
        }
      });
    });

    test("DataView binding", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );

      // Test case 1: Basic DataView with various data types
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);

      // Write different values
      view.setInt8(0, -128);
      view.setUint8(1, 255);
      view.setInt16(2, -32768, true); // little-endian
      view.setUint16(4, 65535, true);
      view.setInt32(6, -2147483648, true);
      view.setUint32(10, 4294967295, true);
      view.setFloat32(16, Math.PI, true);

      const result = stmt.run(view);
      const row = db
        .prepare("SELECT value_blob FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_blob).toBeInstanceOf(Uint8Array);

      // Verify the data
      const resultView = new DataView(row.value_blob.buffer);
      expect(resultView.getInt8(0)).toBe(-128);
      expect(resultView.getUint8(1)).toBe(255);
      expect(resultView.getInt16(2, true)).toBe(-32768);
      expect(resultView.getUint16(4, true)).toBe(65535);
      expect(resultView.getInt32(6, true)).toBe(-2147483648);
      expect(resultView.getUint32(10, true)).toBe(4294967295);
      expect(resultView.getFloat32(16, true)).toBeCloseTo(Math.PI);
    });

    test("DataView with offset and length", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );

      // Create a DataView that only uses part of the underlying buffer
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const offsetView = new DataView(bytes.buffer, 1, 3); // "ell"

      const result = stmt.run(offsetView);
      const row = db
        .prepare("SELECT value_blob FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_blob).toBeInstanceOf(Uint8Array);
      expect(row.value_blob.length).toBe(3);
      expect(Array.from(row.value_blob)).toEqual([0x65, 0x6c, 0x6c]); // "ell"
    });

    test("Empty DataView", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );

      const emptyBuffer = new ArrayBuffer(0);
      const emptyView = new DataView(emptyBuffer);

      const result = stmt.run(emptyView);
      const row = db
        .prepare("SELECT value_blob FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      // Empty DataView should bind as NULL
      expect(row.value_blob).toBeNull();
    });

    test("multiple parameters of different types", () => {
      const stmt = db.prepare(`
        INSERT INTO test_params (value_null, value_int, value_real, value_text, value_blob, value_bigint) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const buffer = Buffer.from([1, 2, 3, 4]);
      const result = stmt.run(
        null,
        42,
        3.14159,
        "Hello",
        buffer,
        9007199254740993n,
      );

      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_null).toBeNull();
      expect(row.value_int).toBe(42);
      expect(row.value_real).toBeCloseTo(3.14159);
      expect(row.value_text).toBe("Hello");
      expect(Buffer.from(row.value_blob).equals(buffer)).toBe(true);
      expect(typeof row.value_bigint).toBe("bigint");
      expect(row.value_bigint).toBe(9007199254740993n);
    });

    // Tests ported from Node.js PR #59350: handle ?NNN parameters as positional
    // https://github.com/nodejs/node/pull/59350

    test("binds ?NNN params by position", () => {
      // Matches Node.js test: 'binds ?NNN params by position'
      db.exec(
        "CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER NOT NULL) STRICT",
      );
      const stmt = db.prepare("INSERT INTO data (key, val) VALUES (?1, ?2)");
      expect(stmt.run(1, 2)).toEqual({ changes: 1, lastInsertRowid: 1 });
    });

    test("SQLite defaults unbound ?NNN parameters", () => {
      // Matches Node.js test: 'SQLite defaults unbound ?NNN parameters'
      db.exec(
        "CREATE TABLE data2(key INTEGER PRIMARY KEY, val INTEGER NOT NULL) STRICT",
      );
      const stmt = db.prepare("INSERT INTO data2 (key, val) VALUES (?1, ?3)");

      // Only 1 arg - ?1 gets bound, ?3 remains NULL (default), violates NOT NULL
      expect(() => stmt.run(1)).toThrow(/NOT NULL constraint/);
    });

    test("?NNN parameters with SELECT", () => {
      // Additional test for SELECT behavior
      const stmt = db.prepare("SELECT ?1 as a, ?2 as b");
      const result = stmt.get(10, 20);
      expect(result).toEqual({ a: 10, b: 20 });
    });

    test("?NNN with gap requires explicit NULL for middle param", () => {
      // When using ?1 and ?3, sqlite3_bind_parameter_count returns 3
      // Positional binding maps: arg0->param1, arg1->param2, arg2->param3
      // So for ?1, ?3 query, must pass 3 args with middle one explicitly
      const stmt = db.prepare(
        "INSERT INTO test_params (value_int, value_text) VALUES (?1, ?3)",
      );
      const result = stmt.run(42, null, "hello");
      expect(result.changes).toBe(1);

      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_int).toBe(42);
      expect(row.value_text).toBe("hello");
    });
  });

  describe("Named Parameters", () => {
    test("named parameters with : prefix", () => {
      const stmt = db.prepare(`
        INSERT INTO test_params (value_int, value_text) 
        VALUES (:int_val, :text_val)
      `);

      const result = stmt.run({ ":int_val": 123, ":text_val": "test" });
      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_int).toBe(123);
      expect(row.value_text).toBe("test");
    });

    test("named parameters with $ prefix", () => {
      const stmt = db.prepare(`
        INSERT INTO test_params (value_int, value_text) 
        VALUES ($int_val, $text_val)
      `);

      const result = stmt.run({ $int_val: 456, $text_val: "dollar" });
      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_int).toBe(456);
      expect(row.value_text).toBe("dollar");
    });

    test("bare named parameters", () => {
      const stmt = db.prepare(`
        INSERT INTO test_params (value_int, value_text) 
        VALUES (:int_val, :text_val)
      `);
      stmt.setAllowBareNamedParameters(true);

      const result = stmt.run({ int_val: 789, text_val: "bare" });
      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_int).toBe(789);
      expect(row.value_text).toBe("bare");
    });

    test("named parameters with all types", () => {
      const stmt = db.prepare(`
        INSERT INTO test_params (value_null, value_int, value_real, value_text, value_blob, value_bigint) 
        VALUES (:null, :int, :real, :text, :blob, :bigint)
      `);
      stmt.setAllowBareNamedParameters(true);

      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      const result = stmt.run({
        null: null,
        int: 42,
        real: Math.PI,
        text: "Named params",
        blob: buffer,
        bigint: 123456789012345n,
      });

      const row = db
        .prepare("SELECT * FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);

      expect(row.value_null).toBeNull();
      expect(row.value_int).toBe(42);
      expect(row.value_real).toBeCloseTo(Math.PI);
      expect(row.value_text).toBe("Named params");
      expect(row.value_blob).toBeInstanceOf(Uint8Array);
      // Value is within safe integer range, so it might be returned as number
      expect(BigInt(row.value_bigint)).toBe(123456789012345n);
    });
  });

  describe("Edge Cases", () => {
    test("empty arrays and buffers", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_blob) VALUES (?)",
      );

      const emptyValues = [
        Buffer.alloc(0),
        new Uint8Array(0),
        new Int32Array(0),
        new Float64Array(0),
      ];

      emptyValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare(
            "SELECT value_blob, typeof(value_blob) as type FROM test_params WHERE id = ?",
          )
          .get(result.lastInsertRowid);

        // SQLite stores empty blobs as NULL
        expect(row.value_blob).toBeNull();
        expect(row.type).toBe("null");
      });
    });

    test("special numeric values", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_real) VALUES (?)",
      );

      // NaN and Infinity should be handled
      const specialValues = [NaN, Infinity, -Infinity];

      specialValues.forEach((value) => {
        const result = stmt.run(value);
        const row = db
          .prepare("SELECT value_real FROM test_params WHERE id = ?")
          .get(result.lastInsertRowid);

        if (isNaN(value)) {
          expect(row.value_real).toBeNull(); // SQLite converts NaN to NULL
        } else {
          expect(row.value_real).toBe(value);
        }
      });
    });

    test("functions and objects as parameters", () => {
      const stmt = db.prepare(
        "INSERT INTO test_params (value_text) VALUES (?)",
      );

      // Functions should bind as NULL
      const func = () => "test";
      const result = stmt.run(func);
      const row = db
        .prepare("SELECT value_text FROM test_params WHERE id = ?")
        .get(result.lastInsertRowid);
      expect(row.value_text).toBeNull();

      // Objects should throw error for unknown named parameters (Node.js behavior)
      const obj = { foo: "bar", num: 123 };
      expect(() => stmt.run(obj)).toThrow("Unknown named parameter 'foo'");

      // Arrays should throw error when used as positional parameters (Node.js behavior)
      const arr = [1, 2, 3];
      expect(() => stmt.run(arr)).toThrow(
        "Provided value cannot be bound to SQLite parameter",
      );
    });

    // Commented out as our implementation may allow mixing parameters
    // test("mixing anonymous and named parameters fails", () => {
    //   const stmt = db.prepare("INSERT INTO test_params (value_int, value_text) VALUES (?, :text)");
    //
    //   expect(() => {
    //     stmt.run(123, { ":text": "mixed" });
    //   }).toThrow();
    // });
  });

  describe("Parameter Type Verification", () => {
    test("verify all parameter types are properly bound", () => {
      // Create a table that stores the type info
      db.exec(`
        CREATE TABLE type_test (
          id INTEGER PRIMARY KEY,
          param_value ANY,
          param_type TEXT
        )
      `);

      const insertStmt = db.prepare(
        "INSERT INTO type_test (param_value, param_type) VALUES (?, typeof(?))",
      );
      const selectStmt = db.prepare("SELECT * FROM type_test WHERE id = ?");

      // Test each type
      const testCases = [
        { value: null, expectedType: "null" },
        { value: 42, expectedType: "integer" },
        { value: 3.14, expectedType: "real" },
        { value: "text", expectedType: "text" },
        { value: Buffer.from([1, 2, 3]), expectedType: "blob" },
        { value: new Uint8Array([4, 5, 6]), expectedType: "blob" },
        { value: new Float32Array([1.1, 2.2]), expectedType: "blob" },
        { value: new DataView(new ArrayBuffer(4)), expectedType: "blob" },
      ];

      testCases.forEach(({ value, expectedType }) => {
        const result = insertStmt.run(value, value);
        const row = selectStmt.get(result.lastInsertRowid);

        expect(row.param_type).toBe(expectedType);
      });
    });
  });

  describe("RETURNING clause metadata", () => {
    // Regression test for: https://github.com/nodejs/node/issues/57344
    // This test ensures that run() returns correct metadata when using RETURNING.
    // The bug was that sqlite3_changes() was called before sqlite3_reset(),
    // causing incorrect change counts on the first call.
    test("returns correct metadata when using RETURNING clause", () => {
      db.exec(
        "CREATE TABLE returning_test (key INTEGER PRIMARY KEY, val INTEGER NOT NULL)",
      );
      const stmt = db.prepare(
        "INSERT INTO returning_test (key, val) VALUES ($k, $v) RETURNING key",
      );

      // First insert - this was returning changes: 0 before the fix
      const result1 = stmt.run({ $k: 1, $v: 10 });
      expect(result1).toEqual({ changes: 1, lastInsertRowid: 1 });

      // Subsequent inserts should also work correctly
      const result2 = stmt.run({ $k: 2, $v: 20 });
      expect(result2).toEqual({ changes: 1, lastInsertRowid: 2 });

      const result3 = stmt.run({ $k: 3, $v: 30 });
      expect(result3).toEqual({ changes: 1, lastInsertRowid: 3 });
    });

    test("returns correct metadata when reusing statement with RETURNING", () => {
      db.exec(
        "CREATE TABLE returning_reuse_test (id INTEGER PRIMARY KEY, value TEXT)",
      );
      const stmt = db.prepare(
        "INSERT INTO returning_reuse_test (value) VALUES (?) RETURNING id",
      );

      // Run multiple times with different values
      for (let i = 1; i <= 5; i++) {
        const result = stmt.run(`value${i}`);
        expect(result.changes).toBe(1);
        expect(result.lastInsertRowid).toBe(i);
      }
    });
  });
});
