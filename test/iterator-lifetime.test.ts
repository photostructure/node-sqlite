import { jest } from "@jest/globals";
import { DatabaseSync, enhance } from "../src";
import { getTestTimeout } from "./test-utils";

/**
 * Ownership between iterate()'s iterator, its statement, and their database.
 *
 * As in node:sqlite, an iterator keeps its statement alive and a statement
 * keeps its database alive, so a caller may drop every reference except the
 * iterator. Each link is a symbol-keyed property on the JS object, not a
 * Napi::Reference: releasing a reference during GC finalization corrupts V8's
 * JIT pages on Alpine/musl (commits 4da0638, 0691ae5).
 *
 * In 2.6.0 the iterator held only a raw StatementSync pointer. Once GC
 * collected a statement the caller had dropped, next() read the freed object
 * and threw "Database connection is closed" while db.isOpen was still true.
 * Through 3.1.0 a statement held only a raw DatabaseSync pointer, so collecting
 * a dropped database finalized its statements mid-iteration.
 */

const RowCount = 1000;
const SQL = `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${RowCount}) SELECT x FROM n`;
const xs = Array.from({ length: RowCount }, (_, i) => i + 1);
const rows = xs.map((x) => ({ x }));

type Db = InstanceType<typeof DatabaseSync>;
type Stmt = ReturnType<Db["prepare"]>;
type Iter = ReturnType<Stmt["iterate"]>;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Records which registered objects V8 has collected. */
class Collected {
  readonly names = new Set<string>();
  readonly #registry = new FinalizationRegistry<string>((name) =>
    this.names.add(name),
  );
  #controls = 0;

  track<T extends object>(name: string, value: T): T {
    this.#registry.register(value, name);
    return value;
  }

  /** Runs full collections until every name is collected or rounds run out. */
  async until(names: string[], rounds = 20): Promise<void> {
    for (let i = 0; i < rounds && !names.every((n) => this.names.has(n)); i++) {
      global.gc!();
      await tick();
    }
    // Node-API runs this addon's finalizers from setImmediate after the
    // collection that queued them.
    await tick();
  }

  /**
   * Collects an object registered now, which shows that a full collection and
   * its finalizers have run.
   */
  async fullGc(): Promise<void> {
    const name = `control ${this.#controls++}`;
    (() => this.track(name, {}))();
    await this.until([name]);
    expect(this.names).toContain(name);
  }
}

