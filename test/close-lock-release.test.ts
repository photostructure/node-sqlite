import { DatabaseSync } from "../src";
import { useTempDir } from "./test-utils";

// When db.close() detaches live statements without finalizing their underlying
// sqlite3_stmt handles, SQLite's connection-level locks can outlive the close
// call. sqlite3_close_v2 keeps the connection alive as a "zombie" until every
// outstanding statement is finalized — so a leaked sqlite3_stmt blocks lock
// release indefinitely. This regression test exercises that path with a
// file-based database where lock leakage is observable from a second
// connection.
describe("db.close() releases SQLite locks held by detached statements", () => {
  const { getDbPath } = useTempDir("sqlite-close-lock-", {
    cleanupWalFiles: true,
  });

  test("a second connection can write after the first closes mid-iteration", () => {
    if (typeof global.gc !== "function") {
      throw new Error(
        "this test must run under --expose-gc (jest is configured to)",
      );
    }

    const dbPath = getDbPath("close-lock.db");

    const db1 = new DatabaseSync(dbPath);
    db1.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
    db1.prepare("INSERT INTO t VALUES (?, ?)").run(1, "a");
    db1.prepare("INSERT INTO t VALUES (?, ?)").run(2, "b");

    // Start iterating but do NOT exhaust. After the first .next() SQLite has
    // acquired a SHARED lock on the file and started a read transaction;
    // both persist until the underlying sqlite3_stmt is finalized.
    let iter: ReturnType<ReturnType<typeof db1.prepare>["iterate"]> | null = db1
      .prepare("SELECT * FROM t")
      .iterate();
    iter.next();

    db1.close();

    // Drop the iterator/statement reference so GC can collect it. The null is
    // never read again, but the write itself is what releases the reference.
    // eslint-disable-next-line no-useless-assignment
    iter = null;
    global.gc!();
    global.gc!();

    // With proper finalization, db1's locks have been released and a fresh
    // connection can write. With the bug, sqlite3_close_v2 left db1 zombied
    // around the unfinalized SELECT, the read lock leaked, and this INSERT
    // would block until SQLITE_BUSY (default no-busy-timeout: immediate).
    const db2 = new DatabaseSync(dbPath);
    try {
      expect(() => {
        db2.exec("INSERT INTO t VALUES (3, 'c')");
      }).not.toThrow();
    } finally {
      db2.close();
    }
  });
});
