import { DatabaseSync, type UserFunctionOptions } from "../src";

describe("User-defined Functions Tests", () => {
  test("user-defined functions - basic functionality", () => {
    const db = new DatabaseSync(":memory:");

    // Register a simple function that doubles a number
    db.function("double", (x: any) => x * 2);

    // Test the function
    const stmt = db.prepare("SELECT double(?) as result");
    const result = stmt.get(5);

    expect(result.result).toBe(10);

    db.close();
  });

  test("user-defined functions - string functions", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that reverses a string
    db.function("reverse", (str: any) => {
      if (typeof str !== "string") return null;
      return str.split("").reverse().join("");
    });

    // Test the function
    const stmt = db.prepare("SELECT reverse(?) as result");
    const result = stmt.get("hello");

    expect(result.result).toBe("olleh");

    db.close();
  });

  test("user-defined functions - multiple arguments", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that concatenates strings with a separator
    const options: UserFunctionOptions = { varargs: true };
    db.function("concat_with_sep", options, (sep: any, ...args: any[]) => {
      return args.filter((arg) => arg != null).join(sep);
    });

    // Test the function
    const stmt = db.prepare("SELECT concat_with_sep(?, ?, ?, ?) as result");
    const result = stmt.get("-", "hello", "world", "test");

    expect(result.result).toBe("hello-world-test");

    db.close();
  });

  test("user-defined functions - with options", () => {
    const db = new DatabaseSync(":memory:");

    // Register a deterministic function
    const options: UserFunctionOptions = { deterministic: true };
    db.function("add_one", options, (x: any) => x + 1);

    // Test the function
    const stmt = db.prepare("SELECT add_one(?) as result");
    const result = stmt.get(42);

    expect(result.result).toBe(43);

    db.close();
  });

  test("user-defined functions - BigInt support", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that works with BigInt
    const options: UserFunctionOptions = { useBigIntArguments: true };
    db.function("big_add", options, (a: any, b: any) => {
      return a + b;
    });

    // Test the function with large integers
    const stmt = db.prepare("SELECT big_add(?, ?) as result");
    const result = stmt.get(9007199254740991n, 1n); // Number.MAX_SAFE_INTEGER + 1

    expect(result.result).toBe(9007199254740992n);

    db.close();
  });

  test("user-defined functions - null handling", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that handles null values
    db.function("safe_add", (a: any, b: any) => {
      if (a == null || b == null) return null;
      return a + b;
    });

    // Test with null values
    const stmt = db.prepare("SELECT safe_add(?, ?) as result");

    let result = stmt.get(5, null);
    expect(result.result).toBe(null);

    result = stmt.get(3, 4);
    expect(result.result).toBe(7);

    db.close();
  });

  test("user-defined functions - blob handling", () => {
    const db = new DatabaseSync(":memory:");

    // Register an identity function that passes through blobs
    db.function("identity", (x: unknown) => x);

    // Test with blob data
    const blobData = Buffer.from([0x01, 0x02, 0x03, 0xff]);
    const stmt = db.prepare("SELECT identity(?) as result");
    const result = stmt.get(blobData);

    expect(Buffer.isBuffer(result.result)).toBe(true);
    expect(result.result).toEqual(blobData);

    // Note: SQLite treats empty blobs (0-length Buffer) as NULL during binding
    const emptyBlob = Buffer.alloc(0);
    const emptyResult = stmt.get(emptyBlob);
    expect(emptyResult.result).toBeNull();

    db.close();
  });

  test("user-defined functions - DataView return values", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that returns a DataView
    db.function("dataview_func", () => {
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setUint8(0, 0xde);
      view.setUint8(1, 0xad);
      view.setUint8(2, 0xbe);
      view.setUint8(3, 0xef);
      return view;
    });

    const stmt = db.prepare("SELECT dataview_func() as result");
    const result = stmt.get();

    expect(Buffer.isBuffer(result.result)).toBe(true);
    expect(result.result).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    db.close();
  });

  test("user-defined functions - TypedArray return values", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that returns a Uint8Array
    db.function("uint8array_func", () => {
      return new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    });

    const stmt = db.prepare("SELECT uint8array_func() as result");
    const result = stmt.get();

    expect(Buffer.isBuffer(result.result)).toBe(true);
    expect(result.result).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));

    db.close();
  });

  test("user-defined functions - DataView with offset and length", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that returns a DataView with non-zero offset
    db.function("dataview_offset_func", () => {
      const buffer = new ArrayBuffer(8);
      const fullView = new DataView(buffer);
      // Fill the whole buffer
      for (let i = 0; i < 8; i++) {
        fullView.setUint8(i, i + 1);
      }
      // Return a view that starts at offset 2 and has length 4
      return new DataView(buffer, 2, 4);
    });

    const stmt = db.prepare("SELECT dataview_offset_func() as result");
    const result = stmt.get();

    expect(Buffer.isBuffer(result.result)).toBe(true);
    // Should contain bytes at positions 2,3,4,5 which are 3,4,5,6
    expect(result.result).toEqual(Buffer.from([0x03, 0x04, 0x05, 0x06]));

    db.close();
  });

  test("user-defined functions - empty string handling", () => {
    const db = new DatabaseSync(":memory:");

    // Register an identity function
    db.function("identity", (x: unknown) => x);

    // Test with empty string
    const stmt = db.prepare("SELECT identity(?) as result");
    const result = stmt.get("");

    expect(typeof result.result).toBe("string");
    expect(result.result).toBe("");

    db.close();
  });

  test("user-defined functions - error handling", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that throws an error
    db.function("error_func", () => {
      throw new Error("Test error");
    });

    // Test that errors are properly propagated
    const stmt = db.prepare("SELECT error_func() as result");

    expect(() => {
      stmt.get();
    }).toThrow(); // Just verify that an error is thrown, not the exact message

    db.close();
  });

  test("user-defined functions - type conversion", () => {
    const db = new DatabaseSync(":memory:");

    // Register a function that returns different types
    db.function("type_test", (type: any, value: any) => {
      switch (type) {
        case "string":
          return String(value);
        case "number":
          return Number(value);
        case "boolean":
          return Boolean(value);
        case "null":
          return null;
        default:
          return value;
      }
    });

    const stmt = db.prepare("SELECT type_test(?, ?) as result");

    // Test string conversion
    let result = stmt.get("string", 123);
    expect(result).toBeDefined();
    expect(result.result).toBe("123");

    // Test number conversion
    result = stmt.get("number", "456");
    expect(result).toBeDefined();
    expect(result.result).toBe(456);

    // Test boolean conversion (SQLite returns 0/1 for false/true)
    result = stmt.get("boolean", 0);
    expect(result).toBeDefined();
    expect(result.result).toBe(0); // SQLite stores false as 0

    result = stmt.get("boolean", 1);
    expect(result).toBeDefined();
    expect(result.result).toBe(1); // SQLite stores true as 1

    // Test null return
    result = stmt.get("null", "anything");
    expect(result).toBeDefined();
    expect(result.result).toBe(null);

    // Explicitly finalize the statement before closing the database
    stmt.finalize();
    db.close();
  });
});