/** Reads every row, yielding to the event loop and forcing GC as it goes. */
async function drainAcrossGc<T>(iterator: Iterable<T>): Promise<T[]> {
  const out: T[] = [];
  for (const row of iterator) {
    out.push(row);
    await Promise.resolve();
    if (out.length % 250 === 0) {
      global.gc!();
      await tick();
    }
  }
  return out;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

const finalizedError = {
  code: "ERR_INVALID_STATE",
  message: expect.stringMatching(/statement has been finalized/),
};

describe("iterate() ownership across awaits and GC", () => {
  jest.setTimeout(getTestTimeout());

  let collected: Collected;

  beforeAll(() => {
    expect(typeof global.gc).toBe("function");
  });

  beforeEach(() => {
    collected = new Collected();
  });

  describe("native iterator", () => {
    test("outlives its dropped statement", async () => {
      const db = new DatabaseSync(":memory:");
      const iterator = (() =>
        collected.track("stmt", db.prepare(SQL)).iterate())();

      await collected.fullGc();
      expect(collected.names).not.toContain("stmt");
      expect(await drainAcrossGc(iterator)).toEqual(rows);
      expect(db.isOpen).toBe(true);
      db.close();
    });

    test("outlives its dropped statement and database", async () => {
      const refs: { iterator?: Iter } = {};
      refs.iterator = (() => {
        const db = collected.track("db", new DatabaseSync(":memory:"));
        const stmt = collected.track("stmt", db.prepare(SQL));
        return collected.track("iterator", stmt.iterate());
      })();

      await collected.fullGc();
      expect(collected.names).not.toContain("stmt");
      expect(collected.names).not.toContain("db");
      expect(await drainAcrossGc(refs.iterator)).toEqual(rows);

      delete refs.iterator;
      await collected.until(["iterator", "stmt", "db"]);
      expect([...collected.names]).toEqual(
        expect.arrayContaining(["iterator", "stmt", "db"]),
      );
    });

    test("a statement outlives its dropped database", async () => {
      const refs: { stmt?: Stmt } = {};
      refs.stmt = (() => {
        const db = collected.track("db", new DatabaseSync(":memory:"));
        return collected.track("stmt", db.prepare(SQL));
      })();

      await collected.fullGc();
      expect(collected.names).not.toContain("db");
      expect(refs.stmt.all()).toEqual(rows);
      expect(await drainAcrossGc(refs.stmt.iterate())).toEqual(rows);

      delete refs.stmt;
      await collected.until(["stmt", "db"]);
      expect([...collected.names]).toEqual(
        expect.arrayContaining(["stmt", "db"]),
      );
    });
  });

  describe("enhanced iterator", () => {
    // flat and raw return the native iterator; pluck and expand wrap it in a
    // generator that transforms each row.
    const modes = {
      flat: { apply: (_: any) => {}, expected: rows },
      raw: { apply: (s: any) => s.raw(), expected: xs.map((x) => [x]) },
      pluck: { apply: (s: any) => s.pluck(), expected: xs },
      expand: {
        apply: (s: any) => s.expand(),
        expected: xs.map((x) => ({ $: { x } })),
      },
    };

    test.each(Object.keys(modes) as (keyof typeof modes)[])(
      "%s mode outlives its dropped statement and database",
      async (mode) => {
        const { apply, expected } = modes[mode];
        const refs: { iterator?: Iterable<unknown> } = {};
        refs.iterator = (() => {
          const db = collected.track(
            "db",
            enhance(new DatabaseSync(":memory:")),
          );
          const stmt = collected.track("stmt", db.prepare(SQL));
          apply(stmt);
          return collected.track("iterator", stmt.iterate());
        })();

        await collected.fullGc();
        expect(collected.names).not.toContain("stmt");
        expect(collected.names).not.toContain("db");
        expect(await drainAcrossGc(refs.iterator)).toEqual(expected);

        delete refs.iterator;
        await collected.until(["iterator", "stmt", "db"]);
        expect([...collected.names]).toEqual(
          expect.arrayContaining(["iterator", "stmt", "db"]),
        );
      },
    );

    test("breaking out of a generator-wrapped iterator ends it", async () => {
      const db = enhance(new DatabaseSync(":memory:"));
      const stmt = db.prepare(SQL).pluck();
      const iterator = stmt.iterate() as unknown as Generator<number>;

      const seen: number[] = [];
      for (const x of iterator) {
        seen.push(x);
        if (seen.length === 10) break;
        await Promise.resolve();
      }
      await collected.fullGc();

      expect(seen).toEqual(xs.slice(0, 10));
      expect(iterator.next()).toEqual({ done: true, value: undefined });
      expect(await drainAcrossGc(stmt.iterate())).toEqual(xs);
      db.close();
    });
  });

  describe("explicit finalization", () => {
    test.each([
      ["stmt.close()", (_db: Db, stmt: Stmt) => stmt.close()],
      [
        "stmt[Symbol.dispose]()",
        (_db: Db, stmt: Stmt) => stmt[Symbol.dispose](),
      ],
      ["db.close()", (db: Db) => db.close()],
    ])(
      "%s mid-iteration makes next() and return() throw",
      async (_name, finalize) => {
        const refs: { db?: Db; stmt?: Stmt; iterator?: Iter } = {};
        refs.db = collected.track("db", new DatabaseSync(":memory:"));
        refs.stmt = collected.track("stmt", refs.db.prepare(SQL));
        refs.iterator = collected.track("iterator", refs.stmt.iterate());
        expect(refs.iterator.next()).toEqual({ done: false, value: { x: 1 } });

        finalize(refs.db, refs.stmt);
        delete refs.stmt;
        await collected.fullGc();

        // Not "Database connection is closed": the statement was finalized,
        // whether or not its database is still open.
        expect(thrown(() => refs.iterator!.next())).toMatchObject(
          finalizedError,
        );
        expect(thrown(() => refs.iterator!.return!())).toMatchObject(
          finalizedError,
        );

        if (refs.db.isOpen) refs.db.close();
        delete refs.db;
        delete refs.iterator;
        await collected.until(["iterator", "stmt", "db"]);
        expect([...collected.names]).toEqual(
          expect.arrayContaining(["iterator", "stmt", "db"]),
        );
      },
    );
  });

  describe("early termination", () => {
    test("break resets the statement for reuse", async () => {
      const db = new DatabaseSync(":memory:");
      const stmt = db.prepare(SQL);
      const iterator = stmt.iterate();

      const seen: unknown[] = [];
      for (const row of iterator) {
        seen.push(row);
        if (seen.length === 10) break;
        await Promise.resolve();
      }
      await collected.fullGc();

      expect(seen).toEqual(rows.slice(0, 10));
      expect(iterator.next()).toEqual({ done: true, value: null });
      expect(stmt.get()).toEqual({ x: 1 });
      expect(await drainAcrossGc(stmt.iterate())).toEqual(rows);
      db.close();
    });

    test("a throw in the loop body ends the iterator", async () => {
      const db = new DatabaseSync(":memory:");
      const stmt = db.prepare(SQL);
      const iterator = stmt.iterate();

      await expect(async () => {
        for (const row of iterator) {
          await Promise.resolve();
          if ((row as { x: number }).x === 10) throw new Error("stop");
        }
      }).rejects.toThrow("stop");
      await collected.fullGc();

      expect(iterator.next()).toEqual({ done: true, value: null });
      expect(stmt.all()).toEqual(rows);
      db.close();
    });

    test("an abandoned, unfinished iterator is collected with its owners", async () => {
      const refs: { iterator?: Iter } = {};
      refs.iterator = (() => {
        const db = collected.track("db", new DatabaseSync(":memory:"));
        const stmt = collected.track("stmt", db.prepare(SQL));
        return collected.track("iterator", stmt.iterate());
      })();
      expect(refs.iterator.next()).toEqual({ done: false, value: { x: 1 } });

      await collected.fullGc();
      expect(collected.names).not.toContain("stmt");
      expect(collected.names).not.toContain("db");

      // The statement is mid-step and the database still open when they are
      // finalized, which must neither crash nor leak.
      delete refs.iterator;
      await collected.until(["iterator", "stmt", "db"]);
      expect([...collected.names]).toEqual(
        expect.arrayContaining(["iterator", "stmt", "db"]),
      );
    });
  });
});
