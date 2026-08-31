/**
 * Tests for the setAuthorizer API
 * Based on Node.js test-sqlite-authz.js from commit 18c79d9e1ce
 */

import { DatabaseSync, constants } from "../src";

describe("DatabaseSync.prototype.setAuthorizer()", () => {
  /**
   * Helper to create a test database with a users table
   */
  const createTestDatabase = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    return db;
  };

  describe("callback parameters", () => {
    it("receives correct parameters for SELECT operations", () => {
      const calls: any[][] = [];
      const authorizer = (
        actionCode: number,
        arg1: string | null,
        arg2: string | null,
        arg3: string | null,
        arg4: string | null,
      ) => {
        calls.push([actionCode, arg1, arg2, arg3, arg4]);
        return constants.SQLITE_OK;
      };
      const db = createTestDatabase();

      db.setAuthorizer(authorizer);
      db.prepare("SELECT id FROM users").get();
      db.close();

      expect(calls.length).toBe(2);
      expect(calls).toEqual([
        [constants.SQLITE_SELECT, null, null, null, null],
        [constants.SQLITE_READ, "users", "id", "main", null],
      ]);
    });

    it("receives correct parameters for INSERT operations", () => {
      const calls: any[][] = [];
      const authorizer = (
        actionCode: number,
        arg1: string | null,
        arg2: string | null,
        arg3: string | null,
        arg4: string | null,
      ) => {
        calls.push([actionCode, arg1, arg2, arg3, arg4]);
        return constants.SQLITE_OK;
      };
      const db = createTestDatabase();

      db.setAuthorizer(authorizer);
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "node");
      db.close();

      expect(calls.length).toBe(1);
      expect(calls).toEqual([
        [constants.SQLITE_INSERT, "users", null, "main", null],
      ]);
    });
  });

  describe("authorization result codes", () => {
    it("allows operations when authorizer returns SQLITE_OK", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => constants.SQLITE_OK);

      db.exec("CREATE TABLE users (id INTEGER, name TEXT)");
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      db.close();

      expect(tables[0].name).toBe("users");
    });

    it("blocks operations when authorizer returns SQLITE_DENY", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => constants.SQLITE_DENY);

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow(/not authorized/);
      db.close();
    });
  });

  describe("SQLITE_IGNORE behavior", () => {
    it("ignores SELECT operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_SELECT) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      // SELECT should be ignored and return no results
      const result = db.prepare("SELECT * FROM users").all();
      db.close();

      expect(result).toEqual([]);
    });

    it("ignores READ operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      db.setAuthorizer((actionCode, arg1, arg2) => {
        if (
          actionCode === constants.SQLITE_READ &&
          arg1 === "users" &&
          arg2 === "name"
        ) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      // Reading the 'name' column should be ignored, returning NULL
      const result = db
        .prepare("SELECT id, name FROM users WHERE id = 1")
        .get() as { id: number; name: string | null };
      db.close();

      expect(result.id).toBe(1);
      expect(result.name).toBeNull();
    });

    it("ignores INSERT operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_INSERT) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(1, "Alice");

      // Verify no data was inserted
      db.setAuthorizer(null);
      const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
        count: number;
      };
      db.close();

      expect(count.count).toBe(0);
    });

    it("ignores UPDATE operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

      db.setAuthorizer((actionCode) => {
        if (actionCode === constants.SQLITE_UPDATE) {
          return constants.SQLITE_IGNORE;
        }
        return constants.SQLITE_OK;
      });

      db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Bob", 1);

      // Verify data was not updated
      db.setAuthorizer(null);
      const result = db
        .prepare("SELECT name FROM users WHERE id = 1")
        .get() as {
        name: string;
      };
      db.close();

      expect(result.name).toBe("Alice");
    });

    it("ignores DELETE operations when authorizer returns SQLITE_IGNORE", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

      db.setAuthorizer(() => constants.SQLITE_IGNORE);

      db.prepare("DELETE FROM users WHERE id = ?").run(1);

      db.setAuthorizer(null);

      // Verify data was not deleted
      const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
        count: number;
      };
      db.close();

      expect(count.count).toBe(1);
    });
  });

  describe("error handling", () => {
    it("rethrows error when authorizer throws error", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => {
        throw new Error("Unknown error");
      });

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow("Unknown error");
      db.close();
    });

    it("preserves a primitive thrown by the authorizer", () => {
      const db = new DatabaseSync(":memory:");
      const thrown = 12345;
      db.setAuthorizer(() => {
        throw thrown;
      });

      let caught: unknown;
      try {
        db.exec("SELECT 1");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(thrown);

      db.setAuthorizer(null);
      db.close();
    });

    it("preserves a thrown Error subclass with custom properties", () => {
      // The deferred exception is held as a Napi::Error reference, so the exact
      // thrown value (subclass, code, custom fields, message) must survive the
      // authorizer -> SQLite -> caller round trip.
      const db = new DatabaseSync(":memory:");
      class AuthzError extends Error {
        code = "MY_AUTHZ";
        detail = { attempts: 3 };
      }
      db.setAuthorizer(() => {
        throw new AuthzError("denied");
      });

      let caught: any;
      try {
        db.exec("SELECT 1");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuthzError);
      expect(caught.code).toBe("MY_AUTHZ");
      expect(caught.detail).toEqual({ attempts: 3 });
      expect(caught.message).toBe("denied");

      db.setAuthorizer(null);
      db.close();
    });

    it("stays GC-safe after an authorizer throws (deferred reference lifetime)", () => {
      if (typeof global.gc !== "function") {
        throw new Error(
          "this test must run under --expose-gc (jest is configured to)",
        );
      }

      // DatabaseSync owns a deferred Napi::Error, which holds a persistent
      // reference to the thrown JavaScript value. If that reference survived to
      // ObjectWrap finalization it would recreate the Alpine/musl crash that
      // removed database_ref_ in commits 0691ae5 / 4da0638. Every operation must
      // clear it before returning to JS, so forcing GC over many
      // throw-and-abandon databases must not crash.
      for (let i = 0; i < 100; i++) {
        const db = new DatabaseSync(":memory:");
        db.setAuthorizer(() => {
          throw new Error(`denied ${i}`);
        });
        expect(() => db.prepare(`SELECT ${i}`)).toThrow(`denied ${i}`);
        // Abandon roughly half without close() so the finalizer runs on a
        // database that has exercised the deferred-exception path.
        if (i % 2 === 0) db.close();
      }
      global.gc();
      global.gc();
      // The addon must still be functional after those finalizers ran.
      const db = new DatabaseSync(":memory:");
      expect(db.prepare("SELECT 42 AS v").get()).toEqual({ v: 42 });
      db.close();
    });

    it("throws error when authorizer returns nothing", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer((() => {
        // Returns undefined
      }) as unknown as () => number);

      expect(() => {
        db.exec("SELECT 1");
      }).toThrow(
        "Authorizer callback must return an integer authorization code",
      );
      db.close();
    });

    it.each([NaN, -0, 0.5, 4294967296])(
      "throws TypeError when authorizer returns non-Int32 number %s",
      (value) => {
        const db = new DatabaseSync(":memory:");
        db.setAuthorizer(() => value);

        let caught: unknown;
        try {
          db.exec("SELECT 1");
        } catch (error) {
          caught = error;
        }
        expect(caught).toEqual(
          expect.objectContaining({
            name: "TypeError",
            message:
              "Authorizer callback must return an integer authorization code",
          }),
        );
        db.close();
      },
    );

    it("throws error when authorizer returns an invalid code", () => {
      const db = new DatabaseSync(":memory:");
      db.setAuthorizer(() => {
        return 3; // Invalid - only SQLITE_OK (0), SQLITE_DENY (1), SQLITE_IGNORE (2) are valid
      });

      let caught: unknown;
      try {
        db.exec("SELECT 1");
      } catch (error) {
        caught = error;
      }

      // Node v26.5 uses RangeError for an integer outside OK/DENY/IGNORE;
      // non-integer callback results use TypeError instead.
      expect(caught).toEqual(
        expect.objectContaining({
          // Native exceptions cross Jest's VM realm, so constructor identity
          // is not stable even though the observable error subclass is.
          name: "RangeError",
          message: expect.stringMatching(
            /Authorizer callback returned a.* invalid authorization code/,
          ),
        }),
      );
      db.close();
    });

    it("handles exceptions without corrupting subsequent operations", () => {
      const db = new DatabaseSync(":memory:");

      // Authorizer that throws on SELECT
      db.setAuthorizer((action: number) => {
        if (action === constants.SQLITE_SELECT) {
          throw new Error("Denied!");
        }
        return constants.SQLITE_OK;
      });

      // This should be denied (due to thrown exception)
      expect(() => {
        db.prepare("SELECT 1");
      }).toThrow("Denied!");

      // Remove authorizer
      db.setAuthorizer(null);

      // Subsequent operations should work normally
      // (This would fail if exception was still pending)
      const result = db.prepare("SELECT 2 as val").get() as { val: number };
      expect(result.val).toBe(2);

      db.close();
    });

    it("handles exceptions across multiple authorization checks", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t1 (x); CREATE TABLE t2 (y)");

      let callCount = 0;
      db.setAuthorizer(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Second check denied");
        }
        return constants.SQLITE_OK;
      });

      // JOIN triggers multiple auth checks
      expect(() => {
        db.prepare("SELECT * FROM t1 JOIN t2");
      }).toThrow("Second check denied");

      db.setAuthorizer(null);

      // Should still work
      db.exec("INSERT INTO t1 VALUES (1)");

      db.close();
    });

    it.each([
      ["all()", (statement: any) => statement.all()],
      ["iterator.next()", (statement: any) => statement.iterate().next()],
      [
        "iterator.toArray()",
        (statement: any) =>
          (
            statement.iterate() as IterableIterator<unknown> & {
              toArray(): unknown[];
            }
          ).toArray(),
      ],
    ])(
      "preserves an authorizer exception during %s auto-reprepare",
      (_name, execute) => {
        const db = new DatabaseSync(":memory:");
        db.exec(
          "CREATE TABLE source (value); " +
            "CREATE TABLE target (value UNIQUE); " +
            "INSERT INTO source VALUES (1); " +
            "INSERT INTO target VALUES (1)",
        );

        // Installing an authorizer expires both statements. Their next step
        // auto-reprepares and invokes the callback from sqlite3_step().
        const query = db.prepare("SELECT value FROM source");
        const duplicate = db.prepare("INSERT INTO target VALUES (1)");
        const boom = Object.assign(new TypeError("REPREPARE_BOOM"), {
          code: "ERR_REPREPARE_BOOM",
        });

        db.setAuthorizer(() => {
          throw boom;
        });

        let caught: unknown;
        try {
          execute(query);
        } catch (error) {
          caught = error;
        }

        // A missed deferred-error handoff also poisons the next SQLite error.
        db.setAuthorizer(null);
        let laterError: unknown;
        try {
          duplicate.run();
        } catch (error) {
          laterError = error;
        }
        db.close();

        expect(caught).toBe(boom);
        expect(laterError).not.toBe(boom);
        expect(laterError).toEqual(
          expect.objectContaining({
            code: "ERR_SQLITE_ERROR",
            message: expect.stringMatching(/constraint|unique/i),
          }),
        );
      },
    );

    it.each(["changeset", "patchset"] as const)(
      "preserves an authorizer exception during session.%s()",
      (method) => {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE data (id PRIMARY KEY)");
        const session = db.createSession({ table: "data" });
        db.exec("INSERT INTO data VALUES (1)");
        const boom = Object.assign(new TypeError("SESSION_BOOM"), {
          code: "ERR_SESSION_BOOM",
        });

        db.setAuthorizer(() => {
          throw boom;
        });

        let caught: unknown;
        try {
          session[method]();
        } catch (error) {
          caught = error;
        }

        db.setAuthorizer(null);
        session.close();
        db.close();
        expect(caught).toBe(boom);
      },
    );

    it("preserves an authorizer exception during applyChangeset()", () => {
      const source = new DatabaseSync(":memory:");
      source.exec("CREATE TABLE data (id PRIMARY KEY)");
      const session = source.createSession({ table: "data" });
      source.exec("INSERT INTO data VALUES (1)");
      const changeset = session.changeset();
      session.close();
      source.close();

      const target = new DatabaseSync(":memory:");
      target.exec("CREATE TABLE data (id PRIMARY KEY)");
      const boom = Object.assign(new TypeError("APPLY_CHANGESET_BOOM"), {
        code: "ERR_APPLY_CHANGESET_BOOM",
      });
      target.setAuthorizer(() => {
        throw boom;
      });

      let caught: unknown;
      try {
        target.applyChangeset(changeset);
      } catch (error) {
        caught = error;
      }

      target.setAuthorizer(null);
      target.close();
      expect(caught).toBe(boom);
    });

    it("uses a later cleanup authorizer error over a conflict error", () => {
      const source = new DatabaseSync(":memory:");
      source.exec("CREATE TABLE data (id PRIMARY KEY)");
      const session = source.createSession({ table: "data" });
      source.exec("INSERT INTO data VALUES (1)");
      const changeset = session.changeset();
      session.close();
      source.close();

      const target = new DatabaseSync(":memory:");
      target.exec(
        "CREATE TABLE data (id PRIMARY KEY); INSERT INTO data VALUES (1)",
      );
      const conflictBoom = new RangeError("CONFLICT_BOOM");
      const authorizerBoom = new TypeError("CLEANUP_AUTHORIZER_BOOM");
      let conflictSeen = false;

      target.setAuthorizer((actionCode, arg1) => {
        if (
          conflictSeen &&
          actionCode === constants.SQLITE_SAVEPOINT &&
          arg1 === "RELEASE"
        ) {
          throw authorizerBoom;
        }
        return constants.SQLITE_OK;
      });

      let caught: unknown;
      try {
        target.applyChangeset(changeset, {
          onConflict: () => {
            conflictSeen = true;
            throw conflictBoom;
          },
        });
      } catch (error) {
        caught = error;
      }

      target.setAuthorizer(null);
      target.close();

      // Node v26.5 surfaces the later exception from SQLite's cleanup SQL.
      expect(caught).toBe(authorizerBoom);
    });
  });

  describe("same-connection reentry", () => {
    it("rejects operations that modify the invoking connection", () => {
      const db = new DatabaseSync(":memory:");
      const stmt = db.prepare("SELECT 42 AS value");
      const errors = new Map<string, unknown>();
      let checked = false;

      const capture = (name: string, operation: () => unknown) => {
        try {
          operation();
        } catch (error) {
          errors.set(name, error);
        }
      };

      db.setAuthorizer(() => {
        // Nested prepare/exec/serialize invoke the authorizer again on the
        // broken implementation. Run the checks only in the outer callback.
        if (!checked) {
          checked = true;
          capture("prepare", () => db.prepare("SELECT 2"));
          capture("exec", () => db.exec("SELECT 3"));
          capture("step", () => stmt.get());
          capture("serialize", () => db.serialize());
          // Keep this last: without a guard it removes the callback currently
          // being dispatched through.
          capture("setAuthorizer", () => db.setAuthorizer(null));
        }
        return constants.SQLITE_OK;
      });

      db.prepare("SELECT 1");

      for (const name of [
        "prepare",
        "exec",
        "step",
        "serialize",
        "setAuthorizer",
      ]) {
        expect(errors.get(name)).toEqual(
          expect.objectContaining({
            code: "ERR_INVALID_STATE",
            message: expect.stringContaining("authorizer callback"),
          }),
        );
      }

      db.setAuthorizer(null);
      db.close();
    });

    it("allows finalizing an idle statement on the invoking connection", () => {
      // An idle statement has no virtual machine or locks to release, so
      // finalizing it from the callback disturbs nothing.
      const db = new DatabaseSync(":memory:");
      const closeTarget = db.prepare("SELECT 42 AS value");
      const disposeTarget = db.prepare("SELECT 43 AS value");
      let closeError: unknown;
      let checked = false;

      db.setAuthorizer(() => {
        if (!checked) {
          checked = true;
          try {
            closeTarget.close();
            disposeTarget[Symbol.dispose]();
          } catch (error) {
            closeError = error;
          }
        }
        return constants.SQLITE_OK;
      });

      db.prepare("SELECT 1");
      db.setAuthorizer(null);

      expect(closeError).toBeUndefined();
      // Both were finalized, so both now reject.
      expect(() => closeTarget.get()).toThrow(/statement has been finalized/);
      expect(() => disposeTarget.get()).toThrow(/statement has been finalized/);

      db.close();
    });

    it("rejects finalizing a busy statement on the invoking connection", () => {
      // A paused iterator holds a live virtual machine and its locks;
      // finalizing it from the callback would change the outer statement's
      // outcome, so close() and dispose() both reject.
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE t (x INTEGER)");
      db.exec("INSERT INTO t VALUES (1), (2), (3)");
      const stmt = db.prepare("SELECT x FROM t");
      const iter = stmt.iterate();
      iter.next();

      let closeError: unknown;
      let checked = false;

      db.setAuthorizer(() => {
        if (!checked) {
          checked = true;
          try {
            stmt.close();
          } catch (error) {
            closeError = error;
          }
        }
        return constants.SQLITE_OK;
      });

      db.prepare("SELECT 1");
      db.setAuthorizer(null);

      expect(closeError).toEqual(
        expect.objectContaining({
          code: "ERR_INVALID_STATE",
          message: "database cannot be accessed from an authorizer callback",
        }),
      );

      // Not finalized, so the iterator still works.
      iter.return?.();
      db.close();
    });

    // node:sqlite raises its callback depth from the authorizer callback
    // itself, so close()/deserialize() report the callback reason there rather
    // than the generic authorizer one. Our step-scope counter is not raised by
    // sqlite3session_changeset(), which runs its own SAVEPOINT/SELECT, so this
    // pins the case where an authorizer fires outside any step scope.
    // Expected strings from src/upstream/node_sqlite.cc:1579 and :2020.
    it("reports the callback reason for close() during changeset generation", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE data(key INTEGER PRIMARY KEY, value TEXT)");
      const session = db.createSession({ table: "data" });
      db.exec("INSERT INTO data VALUES (1, 'a')");

      let closeError: unknown;
      db.setAuthorizer(() => {
        try {
          db.close();
        } catch (error) {
          closeError = error;
        }
        return constants.SQLITE_OK;
      });

      session.changeset();
      db.setAuthorizer(null);

      expect(closeError).toEqual(
        expect.objectContaining({
          code: "ERR_INVALID_STATE",
          message: "database cannot be closed while in a callback",
        }),
      );

      session.close();
      db.close();
    });

    // node:sqlite's Session::Close guards only on database-open, session-open,
    // and is_generating_changeset_ (src/upstream/node_sqlite.cc:4324) -- it has
    // no authorizer guard, so an idle session can be closed from an unrelated
    // authorizer callback.
    it("allows closing an idle session from an unrelated authorizer", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE data(key INTEGER PRIMARY KEY)");
      const session = db.createSession({ table: "data" });
      let outcome = "authorizer callback did not run";
      let checked = false;

      db.setAuthorizer(() => {
        if (!checked) {
          checked = true;
          try {
            session.close();
            outcome = "closed";
          } catch (error) {
            outcome = `${(error as NodeJS.ErrnoException).code}`;
          }
        }
        return constants.SQLITE_OK;
      });

      db.exec("SELECT 1");
      db.setAuthorizer(null);

      expect(outcome).toBe("closed");
      // Already closed, so a second close reports that rather than succeeding.
      expect(() => session.close()).toThrow(/session is not open/);

      db.close();
    });

    // Database disposal remains a no-op while SQLite is in the callback. An
    // idle session has no in-flight work, so its disposal succeeds.
    it("disposal inside an authorizer preserves the active database", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE data(key INTEGER PRIMARY KEY)");
      const session = db.createSession({ table: "data" });
      let dbDisposeError: unknown;
      let sessionDisposeError: unknown;
      let checked = false;

      db.setAuthorizer(() => {
        if (!checked) {
          checked = true;
          try {
            db[Symbol.dispose]();
          } catch (error) {
            dbDisposeError = error;
          }
          try {
            session[Symbol.dispose]();
          } catch (error) {
            sessionDisposeError = error;
          }
        }
        return constants.SQLITE_OK;
      });

      db.exec("SELECT 1");
      db.setAuthorizer(null);

      expect(dbDisposeError).toBeUndefined();
      expect(sessionDisposeError).toBeUndefined();
      // The database is still executing the statement that fired the
      // authorizer, so its disposal was skipped rather than performed.
      expect(db.isOpen).toBe(true);
      // The idle session had nothing in flight, so its disposal went through.
      expect(() => session.close()).toThrow(/session is not open/);

      db.close();
    });

    it("allows operations on a different connection", () => {
      const outer = new DatabaseSync(":memory:");
      const inner = new DatabaseSync(":memory:");
      const innerStmt = inner.prepare("SELECT 42 AS value");
      let observed: unknown;

      outer.setAuthorizer(() => {
        observed = innerStmt.get();
        return constants.SQLITE_OK;
      });

      outer.prepare("SELECT 1");
      expect(observed).toEqual({ value: 42 });

      outer.setAuthorizer(null);
      outer.close();
      inner.close();
    });
  });

  describe("clearing authorizer", () => {
    it("clears authorizer when set to null", () => {
      let callCount = 0;
      const authorizer = () => {
        callCount++;
        return constants.SQLITE_OK;
      };
      const db = new DatabaseSync(":memory:");
      const statement = db.prepare("SELECT 1");

      // Set authorizer and verify it's called
      db.setAuthorizer(authorizer);
      statement.run();
      expect(callCount).toBe(1);

      // Clear authorizer and verify it's no longer called
      db.setAuthorizer(null);
      statement.run();
      expect(callCount).toBe(1);
      db.close();
    });
  });

  describe("invalid callback types", () => {
    it("throws when callback is a string", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer("not a function" as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is a number", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer(1 as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is an object", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer({} as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is an array", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer([] as any);
      }).toThrow(/function/);
      db.close();
    });

    it("throws when callback is undefined", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.setAuthorizer(undefined as any);
      }).toThrow(/function/);
      db.close();
    });
  });

  describe("authorization constants", () => {
    it("exports all required authorization result codes", () => {
      expect(constants.SQLITE_OK).toBeDefined();
      expect(constants.SQLITE_DENY).toBeDefined();
      expect(constants.SQLITE_IGNORE).toBeDefined();

      // Check actual values
      expect(constants.SQLITE_OK).toBe(0);
      expect(constants.SQLITE_DENY).toBe(1);
      expect(constants.SQLITE_IGNORE).toBe(2);
    });

    it("exports all required authorization action codes", () => {
      expect(constants.SQLITE_CREATE_INDEX).toBeDefined();
      expect(constants.SQLITE_CREATE_TABLE).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_INDEX).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_TABLE).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_CREATE_TEMP_VIEW).toBeDefined();
      expect(constants.SQLITE_CREATE_TRIGGER).toBeDefined();
      expect(constants.SQLITE_CREATE_VIEW).toBeDefined();
      expect(constants.SQLITE_DELETE).toBeDefined();
      expect(constants.SQLITE_DROP_INDEX).toBeDefined();
      expect(constants.SQLITE_DROP_TABLE).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_INDEX).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_TABLE).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_DROP_TEMP_VIEW).toBeDefined();
      expect(constants.SQLITE_DROP_TRIGGER).toBeDefined();
      expect(constants.SQLITE_DROP_VIEW).toBeDefined();
      expect(constants.SQLITE_INSERT).toBeDefined();
      expect(constants.SQLITE_PRAGMA).toBeDefined();
      expect(constants.SQLITE_READ).toBeDefined();
      expect(constants.SQLITE_SELECT).toBeDefined();
      expect(constants.SQLITE_TRANSACTION).toBeDefined();
      expect(constants.SQLITE_UPDATE).toBeDefined();
      expect(constants.SQLITE_ATTACH).toBeDefined();
      expect(constants.SQLITE_DETACH).toBeDefined();
      expect(constants.SQLITE_ALTER_TABLE).toBeDefined();
      expect(constants.SQLITE_REINDEX).toBeDefined();
      expect(constants.SQLITE_ANALYZE).toBeDefined();
      expect(constants.SQLITE_CREATE_VTABLE).toBeDefined();
      expect(constants.SQLITE_DROP_VTABLE).toBeDefined();
      expect(constants.SQLITE_FUNCTION).toBeDefined();
      expect(constants.SQLITE_SAVEPOINT).toBeDefined();
      expect(constants.SQLITE_COPY).toBeDefined();
      expect(constants.SQLITE_RECURSIVE).toBeDefined();
    });
  });

  describe("database state validation", () => {
    it("throws when database is not open", () => {
      const db = new DatabaseSync(":memory:");
      db.close();

      expect(() => {
        db.setAuthorizer(() => constants.SQLITE_OK);
      }).toThrow(/not open/);
    });
  });

  describe("complex scenarios", () => {
    it("can block specific table operations", () => {
      const db = createTestDatabase();
      db.exec("CREATE TABLE admin (id INTEGER, role TEXT)");

      db.setAuthorizer((_actionCode, tableName) => {
        // Block all operations on 'admin' table
        if (tableName === "admin") {
          return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });

      // Should work on users table
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (1, 'Test')");
      }).not.toThrow();

      // Should fail on admin table
      expect(() => {
        db.exec("INSERT INTO admin (id, role) VALUES (1, 'superuser')");
      }).toThrow(/not authorized/);
      db.close();
    });

    it("can log all database operations", () => {
      const operations: { action: number; table: string | null }[] = [];
      const db = createTestDatabase();

      db.setAuthorizer((actionCode, param1) => {
        operations.push({ action: actionCode, table: param1 });
        return constants.SQLITE_OK;
      });

      db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
      db.exec("UPDATE users SET name = 'Bob' WHERE id = 1");
      db.exec("SELECT * FROM users");
      db.close();

      // Should have captured INSERT, UPDATE, SELECT, and READ operations
      expect(operations.length).toBeGreaterThan(3);
      expect(
        operations.some((op) => op.action === constants.SQLITE_INSERT),
      ).toBe(true);
      expect(
        operations.some((op) => op.action === constants.SQLITE_UPDATE),
      ).toBe(true);
      expect(
        operations.some((op) => op.action === constants.SQLITE_SELECT),
      ).toBe(true);
    });

    it("can implement read-only mode dynamically", () => {
      const db = createTestDatabase();
      db.exec("INSERT INTO users (id, name) VALUES (1, 'Original')");

      // Enable read-only mode
      db.setAuthorizer((actionCode) => {
        // Block all write operations
        if (
          actionCode === constants.SQLITE_INSERT ||
          actionCode === constants.SQLITE_UPDATE ||
          actionCode === constants.SQLITE_DELETE
        ) {
          return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });

      // Reads should work
      const result = db
        .prepare("SELECT name FROM users WHERE id = 1")
        .get() as {
        name: string;
      };
      expect(result.name).toBe("Original");

      // Writes should fail
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (2, 'New')");
      }).toThrow(/not authorized/);

      // Disable read-only mode
      db.setAuthorizer(null);

      // Now writes should work
      expect(() => {
        db.exec("INSERT INTO users (id, name) VALUES (2, 'New')");
      }).not.toThrow();
      db.close();
    });
  });
});
