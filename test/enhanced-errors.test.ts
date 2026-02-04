import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "../src";
import { isAlpineLinux } from "./test-utils";

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
        expect(error.code).toBe("ERR_SQLITE_ERROR"); // Node.js compatible error code
        expect(error.sqliteCodeName).toBe("SQLITE_CANTOPEN"); // SQLite error name
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

    // Skip on Alpine Linux as SQLite silently falls back to read-only mode
    // instead of throwing an error when opening a read-only file with write mode.
    // This is by design - since SQLite 3.34.0, opening with SQLITE_OPEN_READWRITE
    // falls back to read-only if write access cannot be obtained.
    // See: https://sqlite.org/forum/info/42cf8e985bb051a2
    if (isAlpineLinux()) return;

    // Skip if running as root (UID 0) - root can often bypass file permissions
    if (process.getuid && process.getuid() === 0) {
      console.log("Skipping test: running as root");
      return;
    }

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

      // Verify the file is actually read-only by checking stats
      const stats = fs.statSync(dbPath);
      const mode = stats.mode & 0o777;
      if (mode !== 0o444) {
        console.log(
          `Skipping test: chmod did not work (mode=${mode.toString(8)})`,
        );
        fs.chmodSync(dbPath, 0o644);
        fs.chmodSync(tempDir, 0o755);
        return;
      }

      // Try to open the database and perform a write operation
      // This should fail with SQLITE_READONLY or similar
      const db2 = new DatabaseSync(dbPath, { readOnly: false });
      let writeError: any = null;

      try {
        // Try to write - this should fail if the database is truly read-only
        db2.exec("CREATE TABLE test2 (id INTEGER)");
      } catch (error: any) {
        writeError = error;
      } finally {
        db2.close();
      }

      // If write succeeded, the environment doesn't enforce read-only file permissions
      // properly (e.g., Docker with overlayfs, certain filesystems)
      if (!writeError) {
        console.log(
          "Skipping test: write succeeded despite read-only file permissions",
        );
        return;
      }

      // Validate the error we caught
      // The error might be SQLITE_CANTOPEN or SQLITE_READONLY depending on SQLite version
      expect(writeError.sqliteCode).toBeGreaterThanOrEqual(8); // At least SQLITE_READONLY
      expect(writeError.sqliteExtendedCode).toBeGreaterThanOrEqual(8);

      // System errno might be set for permission errors
      // but SQLite might handle this at a higher level
      // without hitting the OS error
      console.log("Permission error systemErrno:", writeError.systemErrno);

      console.log("Permission denied error properties:", {
        sqliteCode: writeError.sqliteCode,
        sqliteExtendedCode: writeError.sqliteExtendedCode,
        systemErrno: writeError.systemErrno,
        code: writeError.code,
        message: writeError.message,
      });

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

        // Both sqliteCode and sqliteExtendedCode return the extended code
        // Extended code for UNIQUE constraint is SQLITE_CONSTRAINT_UNIQUE (2067)
        expect(error.sqliteCode).toBe(2067);
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
        expect(error.code).toBe("ERR_SQLITE_ERROR"); // Node.js compatible
        expect(error.sqliteCodeName).toBe("SQLITE_ERROR"); // SQLite name

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
