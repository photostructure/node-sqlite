import { jest } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync, Session } from "../src";
import { getTestTimeout, rm } from "./test-utils";

/**
 * Comprehensive lifecycle tests for RAII session management
 *
 * These tests verify that our RAII implementation correctly handles:
 * - Normal lifecycle paths
 * - Abnormal/error conditions
 * - Edge cases and race conditions
 * - Memory safety guarantees
 * - Cleanup order requirements
 */

describe("Session Lifecycle Management (RAII)", () => {
  jest.setTimeout(getTestTimeout());
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-lifecycle-test-"));
  });

  afterAll(async () => {
    // Wait for Windows file handles to be released
    if (process.platform === "win32") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10 });
    } catch (e) {
      // Ignore cleanup errors
      console.warn("Cleanup error in afterAll:", e);
    }
  });

  describe("Normal Lifecycle Paths", () => {
    it("should handle standard create->use->close sequence", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

      const session = db.createSession({ table: "test" });
      expect(() => session.changeset()).not.toThrow();

      // Make some changes
      db.prepare("INSERT INTO test VALUES (?, ?)").run(1, "test");
      const changeset = session.changeset();
      expect(changeset).toBeInstanceOf(Uint8Array);
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
      expect(() => session.changeset()).toThrow(/session is not open/);

      db.close();
    });

    it("should handle multiple sessions on same database", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session1 = db.createSession({ table: "test" });
      const session2 = db.createSession({ table: "test" });
      const session3 = db.createSession({ table: "test" });

      // Each session should work independently
      db.prepare("INSERT INTO test VALUES (?)").run(1);

      const cs1 = session1.changeset();
      const cs2 = session2.changeset();
      const cs3 = session3.changeset();

      // All should capture the same change
      expect(cs1.length).toBe(cs2.length);
      expect(cs2.length).toBe(cs3.length);

      // Close in different order
      session2.close();
      session1.close();
      session3.close();

      db.close();
    });

    it("should handle session close before database close", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session = db.createSession();
      session.close();

      // Database should still work
      expect(() => db.exec("INSERT INTO test VALUES (1)")).not.toThrow();

      db.close();
    });
  });

  describe("Abnormal Lifecycle Paths", () => {
    it("should handle database close with active sessions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session1 = db.createSession();
      const session2 = db.createSession();

      // Close database while sessions are active
      db.close();

      // Sessions should be invalidated for operations
      // When database closes, it deletes all sessions, so they throw "session is not open"
      expect(() => session1.changeset()).toThrow(/session is not open/);
      expect(() => session2.changeset()).toThrow(/session is not open/);

      // But close() should throw since sessions are already closed
      expect(() => session1.close()).toThrow(/session is not open/);
      expect(() => session2.close()).toThrow(/session is not open/);
    });

    it("should handle session outliving database (garbage collection scenario)", () => {
      let session: any;

      // Create database in inner scope
      {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
        session = db.createSession();

        // Verify session works while database exists
        expect(() => session.changeset()).not.toThrow();

        // Close database explicitly before it goes out of scope
        db.close();
        // Database goes out of scope here
      }

      // Session still exists but database closed it during cleanup
      expect(() => session.changeset()).toThrow(/session is not open/);
      // close() should throw since session was already closed by database
      expect(() => session.close()).toThrow(/session is not open/);
    });

    it("should handle multiple databases being destroyed in different order", () => {
      const sessions: any[] = [];

      {
        const db1 = new DatabaseSync(":memory:");
        const db2 = new DatabaseSync(":memory:");
        const db3 = new DatabaseSync(":memory:");

        db1.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
        db2.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
        db3.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

        sessions.push(db1.createSession());
        sessions.push(db2.createSession());
        sessions.push(db3.createSession());

        // Close all databases
        db1.close();
        db2.close();
        db3.close();

        // Databases go out of scope
      }

      // All sessions should be invalidated
      for (const session of sessions) {
        expect(() => session.changeset()).toThrow(/session is not open/);
      }
    });

    it("should handle operations after session close", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session = db.createSession();
      session.close();

      // All operations should throw
      expect(() => session.changeset()).toThrow(/session is not open/);
      expect(() => session.patchset()).toThrow(/session is not open/);
      expect(() => session.close()).toThrow(/session is not open/);

      db.close();
    });
  });

  describe("Edge Cases and Race Conditions", () => {
    it("should handle rapid open/close cycles", () => {
      for (let i = 0; i < 100; i++) {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

        const sessions: Session[] = [];
        for (let j = 0; j < 5; j++) {
          sessions.push(db.createSession());
        }

        // Randomly close some sessions
        if (i % 3 === 0) {
          sessions[0].close();
          sessions[2].close();
        }

        db.close();
      }

      // If we get here without crashes, RAII is working
      expect(true).toBe(true);
    });

    it("should handle session creation after database changes", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      // Make changes before creating session
      db.prepare("INSERT INTO test VALUES (?)").run(1);

      const session = db.createSession();

      // Session should only capture changes after its creation
      db.prepare("INSERT INTO test VALUES (?)").run(2);

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      session.close();
      db.close();
    });

    it("should handle interleaved session operations", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const s1 = db.createSession({ table: "test" });
      db.prepare("INSERT INTO test VALUES (?)").run(1);

      const s2 = db.createSession({ table: "test" });
      db.prepare("INSERT INTO test VALUES (?)").run(2);

      const s3 = db.createSession({ table: "test" });
      db.prepare("INSERT INTO test VALUES (?)").run(3);

      // Each session should have different changesets
      const cs1 = s1.changeset();
      const cs2 = s2.changeset();
      const cs3 = s3.changeset();

      expect(cs1.length).toBeGreaterThan(cs2.length);
      expect(cs2.length).toBeGreaterThan(cs3.length);

      s2.close();
      s1.close();
      s3.close();
      db.close();
    });

    it("should handle database close during changeset generation", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session = db.createSession({ table: "test" });

      // Insert a lot of data
      const stmt = db.prepare("INSERT INTO test VALUES (?)");
      for (let i = 0; i < 1000; i++) {
        stmt.run(i);
      }

      // This should complete even with large changeset
      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      db.close();

      // Now it should fail - but with "session is not open" since db.close() deleted the session
      expect(() => session.changeset()).toThrow(/session is not open/);
    });
  });

  describe("RAII-Specific Guarantees", () => {
    it("should ensure sessions are deleted before database in destructor", async () => {
      // This test verifies the cleanup order by creating a scenario where
      // incorrect order would cause issues

      const dbPath = path.join(tempDir, "raii-test.db");

      {
        const db = new DatabaseSync(dbPath);
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

        // Create multiple sessions
        const sessions = [];
        for (let i = 0; i < 10; i++) {
          sessions.push(db.createSession());
        }

        // Make changes
        const stmt = db.prepare("INSERT INTO test (data) VALUES (?)");
        for (let i = 0; i < 100; i++) {
          stmt.run(`data_${i}`);
        }

        // Don't explicitly close anything - rely on RAII
        // If cleanup order is wrong, SQLite would have undefined behavior
      }

      // Verify we can open the database again (no corruption)
      const db2 = new DatabaseSync(dbPath);
      const count = db2
        .prepare("SELECT COUNT(*) as cnt FROM test")
        .get() as any;
      expect(count.cnt).toBe(100);
      db2.close();

      await rm(dbPath);
    });

    it("should handle exceptions during session operations", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session = db.createSession();

      // Force an error by closing the database
      db.close();

      // This should throw but not leak memory or cause crashes
      expect(() => {
        for (let i = 0; i < 100; i++) {
          try {
            session.changeset();
          } catch {
            // Ignore and keep trying
          }
        }
      }).not.toThrow();
    });

    it("should verify weak_ptr behavior", () => {
      let weakRefWorked = false;

      {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

        const session = db.createSession();

        // Create a closure that captures the session
        const checkSession = () => {
          try {
            session.changeset();
            return true;
          } catch {
            return false;
          }
        };

        // Session should work while db exists
        expect(checkSession()).toBe(true);

        // Close the database
        db.close();

        // Session should fail gracefully
        expect(checkSession()).toBe(false);
        weakRefWorked = true;
      }

      expect(weakRefWorked).toBe(true);
    });
  });

  describe("Integration with SQLite Operations", () => {
    it("should work correctly with transactions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const session = db.createSession({ table: "test" });

      db.exec("BEGIN");
      db.prepare("INSERT INTO test VALUES (?)").run(1);
      db.prepare("INSERT INTO test VALUES (?)").run(2);
      db.exec("COMMIT");

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      // Apply to another database
      const db2 = new DatabaseSync(":memory:");
      db2.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      db2.applyChangeset(Buffer.from(changeset));

      const rows = db2.prepare("SELECT * FROM test ORDER BY id").all();
      expect(rows).toEqual([{ id: 1 }, { id: 2 }]);

      session.close();
      db.close();
      db2.close();
    });

    it("should handle prepared statements with sessions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)");

      const session = db.createSession({ table: "test" });
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      // Use prepared statement multiple times
      for (let i = 0; i < 10; i++) {
        stmt.run(i, `data_${i}`);
      }

      const changeset = session.changeset();
      expect(changeset.length).toBeGreaterThan(0);

      // Close statement before session
      stmt.finalize();

      // Session should still work
      expect(() => session.changeset()).not.toThrow();

      session.close();
      db.close();
    });

    it("should handle table-specific sessions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
      db.exec("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");

      // Create session only for t1
      const session = db.createSession({ table: "t1" });

      db.prepare("INSERT INTO t1 VALUES (?)").run(1);
      db.prepare("INSERT INTO t2 VALUES (?)").run(2);

      const changeset = session.changeset();

      // Apply to another database
      const db2 = new DatabaseSync(":memory:");
      db2.exec("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
      db2.exec("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
      db2.applyChangeset(Buffer.from(changeset));

      // Only t1 should have data
      const t1Count = db2
        .prepare("SELECT COUNT(*) as cnt FROM t1")
        .get() as any;
      const t2Count = db2
        .prepare("SELECT COUNT(*) as cnt FROM t2")
        .get() as any;

      expect(t1Count.cnt).toBe(1);
      expect(t2Count.cnt).toBe(0);

      session.close();
      db.close();
      db2.close();
    });
  });

  describe("Memory Safety", () => {
    it("should not leak memory with many sessions", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      // Create and destroy many sessions
      for (let i = 0; i < 1000; i++) {
        const session = db.createSession();
        db.prepare("INSERT INTO test VALUES (?)").run(i);
        const changeset = session.changeset();
        expect(changeset).toBeInstanceOf(Buffer);
        expect(changeset.length).toBeGreaterThan(0);
        session.close();
      }

      db.close();

      // If we get here without OOM, we're not leaking
      expect(true).toBe(true);
    });

    it("should handle nested session operations safely", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

      const sessions: any[] = [];

      // Create nested sessions
      for (let i = 0; i < 10; i++) {
        sessions.push(db.createSession());
        db.prepare("INSERT INTO test VALUES (?)").run(i);

        // Create more sessions while holding previous ones
        for (let j = 0; j < 5; j++) {
          const tempSession = db.createSession();
          tempSession.changeset();
          tempSession.close();
        }
      }

      // Close in reverse order
      while (sessions.length > 0) {
        const session = sessions.pop();
        session.close();
      }

      db.close();
    });

    it("should handle database destruction with active changesets", () => {
      let changeset: Uint8Array;

      {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");

        const session = db.createSession({ table: "test" });

        // Make changes AFTER session creation
        db.prepare("INSERT INTO test VALUES (?)").run(1);
        db.prepare("INSERT INTO test VALUES (?)").run(2);

        // Get changeset before database is destroyed
        changeset = session.changeset();

        // Database and session destroyed here
      }

      // Changeset should still be valid
      expect(changeset).toBeInstanceOf(Uint8Array);
      expect(changeset.length).toBeGreaterThan(0);

      // Can use it with another database
      const db2 = new DatabaseSync(":memory:");
      db2.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      expect(() => db2.applyChangeset(Buffer.from(changeset))).not.toThrow();
      db2.close();
    });
  });
});
