import * as fs from "node:fs";
import { DatabaseSync, StatementSync, constants } from "../src";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

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

  test("can query sqlite_version()", () => {
    const db = new DatabaseSync(":memory:");
    const stmt = db.prepare("SELECT sqlite_version() as version");
    const result = stmt.get();

    expect(result).toBeDefined();
    expect(result.version).toBeDefined();
    expect(typeof result.version).toBe("string");
    expect(result.version).toBe(packageJson.versions.sqlite);

    db.close();
  });
});
