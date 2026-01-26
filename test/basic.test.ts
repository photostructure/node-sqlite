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
    // Node.js sqlite requires a path argument
    const db = new DatabaseSync(":memory:");
    expect(db).toBeInstanceOf(DatabaseSync);
    db.close();
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

  test("percentile extension is enabled", () => {
    // Percentile extension was added in Node.js v25 (SQLite 3.51.0+)
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE t1 (x INTEGER);
      INSERT INTO t1 (x) VALUES (1), (2), (3), (4), (5);
    `);

    const result = db.prepare("SELECT percentile(x, 50) AS p50 FROM t1").get();
    expect(result).toEqual({ p50: 3 });

    // Test median (equivalent to percentile(x, 50))
    const medianResult = db.prepare("SELECT median(x) AS med FROM t1").get();
    expect(medianResult).toEqual({ med: 3 });

    db.close();
  });
});
