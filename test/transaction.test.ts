/**
 * Tests for transaction() - inspired by better-sqlite3's transaction API
 */
import {
  DatabaseSync,
  enhance,
  EnhancedDatabaseSync,
  TransactionFunction,
} from "../src";

describe("transaction() Tests", () => {
  let db: EnhancedDatabaseSync<InstanceType<typeof DatabaseSync>>;

  beforeEach(() => {
    db = enhance(new DatabaseSync(":memory:"));
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
  });

  afterEach(() => {
    db.close();
  });

  describe("basic functionality", () => {
    test("wraps function in transaction", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const insertMany = db.transaction((names: string[]) => {
        for (const name of names) {
          insert.run(name);
        }
        return names.length;
      });

      const count = insertMany(["Alice", "Bob", "Charlie"]);

      expect(count).toBe(3);
      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(3);
    });

    test("commits on success", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const insertOne = db.transaction((name: string) => {
        insert.run(name);
      });

      insertOne("Dave");

      // Verify data persisted
      const row = db
        .prepare("SELECT name FROM items WHERE name = ?")
        .get("Dave") as { name: string };
      expect(row.name).toBe("Dave");
    });

    test("rolls back on error", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const insertWithError = db.transaction(() => {
        insert.run("Eve");
        insert.run("Frank");
        throw new Error("Intentional error");
      });

      expect(() => insertWithError()).toThrow("Intentional error");

      // Verify rollback - no data should be present
      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(0);
    });

    test("returns value from wrapped function", () => {
      const insertAndReturn = db.transaction(() => {
        db.exec("INSERT INTO items (name) VALUES ('Test')");
        return { inserted: true, count: 1 };
      });

      const result = insertAndReturn();
      expect(result).toEqual({ inserted: true, count: 1 });
    });

    test("passes arguments to wrapped function", () => {
      const insertNamed = db.transaction((name: string, count: number) => {
        for (let i = 0; i < count; i++) {
          db.exec(`INSERT INTO items (name) VALUES ('${name}_${i}')`);
        }
        return count;
      });

      const result = insertNamed("Item", 5);
      expect(result).toBe(5);

      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(5);
    });

    test("preserves this binding", () => {
      const context = {
        prefix: "PREFIX_",
        insertPrefixed: db.transaction(function (
          this: { prefix: string },
          name: string,
        ) {
          db.exec(`INSERT INTO items (name) VALUES ('${this.prefix}${name}')`);
        }),
      };

      context.insertPrefixed("Test");

      const row = db.prepare("SELECT name FROM items").get() as {
        name: string;
      };
      expect(row.name).toBe("PREFIX_Test");
    });
  });

  describe("transaction modes", () => {
    test("default mode uses DEFERRED", () => {
      const txn = db.transaction(() => {
        // Transaction started
        expect(db.isTransaction).toBe(true);
      });

      expect(db.isTransaction).toBe(false);
      txn();
      expect(db.isTransaction).toBe(false);
    });

    test("deferred variant is available", () => {
      const txn = db.transaction(() => {
        db.exec("INSERT INTO items (name) VALUES ('deferred')");
      });

      txn.deferred();

      const row = db.prepare("SELECT name FROM items").get() as {
        name: string;
      };
      expect(row.name).toBe("deferred");
    });

    test("immediate variant is available", () => {
      const txn = db.transaction(() => {
        db.exec("INSERT INTO items (name) VALUES ('immediate')");
      });

      txn.immediate();

      const row = db.prepare("SELECT name FROM items").get() as {
        name: string;
      };
      expect(row.name).toBe("immediate");
    });

    test("exclusive variant is available", () => {
      const txn = db.transaction(() => {
        db.exec("INSERT INTO items (name) VALUES ('exclusive')");
      });

      txn.exclusive();

      const row = db.prepare("SELECT name FROM items").get() as {
        name: string;
      };
      expect(row.name).toBe("exclusive");
    });

    test("all variants have circular references", () => {
      const txn = db.transaction(() => {});

      // Each variant should have access to all other variants
      expect(txn.deferred.immediate).toBe(txn.immediate);
      expect(txn.deferred.exclusive).toBe(txn.exclusive);
      expect(txn.immediate.deferred).toBe(txn.deferred);
      expect(txn.immediate.exclusive).toBe(txn.exclusive);
      expect(txn.exclusive.deferred).toBe(txn.deferred);
      expect(txn.exclusive.immediate).toBe(txn.immediate);
    });

    test("database property is accessible", () => {
      const txn = db.transaction(() => {});

      expect(txn.database).toBe(db);
      expect(txn.deferred.database).toBe(db);
      expect(txn.immediate.database).toBe(db);
      expect(txn.exclusive.database).toBe(db);
    });
  });

  describe("nested transactions (savepoints)", () => {
    test("nested transaction uses savepoint", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const outer = db.transaction(() => {
        insert.run("outer1");

        const inner = db.transaction(() => {
          insert.run("inner1");
        });
        inner();

        insert.run("outer2");
      });

      outer();

      const rows = db.prepare("SELECT name FROM items ORDER BY id").all() as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["outer1", "inner1", "outer2"]);
    });

    test("nested transaction rollback only affects inner", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const inner = db.transaction(() => {
        insert.run("inner");
        throw new Error("Inner error");
      });

      const outer = db.transaction(() => {
        insert.run("outer1");

        try {
          inner();
        } catch {
          // Ignore inner error
        }

        insert.run("outer2");
      });

      outer();

      // outer1 and outer2 should be present, inner should be rolled back
      const rows = db.prepare("SELECT name FROM items ORDER BY id").all() as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["outer1", "outer2"]);
    });

    test("nested error propagates and rolls back all", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const inner = db.transaction(() => {
        insert.run("inner");
        throw new Error("Inner error");
      });

      const outer = db.transaction(() => {
        insert.run("outer1");
        inner(); // Don't catch - let it propagate
        insert.run("outer2");
      });

      expect(() => outer()).toThrow("Inner error");

      // Everything should be rolled back
      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(0);
    });

    test("deeply nested transactions work correctly", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const level3 = db.transaction(() => {
        insert.run("level3");
      });

      const level2 = db.transaction(() => {
        insert.run("level2");
        level3();
      });

      const level1 = db.transaction(() => {
        insert.run("level1");
        level2();
      });

      level1();

      const rows = db.prepare("SELECT name FROM items ORDER BY id").all() as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["level1", "level2", "level3"]);
    });

    test("mixed mode nested transactions", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const inner = db.transaction(() => {
        insert.run("inner");
      });

      const outer = db.transaction(() => {
        insert.run("outer");
        inner.immediate(); // Use different mode (still becomes savepoint)
      });

      outer.exclusive();

      const rows = db.prepare("SELECT name FROM items ORDER BY id").all() as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual(["outer", "inner"]);
    });
  });

  describe("promise rejection", () => {
    test("rejects async functions", () => {
      const asyncFn = db.transaction(async () => {
        return Promise.resolve("value");
      });

      expect(() => asyncFn()).toThrow(TypeError);
      expect(() => asyncFn()).toThrow(/Promise/);
    });

    test("rejects functions returning promises", () => {
      const promiseFn = db.transaction(() => {
        return Promise.resolve("value");
      });

      expect(() => promiseFn()).toThrow(TypeError);
      expect(() => promiseFn()).toThrow(/Promise/);
    });

    test("rejects thenable objects", () => {
      const thenableFn = db.transaction(() => {
        return { then: () => {} };
      });

      expect(() => thenableFn()).toThrow(TypeError);
    });

    test("rolls back when promise detected", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const badTxn = db.transaction(() => {
        insert.run("before_promise");
        return Promise.resolve();
      });

      expect(() => badTxn()).toThrow(TypeError);

      // Should have rolled back
      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(0);
    });
  });

  describe("error handling edge cases", () => {
    test("handles constraint violation", () => {
      db.exec("CREATE UNIQUE INDEX idx_name ON items(name)");
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      const insertDuplicates = db.transaction(() => {
        insert.run("unique");
        insert.run("unique"); // Constraint violation
      });

      expect(() => insertDuplicates()).toThrow(/UNIQUE constraint failed/);

      // Should have rolled back
      const rows = db.prepare("SELECT * FROM items").all();
      expect(rows).toHaveLength(0);
    });

    test("handles syntax error in transaction", () => {
      const badSql = db.transaction(() => {
        db.exec("INVALID SQL SYNTAX");
      });

      expect(() => badSql()).toThrow();

      // Should not leave transaction open
      expect(db.isTransaction).toBe(false);
    });

    test("transaction state is correct after error", () => {
      const failingTxn = db.transaction(() => {
        expect(db.isTransaction).toBe(true);
        throw new Error("fail");
      });

      expect(() => failingTxn()).toThrow("fail");
      expect(db.isTransaction).toBe(false);
    });
  });

  describe("type safety", () => {
    test("rejects non-function argument", () => {
      // @ts-expect-error Testing runtime type check
      expect(() => db.transaction("not a function")).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.transaction(null)).toThrow(TypeError);
      // @ts-expect-error Testing runtime type check
      expect(() => db.transaction(undefined)).toThrow(TypeError);
    });

    test("infers return type correctly", () => {
      const txn: TransactionFunction<() => number> = db.transaction(() => 42);
      const result: number = txn();
      expect(result).toBe(42);
    });

    test("infers parameter types correctly", () => {
      const txn: TransactionFunction<(a: string, b: number) => string> =
        db.transaction((a: string, b: number) => `${a}-${b}`);
      const result: string = txn("test", 123);
      expect(result).toBe("test-123");
    });
  });

  describe("isTransaction property", () => {
    test("isTransaction is false outside transaction", () => {
      expect(db.isTransaction).toBe(false);
    });

    test("isTransaction is true inside transaction", () => {
      const txn = db.transaction(() => {
        expect(db.isTransaction).toBe(true);
      });

      txn();
    });

    test("isTransaction is true in nested transaction", () => {
      const inner = db.transaction(() => {
        expect(db.isTransaction).toBe(true);
      });

      const outer = db.transaction(() => {
        expect(db.isTransaction).toBe(true);
        inner();
        expect(db.isTransaction).toBe(true);
      });

      outer();
    });

    test("isTransaction is false after commit", () => {
      const txn = db.transaction(() => {});
      txn();
      expect(db.isTransaction).toBe(false);
    });

    test("isTransaction is false after rollback", () => {
      const txn = db.transaction(() => {
        throw new Error("rollback");
      });

      expect(() => txn()).toThrow();
      expect(db.isTransaction).toBe(false);
    });
  });

  describe("comparison with manual transactions", () => {
    test("produces same results as manual BEGIN/COMMIT", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      // Manual approach
      db.exec("BEGIN");
      insert.run("manual1");
      insert.run("manual2");
      db.exec("COMMIT");

      // Transaction approach
      const txnInsert = db.transaction(() => {
        insert.run("auto1");
        insert.run("auto2");
      });
      txnInsert();

      const rows = db.prepare("SELECT name FROM items ORDER BY id").all() as {
        name: string;
      }[];
      expect(rows.map((r) => r.name)).toEqual([
        "manual1",
        "manual2",
        "auto1",
        "auto2",
      ]);
    });

    test("handles rollback same as manual ROLLBACK", () => {
      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");

      // Manual rollback
      db.exec("BEGIN");
      insert.run("manual");
      db.exec("ROLLBACK");

      const manualCount = (
        db.prepare("SELECT COUNT(*) as c FROM items").get() as { c: number }
      ).c;
      expect(manualCount).toBe(0);

      // Transaction rollback
      const txnInsert = db.transaction(() => {
        insert.run("auto");
        throw new Error("rollback");
      });

      expect(() => txnInsert()).toThrow();

      const autoCount = (
        db.prepare("SELECT COUNT(*) as c FROM items").get() as { c: number }
      ).c;
      expect(autoCount).toBe(0);
    });
  });
});
