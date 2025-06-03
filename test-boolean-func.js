const { DatabaseSync } = require("./dist");

const db = new DatabaseSync(":memory:");

// Register the type_test function
db.function("type_test", (type, value) => {
  console.log(
    `Called with type='${type}', value='${value}', typeof value='${typeof value}'`,
  );
  switch (type) {
    case "string":
      return String(value);
    case "number":
      return Number(value);
    case "boolean":
      console.log(
        `Boolean case: value=${value}, Boolean(value)=${Boolean(value)}`,
      );
      return Boolean(value);
    case "null":
      return null;
    default:
      return value;
  }
});

try {
  const stmt = db.prepare("SELECT type_test(?, ?) as result");

  console.log("\nTest 1: boolean with 0");
  let result = stmt.get("boolean", 0);
  console.log("Result:", result);

  console.log("\nTest 2: boolean with 1");
  result = stmt.get("boolean", 1);
  console.log("Result:", result);

  db.close();
} catch (error) {
  console.error("Error:", error);
  db.close();
}
