import { DatabaseSync } from "../src";

/**
 * Tests for StatementSync.prototype.close() and [Symbol.dispose](), which
 * make statement finalization deterministic instead of waiting for GC or
 * database close.
 *
 * Mirrors node:sqlite semantics: close() throws when the statement is already
 * finalized, while Symbol.dispose is idempotent and never throws.
 */
describe("StatementSync.close() and [Symbol.dispose]()", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO test VALUES (1, 'one'), (2, 'two')");
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  describe("close()", () => {
    it("finalizes an open statement", () => {
      const stmt = db.prepare("SELECT * FROM test WHERE id = ?");
      expect(stmt.get(1)).toEqual({ id: 1, name: "one" });

      expect(() => stmt.close()).not.toThrow();
    });

    it("throws on every method after finalization", () => {
      const stmt = db.prepare("SELECT * FROM test");
      stmt.close();

      expect(() => stmt.get()).toThrow(/statement has been finalized/);
      expect(() => stmt.all()).toThrow(/statement has been finalized/);
      expect(() => stmt.run()).toThrow(/statement has been finalized/);
      expect(() => stmt.iterate()).toThrow(/statement has been finalized/);
    });

    it("throws if the statement is already finalized", () => {
      const stmt = db.prepare("SELECT * FROM test");
      stmt.close();

      expect(() => stmt.close()).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_STATE" }),
      );
    });

    it("does not prevent the database from closing afterwards", () => {
      // close() untracks the statement; the database must not then try to
      // finalize it a second time.
      const stmt = db.prepare("SELECT * FROM test");
      stmt.close();

      expect(() => db.close()).not.toThrow();
    });

    it("survives its database being finalized first", async () => {
      // Regression: close() untracks the statement from the database, so
      // FinalizeStatements() no longer visits it and nothing clears its
      // database_ back-pointer. If the DatabaseSync was then finalized first,
      // ~StatementSync called UntrackStatement() on freed memory. N-API gives
      // no ordering guarantee between the two wrappers.
      // Caught by AddressSanitizer; the read is silent without a sanitizer, so
      // this test mainly pins the ordering for the sanitizer/Valgrind runs.
      expect(typeof global.gc).toBe("function");

      let dbCollected = false;
      const registry = new FinalizationRegistry(() => {
        dbCollected = true;
      });

      let stmt: ReturnType<typeof db.prepare> | null;
      (() => {
        const scoped = new DatabaseSync(":memory:");
        registry.register(scoped, "db");
        scoped.exec("CREATE TABLE t (id INTEGER)");
        stmt = scoped.prepare("SELECT 1 AS v");
        stmt.get();
        stmt.close();
      })();

      for (let i = 0; i < 5 && !dbCollected; i++) {
        global.gc!();
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(dbCollected).toBe(true);

      // Now let the statement be finalized against the already-freed database.
      stmt = null;
      for (let i = 0; i < 5; i++) {
        global.gc!();
        await new Promise((resolve) => setImmediate(resolve));
      }
    });

    it("leaves sibling statements usable", () => {
      const first = db.prepare("SELECT * FROM test WHERE id = 1");
      const second = db.prepare("SELECT * FROM test WHERE id = 2");

      first.close();

      expect(second.get()).toEqual({ id: 2, name: "two" });
    });

    it("works on a statement whose database was already closed", () => {
      const stmt = db.prepare("SELECT * FROM test");
      db.close();

      // Closing the database finalizes tracked statements, so this reports the
      // statement as already finalized rather than crashing.
      expect(() => stmt.close()).toThrow(/statement has been finalized/);
    });
  });

  describe("[Symbol.dispose]()", () => {
    it("is exposed on the prototype", () => {
      const stmt = db.prepare("SELECT * FROM test");
      expect(typeof stmt[Symbol.dispose]).toBe("function");
      stmt.close();
    });

    it("finalizes the statement", () => {
      const stmt = db.prepare("SELECT * FROM test");
      stmt[Symbol.dispose]();

      expect(() => stmt.get()).toThrow(/statement has been finalized/);
    });

    it("is idempotent and never throws", () => {
      const stmt = db.prepare("SELECT * FROM test");

      expect(() => stmt[Symbol.dispose]()).not.toThrow();
      expect(() => stmt[Symbol.dispose]()).not.toThrow();
    });

    it("does not throw on a statement finalized by close()", () => {
      const stmt = db.prepare("SELECT * FROM test");
      stmt.close();

      expect(() => stmt[Symbol.dispose]()).not.toThrow();
    });

    it("finalizes deterministically at scope exit", () => {
      let escaped: ReturnType<typeof db.prepare>;

      {
        using stmt = db.prepare("SELECT * FROM test WHERE id = 1");
        expect(stmt.get()).toEqual({ id: 1, name: "one" });
        escaped = stmt;
      }

      expect(() => escaped.get()).toThrow(/statement has been finalized/);
    });
  });

  describe("interaction with user-defined functions", () => {
    it("refuses to finalize a statement that is mid-execution", () => {
      // Finalizing a statement whose sqlite3_step() is still on the stack is
      // undefined behavior, so close() must reject it rather than crash.
      let closeError: unknown;
      // The UDF must be registered before prepare(), but it needs the
      // statement that prepare() returns -- hence the holder.
      const held: { stmt?: ReturnType<typeof db.prepare> } = {};

      db.function("probe", (id: number) => {
        try {
          held.stmt!.close();
        } catch (e) {
          closeError = e;
        }
        return id;
      });

      const stmt = db.prepare("SELECT probe(id) AS v FROM test");
      held.stmt = stmt;
      const rows = stmt.all();

      expect(rows).toHaveLength(2);
      expect(closeError).toEqual(
        expect.objectContaining({ code: "ERR_INVALID_STATE" }),
      );

      // Once the query unwinds, closing works.
      expect(() => stmt.close()).not.toThrow();
    });

    it("dispose is a no-op mid-execution rather than throwing", () => {
      const held: { stmt?: ReturnType<typeof db.prepare> } = {};

      db.function("probe2", (id: number) => {
        held.stmt![Symbol.dispose]();
        return id;
      });

      const stmt = db.prepare("SELECT probe2(id) AS v FROM test");
      held.stmt = stmt;
      expect(() => stmt.all()).not.toThrow();
      expect(() => stmt.close()).not.toThrow();
    });
  });
});
