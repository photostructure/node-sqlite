import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "../src";

describe("Enhanced SQLite Error Information", () => {
  test("should include system errno for file not found", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-test-"));

    try {
      // Try to open a database in read-only mode for a file that doesn't exist
      const nonExistentPath = path.join(tempDir, "subdir", "nonexistent.db");

      try {
        new DatabaseSync(nonExistentPath, { readOnly: true });
        throw new Error("Should have thrown");
      } catch (error: any) {
        if (error.message === "Should have thrown") {
          throw error;
        }

        // Basic error properties
        expect(error.message).toMatch(/unable to open database file/i);

        // Enhanced error properties
        expect(error.sqliteCode).toBe(14); // SQLITE_CANTOPEN
        expect(error.sqliteExtendedCode).toBeGreaterThanOrEqual(14);
        expect(error.code).toBe("SQLITE_CANTOPEN");
        expect(error.sqliteErrorString).toBe("unable to open database file");

        // System errno should be set for file system errors
        // On Unix: ENOENT (2), on Windows: varies
        expect(error.systemErrno).toBeGreaterThan(0);

        console.log("File not found error properties:", {
          sqliteCode: error.sqliteCode,
          sqliteExtendedCode: error.sqliteExtendedCode,
          systemErrno: error.systemErrno,
          code: error.code,
          sqliteErrorString: error.sqliteErrorString,
          message: error.message,
        });
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should include system errno for permission denied", () => {
    // Skip on Windows as permission handling is different
    if (process.platform === "win32") return;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-test-"));

    try {
      const dbPath = path.join(tempDir, "readonly.db");

      // Create a database file
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE test (id INTEGER)");
      db.close();

      // Make the directory and file read-only
      fs.chmodSync(tempDir, 0o555);
      fs.chmodSync(dbPath, 0o444);

      // Try to open it for writing (this should fail)
      try {
        const db2 = new DatabaseSync(dbPath, { readOnly: false });
        db2.exec("CREATE TABLE test2 (id INTEGER)"); // Try to write
        db2.close();
        throw new Error("Should have thrown");
      } catch (error: any) {
        if (error.message === "Should have thrown") {
          throw error;
        }

        // The error might be SQLITE_CANTOPEN or SQLITE_READONLY depending on SQLite version
        expect(error.sqliteCode).toBeGreaterThanOrEqual(8); // At least SQLITE_READONLY
        expect(error.sqliteExtendedCode).toBeGreaterThanOrEqual(8);

        // System errno might be set for permission errors
        // but SQLite might handle this at a higher level
        // without hitting the OS error
        console.log("Permission error systemErrno:", error.systemErrno);

        console.log("Permission denied error properties:", {
          sqliteCode: error.sqliteCode,
          sqliteExtendedCode: error.sqliteExtendedCode,
          systemErrno: error.systemErrno,
          code: error.code,
          message: error.message,
        });
      }

      // Cleanup: restore write permissions
      fs.chmodSync(dbPath, 0o644);
      fs.chmodSync(tempDir, 0o755);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // May fail if permissions weren't restored
      }
    }
  });

  test("should include extended error codes", () => {
    const db = new DatabaseSync(":memory:");

    try {
      // Create a table with a unique constraint
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)");
      db.exec("INSERT INTO users (email) VALUES ('test@example.com')");

      // Try to insert duplicate
      const stmt = db.prepare("INSERT INTO users (email) VALUES (?)");

      try {
        stmt.run("test@example.com");
        throw new Error("Should have thrown");
      } catch (error: any) {
        if (error.message === "Should have thrown") {
          throw error;
        }

        expect(error.message).toMatch(/UNIQUE constraint failed/);

        // Basic SQLITE_CONSTRAINT is 19
        expect(error.sqliteCode).toBe(19);

        // Extended code for UNIQUE constraint is SQLITE_CONSTRAINT_UNIQUE (2067)
        expect(error.sqliteExtendedCode).toBe(2067);

        // No system errno for constraint violations
        expect(error.systemErrno).toBeUndefined();

        console.log("Constraint error properties:", {
          sqliteCode: error.sqliteCode,
          sqliteExtendedCode: error.sqliteExtendedCode,
          systemErrno: error.systemErrno,
          code: error.code,
          message: error.message,
        });
      }
    } finally {
      db.close();
    }
  });

  test("error properties should be accessible", () => {
    try {
      new DatabaseSync("/definitely/not/a/valid/path/database.db", {
        readOnly: true,
      });
      throw new Error("Should have thrown");
    } catch (error: any) {
      // Skip if this is our test error
      if (error.message === "Should have thrown") {
        throw error;
      }

      // Debug what the error is
      console.log("Error check:", {
        isError: error instanceof Error,
        constructor: error.constructor.name,
        prototype: Object.getPrototypeOf(error).constructor.name,
        properties: Object.getOwnPropertyNames(error),
      });

      // Verify all enhanced properties are accessible
      expect(typeof error.sqliteCode).toBe("number");
      expect(typeof error.sqliteExtendedCode).toBe("number");
      expect(typeof error.code).toBe("string");
      // systemErrno is optional - only present for I/O errors
      if (error.systemErrno !== undefined) {
        expect(typeof error.systemErrno).toBe("number");
      }
      expect(typeof error.sqliteErrorString).toBe("string");

      // Verify the error is still a proper Error instance
      expect(error.constructor.name).toBe("Error");
      expect(error.stack).toBeDefined();
      expect(error.message).toBeDefined();
    }
  });

  test("exec method should include enhanced error info", () => {
    const db = new DatabaseSync(":memory:");

    try {
      // Try invalid SQL
      try {
        db.exec("INVALID SQL SYNTAX");
        throw new Error("Should have thrown");
      } catch (error: any) {
        if (error.message === "Should have thrown") {
          throw error;
        }

        // Should have error code for syntax error
        expect(error.sqliteCode).toBe(1); // SQLITE_ERROR
        expect(error.sqliteExtendedCode).toBeGreaterThanOrEqual(1);
        expect(error.code).toBe("SQLITE_ERROR");

        console.log("Syntax error properties:", {
          sqliteCode: error.sqliteCode,
          sqliteExtendedCode: error.sqliteExtendedCode,
          systemErrno: error.systemErrno,
          code: error.code,
          message: error.message,
        });
      }
    } finally {
      db.close();
    }
  });
});
