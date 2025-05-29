import { DatabaseSync } from "../src";

describe("Double-Quoted String Literals Tests", () => {
  describe("enableDoubleQuotedStringLiterals option", () => {
    test("disabled by default - double quotes have quirky behavior", () => {
      const db = new DatabaseSync(":memory:");

      // Create a table with columns
      db.exec("CREATE TABLE test (value TEXT, name TEXT)");

      // This works - "hello" is treated as a string literal since there's no column named hello
      db.exec('INSERT INTO test (value, name) VALUES ("hello", "world")');

      // Verify the data was inserted
      const result1 = db.prepare("SELECT * FROM test").all();
      expect(result1.length).toBe(1);
      expect(result1[0].value).toBe("hello");
      expect(result1[0].name).toBe("world");

      // This compares the value column to itself, returning all rows
      const result2 = db
        .prepare('SELECT * FROM test WHERE "value" = "value"')
        .all();
      expect(result2.length).toBe(1); // All rows match when comparing column to itself

      // This also works because SQLite falls back to string literal when column doesn't exist
      db.exec('INSERT INTO test (value, name) VALUES ("test1", "test2")');
      const result3 = db
        .prepare('SELECT * FROM test WHERE value = "test1"')
        .all();
      expect(result3.length).toBe(1);
      expect(result3[0].value).toBe("test1");

      db.close();
    });

    test("enabled via constructor - double quotes can be strings", () => {
      const db = new DatabaseSync(":memory:", {
        enableDoubleQuotedStringLiterals: true,
      });

      // Create a table
      db.exec("CREATE TABLE test (value TEXT)");

      // This should work - double quotes are treated as strings
      db.exec('INSERT INTO test (value) VALUES ("hello")');

      // This should also work - double quotes are strings
      const result = db
        .prepare('SELECT * FROM test WHERE value = "hello"')
        .get();
      expect(result.value).toBe("hello");

      db.close();
    });

    test("enabled via open method - double quotes can be strings", () => {
      const db = new DatabaseSync();
      db.open({
        location: ":memory:",
        enableDoubleQuotedStringLiterals: true,
      });

      // Create a table
      db.exec("CREATE TABLE test (value TEXT)");

      // This should work - double quotes are treated as strings
      db.exec('INSERT INTO test (value) VALUES ("hello")');

      // Verify the data
      const result = db
        .prepare('SELECT * FROM test WHERE value = "hello"')
        .get();
      expect(result.value).toBe("hello");

      db.close();
    });

    test("can still use single quotes for strings when enabled", () => {
      const db = new DatabaseSync(":memory:", {
        enableDoubleQuotedStringLiterals: true,
      });

      db.exec("CREATE TABLE test (value TEXT)");

      // Single quotes should always work for strings
      db.exec("INSERT INTO test (value) VALUES ('world')");

      // Both single and double quotes should work
      const result1 = db
        .prepare("SELECT * FROM test WHERE value = 'world'")
        .get();
      expect(result1.value).toBe("world");

      const result2 = db
        .prepare('SELECT * FROM test WHERE value = "world"')
        .get();
      expect(result2.value).toBe("world");

      db.close();
    });

    test("affects DDL statements when enabled", () => {
      const db = new DatabaseSync(":memory:", {
        enableDoubleQuotedStringLiterals: true,
      });

      // This should work - double quotes in DEFAULT clause are strings
      db.exec('CREATE TABLE test (id INTEGER, name TEXT DEFAULT "unnamed")');

      // Insert a row without specifying name
      db.exec("INSERT INTO test (id) VALUES (1)");

      // Check the default value
      const result = db.prepare("SELECT * FROM test WHERE id = 1").get();
      expect(result.name).toBe("unnamed");

      db.close();
    });

    test("backticks can still be used for identifiers", () => {
      const db = new DatabaseSync(":memory:", {
        enableDoubleQuotedStringLiterals: true,
      });

      // Create a table with a reserved word as column name using backticks
      db.exec("CREATE TABLE test (`order` INTEGER, name TEXT)");

      // Insert using backticks for identifier
      db.exec("INSERT INTO test (`order`, name) VALUES (1, 'first')");

      // Query using backticks
      const result = db.prepare("SELECT `order`, name FROM test").get();
      expect(result.order).toBe(1);
      expect(result.name).toBe("first");

      db.close();
    });

    test("square brackets can still be used for identifiers", () => {
      const db = new DatabaseSync(":memory:", {
        enableDoubleQuotedStringLiterals: true,
      });

      // Create a table with spaces in column name using square brackets
      db.exec("CREATE TABLE test ([column name] TEXT, value INTEGER)");

      // Insert using square brackets
      db.exec("INSERT INTO test ([column name], value) VALUES ('test', 42)");

      // Query using square brackets
      const result = db.prepare("SELECT [column name], value FROM test").get();
      expect(result["column name"]).toBe("test");
      expect(result.value).toBe(42);

      db.close();
    });
  });
});
