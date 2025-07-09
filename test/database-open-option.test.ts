import { DatabaseSync } from "../src/index";
import { useTempDir } from "./test-utils";

describe("DatabaseSync open option", () => {
  const tempDir = useTempDir();

  describe("when open is false", () => {
    test("should not open database immediately", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath, { open: false });

      // Database should not be open
      expect(db.isOpen).toBe(false);

      // Attempting to use the database should throw
      expect(() => {
        db.exec("CREATE TABLE test (id INTEGER)");
      }).toThrow(/database is not open/i);

      // Now open the database manually
      db.open();
      expect(db.isOpen).toBe(true);

      // Now operations should work
      db.exec("CREATE TABLE test (id INTEGER)");
      db.exec("INSERT INTO test VALUES (1), (2), (3)");

      const stmt = db.prepare("SELECT COUNT(*) as count FROM test");
      const result = stmt.get();
      expect(result.count).toBe(3);

      db.close();
    });

    test("should preserve other options when opened later", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath, {
        open: false,
        readOnly: false,
        enableForeignKeyConstraints: true,
        timeout: 5000,
      });

      expect(db.isOpen).toBe(false);

      // Open the database
      db.open();
      expect(db.isOpen).toBe(true);

      // Foreign keys should be enabled
      const fkResult = db.prepare("PRAGMA foreign_keys").get();
      expect(fkResult.foreign_keys).toBe(1);

      // Timeout should be set
      const timeoutResult = db.prepare("PRAGMA busy_timeout").get();
      expect(timeoutResult?.timeout).toBe(5000);

      db.close();
    });

    test("should throw when calling open() twice", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath, { open: false });

      db.open();
      expect(db.isOpen).toBe(true);

      // Second open should throw
      expect(() => {
        db.open();
      }).toThrow(/database is already open/i);

      db.close();
    });

    test("should work with prepare before open", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath, { open: false });

      // Prepare should throw when database is not open
      expect(() => {
        db.prepare("SELECT 1");
      }).toThrow(/database is not open/i);

      db.open();

      // Now prepare should work
      const stmt = db.prepare("SELECT 1 as one");
      const result = stmt.get();
      expect(result.one).toBe(1);

      db.close();
    });
  });

  describe("when open is true (default)", () => {
    test("should open database immediately", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath, { open: true });

      expect(db.isOpen).toBe(true);

      // Should be able to use immediately
      db.exec("CREATE TABLE test (id INTEGER)");

      db.close();
    });

    test("should open database when open option is not specified", () => {
      const dbPath = tempDir.getDbPath();
      const db = new DatabaseSync(dbPath);

      expect(db.isOpen).toBe(true);

      // Should be able to use immediately
      db.exec("CREATE TABLE test (id INTEGER)");

      db.close();
    });
  });

  describe("edge cases", () => {
    test("should handle undefined and null open values", () => {
      const dbPath = tempDir.getDbPath();

      // undefined should default to true - test by omitting the property
      const db1 = new DatabaseSync(dbPath, {});
      expect(db1.isOpen).toBe(true);
      db1.close();

      // null should be treated as invalid (not a boolean)
      // This depends on the implementation - it might default to true
      // or might be treated as a non-boolean value
      const db2 = new DatabaseSync(dbPath, { open: null as any });
      expect(db2.isOpen).toBe(true); // Defaults to true for non-boolean
      db2.close();
    });

    test("should handle creating database with empty path when open is false", () => {
      // This test verifies the behavior when empty path is provided at construction
      // but open is false - the database should be created but not opened
      // SQLite treats empty paths as temporary databases
      const db = new DatabaseSync("", { open: false });

      // Should not throw during construction
      expect(db.isOpen).toBe(false);

      // Opening with empty path should succeed (SQLite treats it as temporary DB)
      db.open();
      expect(db.isOpen).toBe(true);
      expect(db.location()).toBe(null); // Empty path results in null location

      db.close();
    });
  });
});
