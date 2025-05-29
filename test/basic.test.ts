import { DatabaseSync, StatementSync, constants } from "../src";

describe("SQLite Basic Tests", () => {
  test("can import the module", () => {
    expect(DatabaseSync).toBeDefined();
    expect(StatementSync).toBeDefined();
    expect(constants).toBeDefined();
  });

  test("can create DatabaseSync instance", () => {
    const db = new DatabaseSync();
    expect(db).toBeInstanceOf(DatabaseSync);
  });

  test("constants are defined", () => {
    expect(constants.SQLITE_OPEN_READONLY).toBeDefined();
    expect(constants.SQLITE_OPEN_READWRITE).toBeDefined();
    expect(constants.SQLITE_OPEN_CREATE).toBeDefined();
  });
});
