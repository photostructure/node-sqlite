import { beforeEach, describe, expect, jest } from "@jest/globals";
import * as fs from "node:fs";
import { DatabaseSync } from "../src/index";
import { getTestTimeout, useTempDir } from "./test-utils";

describe("Enhanced location() method tests", () => {
  jest.setTimeout(getTestTimeout());
  const { getDbPath } = useTempDir("node-sqlite-location-");
  let dbPath: string;
  let attachedDbPath: string;

  beforeEach(() => {
    dbPath = getDbPath("main.db");
    attachedDbPath = getDbPath("attached.db");
  });

  test("location() returns main database path by default", () => {
    const db = new DatabaseSync(dbPath);
    expect(db.location()).toBe(fs.realpathSync(dbPath));
    expect(db.location("main")).toBe(fs.realpathSync(dbPath));
    db.close();
  });

  test("location() returns null for in-memory database", () => {
    const db = new DatabaseSync(":memory:");
    expect(db.location()).toBeNull();
    expect(db.location("main")).toBeNull();
    db.close();
  });

  test("location() works with attached databases", () => {
    const db = new DatabaseSync(dbPath);

    // Attach another database
    db.exec(`ATTACH DATABASE '${attachedDbPath}' AS attached_db`);

    // Main database should still return the main path
    expect(db.location()).toBe(fs.realpathSync(dbPath));
    expect(db.location("main")).toBe(fs.realpathSync(dbPath));

    // Attached database should return its path
    expect(db.location("attached_db")).toBe(fs.realpathSync(attachedDbPath));

    db.close();
  });

  test("location() returns null for non-existent database name", () => {
    const db = new DatabaseSync(dbPath);

    // Non-existent database should return null
    expect(db.location("nonexistent")).toBeNull();

    db.close();
  });

  test("location() works with multiple attached databases", () => {
    const db = new DatabaseSync(dbPath);
    const secondAttachedPath = getDbPath("second_attached.db");

    try {
      // Attach multiple databases
      db.exec(`ATTACH DATABASE '${attachedDbPath}' AS first_attached`);
      db.exec(`ATTACH DATABASE '${secondAttachedPath}' AS second_attached`);

      // Test all database locations
      expect(db.location()).toBe(fs.realpathSync(dbPath));
      expect(db.location("main")).toBe(fs.realpathSync(dbPath));
      expect(db.location("first_attached")).toBe(
        fs.realpathSync(attachedDbPath),
      );
      expect(db.location("second_attached")).toBe(
        fs.realpathSync(secondAttachedPath),
      );

      db.close();
    } finally {
      // No need for manual cleanup with test-utils
    }
  });

  test("location() throws when database is closed", () => {
    const db = new DatabaseSync(dbPath);
    db.close();

    expect(() => db.location()).toThrow(/not open/i);
    expect(() => db.location("main")).toThrow(/not open/i);
  });

  test("location() handles edge cases with database names", () => {
    const db = new DatabaseSync(dbPath);

    // Empty string should be treated as invalid
    expect(db.location("")).toBeNull();

    // Case sensitivity test (SQLite database names are case insensitive)
    db.exec(`ATTACH DATABASE '${attachedDbPath}' AS TestDB`);
    expect(db.location("TestDB")).toBe(fs.realpathSync(attachedDbPath));
    expect(db.location("testdb")).toBe(fs.realpathSync(attachedDbPath)); // SQLite is case insensitive for database names

    db.close();
  });

  test("location() works after detaching databases", () => {
    const db = new DatabaseSync(dbPath);

    // Attach and then detach a database
    db.exec(`ATTACH DATABASE '${attachedDbPath}' AS temp_db`);
    expect(db.location("temp_db")).toBe(fs.realpathSync(attachedDbPath));

    db.exec("DETACH DATABASE temp_db");
    expect(db.location("temp_db")).toBeNull();

    // Main database should still work
    expect(db.location()).toBe(fs.realpathSync(dbPath));

    db.close();
  });

  test("location() type signature matches Node.js API", () => {
    const db = new DatabaseSync(":memory:");

    // Test that it's a function
    expect(typeof db.location).toBe("function");

    // Test return types
    const result1: string | null = db.location();
    const result2: string | null = db.location("main");

    expect(result1).toBeNull(); // in-memory database
    expect(result2).toBeNull(); // in-memory database

    db.close();
  });

  test("location() works with special database names", () => {
    const db = new DatabaseSync(dbPath);

    // Attach database with special characters (within SQLite identifier rules)
    const specialPath = getDbPath("special-db_123.db");
    db.exec(`ATTACH DATABASE '${specialPath}' AS "special_db_123"`);

    expect(db.location("special_db_123")).toBe(fs.realpathSync(specialPath));

    db.close();
    // No need for manual cleanup with test-utils
  });
});
