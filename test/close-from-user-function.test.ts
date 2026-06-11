import { DatabaseSync, constants } from "../src";

// SQLite forbids closing the database, finalizing/resetting the running
// statement, or recursively stepping while a user-supplied callback is on the
// stack. The native impl tracks user-callback depth on DatabaseSync and a
// per-statement `stepping_` flag; the JS-callable methods check both and
// throw ERR_INVALID_STATE rather than running the forbidden op.
//
// Without these guards the recursive operation crashes the process (UB):
//   - sqlite3_finalize on a stepping VM frees memory the outer step still
//     reads when it unwinds.
//   - sqlite3_changes / sqlite3_last_insert_rowid in Run() dereference a
//     null sqlite3* (our build has no SQLITE_ENABLE_API_ARMOR null guards).
//
// Any path that crashes brings down the Jest worker process and the suite
// fails — that's the regression detector.
describe("operations forbidden inside a user-defined function callback", () => {
  test("db.close() throws ERR_INVALID_STATE; outer query completes", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    db.prepare("INSERT INTO t VALUES (1, 10)").run();
    db.prepare("INSERT INTO t VALUES (2, 20)").run();

    let closeError: unknown;
    let invocations = 0;
    db.function("close_db", (x: unknown) => {
      invocations++;
      try {
        db.close();
      } catch (e) {
        closeError = e;
      }
      return x;
    });

    // The outer .all() runs to completion because db.close() inside the
    // callback throws synchronously and the SELECT continues unimpeded.
    const rows = db.prepare("SELECT close_db(v) AS v FROM t").all();
    expect(rows).toHaveLength(2);
    expect(invocations).toBe(2);
    expect(closeError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringContaining(
          "cannot be closed inside a user-defined function callback",
        ),
      }),
    );

    // Connection is still open after the query unwinds; closing now works.
    expect(() => db.close()).not.toThrow();
  });

  test("recursive .run() on the same statement throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();

    let recurseError: unknown;
    let sameStmtRef: ReturnType<typeof db.prepare> | null = null;
    db.function("recurse", (x: unknown) => {
      try {
        sameStmtRef!.run();
      } catch (e) {
        recurseError = e;
      }
      return x;
    });

    const sameStmt = db.prepare("SELECT recurse(id) FROM t");
    sameStmtRef = sameStmt;
    sameStmt.all();
    expect(recurseError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringContaining("currently being executed"),
      }),
    );

    db.close();
  });

  test("recursive iter.next() on the same statement throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    db.prepare("INSERT INTO t VALUES (2)").run();

    let outerIter: ReturnType<ReturnType<typeof db.prepare>["iterate"]> | null =
      null;
    let recurseError: unknown;
    db.function("recurse_iter", (x: unknown) => {
      try {
        outerIter!.next();
      } catch (e) {
        recurseError = e;
      }
      return x;
    });

    const stmt = db.prepare("SELECT recurse_iter(id) FROM t");
    outerIter = stmt.iterate();
    outerIter.next();
    expect(recurseError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringContaining("currently being executed"),
      }),
    );

    db.close();
  });

  test("recursive iter.return() on the same statement throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    db.prepare("INSERT INTO t VALUES (2)").run();

    let outerIter: ReturnType<ReturnType<typeof db.prepare>["iterate"]> | null =
      null;
    let recurseError: unknown;
    db.function("return_iter", (x: unknown) => {
      try {
        outerIter!.return!();
      } catch (e) {
        recurseError = e;
      }
      return x;
    });

    const stmt = db.prepare("SELECT return_iter(id) FROM t");
    outerIter = stmt.iterate();
    outerIter.next();
    expect(recurseError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringContaining("currently being executed"),
      }),
    );

    db.close();
  });

  test("cross-statement use inside a UDF (the lookup pattern) works", () => {
    // From upstream c02e2c093f8: SQLite only forbids reentry into the
    // *currently running* statement. Operating on a different statement
    // on the same connection — the common "lookup" pattern — must succeed.
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE lookup (id INTEGER PRIMARY KEY, label TEXT);" +
        "CREATE TABLE data (id INTEGER PRIMARY KEY, lookup_id INTEGER);" +
        "INSERT INTO lookup VALUES (1, 'one'), (2, 'two');" +
        "INSERT INTO data VALUES (1, 1), (2, 2), (3, 1);",
    );

    const lookup = db.prepare("SELECT label FROM lookup WHERE id = ?");
    db.function("label_for", (id: unknown) => {
      const row = lookup.get(id as number) as { label: string } | undefined;
      return row?.label ?? null;
    });

    const rows = db
      .prepare("SELECT label_for(lookup_id) AS label FROM data ORDER BY id")
      .all();
    expect(rows).toEqual([
      { label: "one" },
      { label: "two" },
      { label: "one" },
    ]);

    db.close();
  });

  test("db.deserialize() inside a UDF callback throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();

    let deserializeError: unknown;
    db.function("try_deserialize", (x: unknown) => {
      try {
        // Build a minimal valid sqlite db blob from a throwaway connection.
        const tmp = new DatabaseSync(":memory:");
        tmp.exec("CREATE TABLE u (id INTEGER)");
        const blob = tmp.serialize();
        tmp.close();
        db.deserialize(blob);
      } catch (e) {
        deserializeError = e;
      }
      return x;
    });

    db.prepare("SELECT try_deserialize(id) FROM t").all();
    expect(deserializeError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: expect.stringContaining(
          "not allowed inside a user-defined function callback",
        ),
      }),
    );

    db.close();
  });

  test("db.close() inside an authorizer callback during prepare throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

    let closeError: unknown;
    db.setAuthorizer(() => {
      try {
        db.close();
      } catch (e) {
        closeError = e;
      }
      return constants.SQLITE_OK;
    });

    db.prepare("SELECT id FROM t");
    expect(closeError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
      }),
    );

    db.close();
  });

  test("db.deserialize() inside an authorizer callback during prepare throws", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

    const tmp = new DatabaseSync(":memory:");
    tmp.exec("CREATE TABLE u (id INTEGER)");
    const blob = tmp.serialize();
    tmp.close();

    let deserializeError: unknown;
    db.setAuthorizer(() => {
      try {
        db.deserialize(blob);
      } catch (e) {
        deserializeError = e;
      }
      return constants.SQLITE_OK;
    });

    db.prepare("SELECT id FROM t");
    expect(deserializeError).toEqual(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
      }),
    );

    db.close();
  });

  test("db[Symbol.dispose]() inside a UDF callback is a no-op", () => {
    // Symbol.dispose deliberately swallows errors per its semantics; upstream
    // c02e2c093f8 documents this as a no-op rather than a throw.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();

    let disposeThrew = false;
    db.function("try_dispose", (x: unknown) => {
      try {
        (db as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose]();
      } catch {
        disposeThrew = true;
      }
      return x;
    });

    expect(() =>
      db.prepare("SELECT try_dispose(id) FROM t").all(),
    ).not.toThrow();
    expect(disposeThrew).toBe(false);

    // Connection is still open — dispose was a no-op.
    expect(() => db.close()).not.toThrow();
  });

  test("a fresh connection works after the reentrant scenario", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    db.function("close_db", () => {
      try {
        db.close();
      } catch {
        // expected throw
      }
      return 0;
    });
    db.prepare("SELECT close_db() FROM t").all();
    db.close();

    // The process must still be healthy enough to open a brand-new connection.
    const db2 = new DatabaseSync(":memory:");
    expect(() => db2.exec("CREATE TABLE u (id INTEGER)")).not.toThrow();
    db2.close();
  });
});
