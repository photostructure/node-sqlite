import * as fs from "node:fs";
import { DatabaseSync, Session } from "../src";

describe("Session Changeset Tests", () => {
  let db: InstanceType<typeof DatabaseSync>;
  let session: InstanceType<typeof Session>;
  const dbPath = "test_session_changeset.db";

  beforeEach(() => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    session = db.createSession({ table: "test" });
  });

  afterEach(() => {
    if (session) {
      try {
        session.close();
      } catch {
        // Ignore errors if session is already closed
      }
    }
    if (db && db.isOpen) {
      db.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  test("should record INSERT operations in a changeset", () => {
    db.exec("INSERT INTO test (id, name) VALUES (1, 'one')");
    const changeset = session.changeset();
    expect(changeset).toBeInstanceOf(Uint8Array);
    expect(changeset.length).toBeGreaterThan(0);
  });

  test("should record UPDATE operations in a changeset", () => {
    db.exec("INSERT INTO test (id, name) VALUES (1, 'one')");
    session.changeset(); // Clear initial changes
    db.exec("UPDATE test SET name = 'updated' WHERE id = 1");
    const changeset = session.changeset();
    expect(changeset).toBeInstanceOf(Uint8Array);
    expect(changeset.length).toBeGreaterThan(0);
  });

  test("should record DELETE operations in a changeset", () => {
    // Close current session and create data before session starts
    session.close();
    db.exec("INSERT INTO test (id, name) VALUES (1, 'one')");

    // Create new session after data exists
    session = db.createSession({ table: "test" });

    // Delete the existing row
    db.exec("DELETE FROM test WHERE id = 1");
    const changeset = session.changeset();
    expect(changeset).toBeInstanceOf(Uint8Array);
    expect(changeset.length).toBeGreaterThan(0);
  });

  test("should return an empty buffer when no changes have occurred", () => {
    const changeset = session.changeset();
    expect(changeset).toBeInstanceOf(Uint8Array);
    expect(changeset.length).toBe(0);
  });

  test("should throw if session is closed", () => {
    session.close();
    expect(() => session.changeset()).toThrow(/session is not open/);
  });
});
