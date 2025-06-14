import { DatabaseSync } from "../src";

describe("Error Properties Investigation", () => {
  test("check what properties are exposed on SQLite errors", () => {
    const db = new DatabaseSync(":memory:");

    // Create a table with constraints
    db.exec(`
      CREATE TABLE test (
        id INTEGER PRIMARY KEY,
        value TEXT UNIQUE NOT NULL
      );
    `);

    // Insert a row
    db.exec("INSERT INTO test (id, value) VALUES (1, 'test')");

    // Try to violate UNIQUE constraint
    try {
      db.exec("INSERT INTO test (id, value) VALUES (2, 'test')");
      fail("Should have thrown an error");
    } catch (error: any) {
      console.log("Error object:", error);
      console.log("Error properties:", Object.getOwnPropertyNames(error));
      console.log("Error.name:", error.name);
      console.log("Error.message:", error.message);
      console.log("Error.code:", error.code);
      console.log("Error.errcode:", error.errcode);
      console.log("Error.errno:", error.errno);
      console.log("Error.errstr:", error.errstr);
      console.log("Error.sql:", error.sql);
      console.log("Error.stack:", error.stack?.split("\n")[0]);

      // Check prototype chain
      console.log("Error constructor:", error.constructor.name);
      console.log(
        "Error prototype:",
        Object.getPrototypeOf(error).constructor.name,
      );
    }

    // Try a different error - syntax error
    try {
      db.exec("INVALID SQL");
      fail("Should have thrown an error");
    } catch (error: any) {
      console.log(
        "\nSyntax error properties:",
        Object.getOwnPropertyNames(error),
      );
      console.log("Syntax error.code:", error.code);
      console.log("Syntax error.message:", error.message);
    }

    // Try file not found error
    try {
      new DatabaseSync("/invalid/path/that/does/not/exist/test.db");
      fail("Should have thrown an error");
    } catch (error: any) {
      console.log(
        "\nFile error properties:",
        Object.getOwnPropertyNames(error),
      );
      console.log("File error.code:", error.code);
      console.log("File error.errno:", error.errno);
      console.log("File error.message:", error.message);
    }

    db.close();
  });
});
