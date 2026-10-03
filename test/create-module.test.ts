import { describe, expect, it } from "@jest/globals";
import { spawn } from "node:child_process";
import { DatabaseSync } from "../src";
import { getTestTimeout, projectRoot } from "./test-utils";

// Behavior of createModule() that the upstream tests in
// test/node-compat/test-sqlite-virtual-table.test.js do not cover: our
// finalizers run later than node:sqlite's, errors keep their identity across
// SQLite's C frames, teardown paths that finalize statements, and workers.

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

describe("createModule()", () => {
  describe("thrown values", () => {
    class RowsError extends Error {
      code = "E_ROWS";
    }

    const sources = {
      "rows()": (thrown: unknown) => () => {
        throw thrown;
      },
      "next()": (thrown: unknown) => () => ({
        [Symbol.iterator]() {
          return this;
        },
        next() {
          throw thrown;
        },
      }),
      "a row getter": (thrown: unknown) => () => [
        {
          length: 1,
          get 0() {
            throw thrown;
          },
        },
      ],
    };

    for (const [name, makeRows] of Object.entries(sources)) {
      it(`reach the caller unchanged from ${name}`, () => {
        for (const thrown of [new RowsError("boom"), 42]) {
          const db = new DatabaseSync(":memory:");
          db.createModule("m", {
            columns: [{ name: "v", type: "INTEGER" }],
            rows: makeRows(thrown),
          });
          expect(caught(() => db.prepare("SELECT v FROM m").all())).toBe(
            thrown,
          );
          expect(caught(() => db.exec("SELECT v FROM m"))).toBe(thrown);
          db.close();
        }
      });
    }
  });

  describe("a throwing return() when a statement is reused", () => {
    // Running a statement again resets it, which closes the cursor an
    // unfinished iterate() left open and runs its iterator's return(). With
    // named parameters, all(), get(), and run() replaced that throw with a
    // plain Error carrying only its message.
    for (const method of ["all", "get", "run", "iterate"] as const) {
      for (const [kind, sql, param] of [
        ["named", "SELECT v FROM m WHERE v >= $min", { $min: 0 }],
        ["positional", "SELECT v FROM m WHERE v >= ?", 0],
      ] as const) {
        it(`reaches ${method}() unchanged with ${kind} parameters`, () => {
          const db = new DatabaseSync(":memory:");
          const thrown = Object.assign(new TypeError("cleanup"), {
            code: "E_CLEANUP",
          });
          db.createModule("m", {
            columns: [{ name: "v", type: "INTEGER" }],
            *rows() {
              try {
                yield [1];
                yield [2];
              } finally {
                // eslint-disable-next-line no-unsafe-finally
                throw thrown;
              }
            },
          });
          const stmt = db.prepare(sql);
          stmt.iterate(param).next();
          expect(caught(() => stmt[method](param))).toBe(thrown);
          db.close();
        });
      }
    }
  });

  describe("value conversion", () => {
    it("throws ERR_OUT_OF_RANGE for an unsafe integer parameter", () => {
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [
          { name: "v", type: "INTEGER" },
          { name: "p", type: "INTEGER", hidden: true },
        ],
        rows: (p) => [[p]],
      });
      expect(() =>
        db.prepare("SELECT v FROM m(9007199254740993)").all(),
      ).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
      db.close();
    });

    it("throws ERR_OUT_OF_RANGE for a BigInt outside the int64 range", () => {
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows: () => [[2n ** 64n]],
      });
      expect(() => db.prepare("SELECT v FROM m").all()).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
      db.close();
    });

    it("stores booleans as 0 and 1, as for user-defined functions", () => {
      // node:sqlite rejects a boolean here; this package converts booleans in
      // both user-defined function results and virtual table rows.
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows: () => [[true], [false]],
      });
      expect(db.prepare("SELECT v FROM m").all()).toEqual([{ v: 1 }, { v: 0 }]);
      db.close();
    });
  });

  describe("iterator cleanup", () => {
    const trackedModule = (db: InstanceType<typeof DatabaseSync>) => {
      const state = { cleanedUp: false };
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        *rows() {
          try {
            for (let i = 0; i < 1000; i++) {
              yield [i];
            }
          } finally {
            state.cleanedUp = true;
          }
        },
      });
      return state;
    };

    it("skips return() when a collected statement finalizes its cursor", async () => {
      // Node-API runs this addon's finalizers from setImmediate after the
      // collection, where node:sqlite runs its destructors during it. The
      // upstream test asserts right after gc(), before ours have run, so it
      // cannot see return() being called from ~StatementSync.
      expect(typeof global.gc).toBe("function");
      const db = new DatabaseSync(":memory:");
      const state = trackedModule(db);

      let collected = false;
      const registry = new FinalizationRegistry(() => {
        collected = true;
      });
      (() => {
        const stmt = db.prepare("SELECT v FROM m");
        registry.register(stmt, undefined);
        stmt.iterate().next();
      })();

      for (let i = 0; i < 20 && !collected; i++) {
        global.gc!();
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(collected).toBe(true);
      // Let Node-API's queued finalizers, including ~StatementSync, run.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      // A statement still tracked here would have its cursor closed by
      // close(), which does run return().
      db.close();
      expect(state.cleanedUp).toBe(false);
    });

    it("close() runs return() of a suspended iterator", () => {
      const db = new DatabaseSync(":memory:");
      const state = trackedModule(db);
      const iterator = db.prepare("SELECT v FROM m").iterate();
      iterator.next();
      db.close();
      expect(state.cleanedUp).toBe(true);
    });

    it("deserialize() runs return() of a suspended iterator", () => {
      const image = new DatabaseSync(":memory:").serialize();
      const db = new DatabaseSync(":memory:");
      const state = trackedModule(db);
      const iterator = db.prepare("SELECT v FROM m").iterate();
      iterator.next();
      db.deserialize(image);
      expect(state.cleanedUp).toBe(true);
      // Not queried again here: in this build, querying any eponymous virtual
      // table (json_each included) both before and after deserialize()
      // crashes inside SQLite, independently of createModule().
      db.close();
    });

    it("deserialize() surfaces a throwing return()", () => {
      // As in node:sqlite, the error from return() stays pending while
      // deserialize() continues: the database is replaced unless an authorizer
      // is set, whose call then fails and denies SQLite's internal ATTACH.
      const source = new DatabaseSync(":memory:");
      source.exec("CREATE TABLE data(x); INSERT INTO data VALUES (42)");
      const image = source.serialize();
      source.close();

      for (const withAuthorizer of [false, true]) {
        const db = new DatabaseSync(":memory:");
        if (withAuthorizer) db.setAuthorizer(() => 0);
        const thrown = new TypeError("cleanup");
        db.createModule("m", {
          columns: [{ name: "v", type: "INTEGER" }],
          *rows() {
            try {
              yield [1];
              yield [2];
            } finally {
              // eslint-disable-next-line no-unsafe-finally
              throw thrown;
            }
          },
        });
        db.prepare("SELECT v FROM m").iterate().next();
        expect(caught(() => db.deserialize(image))).toBe(thrown);
        if (withAuthorizer) {
          db.setAuthorizer(null);
          expect(() => db.prepare("SELECT x FROM data")).toThrow(
            /no such table: data/,
          );
        } else {
          expect(db.prepare("SELECT x FROM data").all()).toEqual([{ x: 42 }]);
        }
        db.close();
      }
    });

    it("close() surfaces a throwing return() after closing", () => {
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows() {
          let i = 0;
          return {
            [Symbol.iterator]() {
              return this;
            },
            next: () => ({ value: [i++], done: false }),
            return() {
              throw new Error("cleanup boom");
            },
          };
        },
      });
      db.prepare("SELECT v FROM m").iterate().next();
      expect(() => db.close()).toThrow("cleanup boom");
      expect(db.isOpen).toBe(false);
    });

    it("[Symbol.dispose]() ignores a throwing return()", () => {
      // node:sqlite runs dispose's close() under a TryCatch and drops the
      // error, as for any other disposal error.
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        *rows() {
          try {
            yield [1];
            yield [2];
          } finally {
            // eslint-disable-next-line no-unsafe-finally
            throw new Error("cleanup boom");
          }
        },
      });
      db.prepare("SELECT v FROM m").iterate().next();
      expect(() => db[Symbol.dispose]()).not.toThrow();
      expect(db.isOpen).toBe(false);
    });

    it("close() finalizes a statement that return() prepares", () => {
      // Finalizing the suspended statement runs return(), which can prepare
      // another statement after close() has collected the ones to finalize.
      // Left alone, that statement kept the connection from closing and held
      // a pointer to the database that outlived it.
      const db = new DatabaseSync(":memory:");
      let prepared: ReturnType<typeof db.prepare> | undefined;
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows() {
          let i = 0;
          return {
            [Symbol.iterator]() {
              return this;
            },
            next: () => ({ value: [i++], done: false }),
            return() {
              prepared = db.prepare("SELECT 1 AS x");
              return { done: true, value: undefined };
            },
          };
        },
      });
      db.prepare("SELECT v FROM m").iterate().next();
      db.close();
      expect(prepared).toBeDefined();
      expect(() => prepared!.get()).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_STATE",
          message: "statement has been finalized",
        }),
      );
    });

    it("exec() reports a SQLite error over a throwing return()", () => {
      // The upstream test "a SQLite error outranks a throwing cleanup" covers
      // run(); exec() reported "cleanup boom" without a code.
      const db = new DatabaseSync(":memory:");
      db.createModule("both_fail", {
        columns: [{ name: "value", type: "INTEGER" }],
        rows() {
          let i = 0;
          return {
            [Symbol.iterator]() {
              return this;
            },
            next: () => ({ value: [i++], done: i > 50 }),
            return() {
              throw new Error("cleanup boom");
            },
          };
        },
      });
      db.exec(
        "CREATE TABLE t(v INTEGER PRIMARY KEY); INSERT INTO t VALUES (5)",
      );
      expect(() =>
        db.exec("INSERT INTO t SELECT value FROM both_fail"),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_SQLITE_ERROR",
          message: expect.stringMatching(/UNIQUE constraint failed: t\.v/),
        }),
      );
      db.close();
    });

    it("finishes a query whose rows() replaces its own module", () => {
      // node:sqlite has no guard against this either. SQLite keeps the module
      // the running query uses until the query ends; this test mainly gives
      // the AddressSanitizer and Valgrind runs the path.
      const db = new DatabaseSync(":memory:");
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        *rows() {
          db.createModule("m", {
            columns: [{ name: "w", type: "TEXT" }],
            rows: () => [["x"]],
          });
          yield [1n];
          yield [2n];
        },
      });
      expect(db.prepare("SELECT * FROM m").all()).toEqual([{ v: 1 }, { v: 2 }]);
      expect(db.prepare("SELECT * FROM m").all()).toEqual([{ w: "x" }]);
      db.close();
    });
  });

  describe("return() re-entering its own statement", () => {
    // SQLite closes a statement's virtual table cursors inside sqlite3_reset()
    // and sqlite3_finalize(), so return() runs while that statement is being
    // reset or finalized. Reaching the same statement from there reset or
    // finalized it a second time underneath SQLite: each case below crashed
    // (SIGSEGV) or never returned.
    const reentrantModule = (
      db: InstanceType<typeof DatabaseSync>,
      action: () => unknown,
    ) => {
      const state: { error?: unknown } = {};
      db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows() {
          let i = 0;
          return {
            [Symbol.iterator]() {
              return this;
            },
            next: () => ({ value: [i++], done: false }),
            return() {
              try {
                action();
              } catch (error) {
                state.error = error;
              }
              return { done: true, value: undefined };
            },
          };
        },
      });
      return state;
    };

    // node:sqlite clears its statement pointer before finalizing
    // (unique_ptr::reset()), so a statement reached while it is being
    // finalized reports this.
    const finalized = expect.objectContaining({
      code: "ERR_INVALID_STATE",
      message: "statement has been finalized",
    });
    const executing = expect.objectContaining({
      code: "ERR_INVALID_STATE",
      message: "statement is already being executed",
    });

    it("from the statement's own close()", () => {
      const db = new DatabaseSync(":memory:");
      const ref: { stmt?: ReturnType<typeof db.prepare> } = {};
      const state = reentrantModule(db, () => ref.stmt!.close());
      const stmt = (ref.stmt = db.prepare("SELECT v FROM m"));
      stmt.iterate().next();
      stmt.close();
      expect(state.error).toEqual(finalized);
      db.close();
    });

    for (const [name, action] of [
      ["close()", (stmt: { close(): void }) => stmt.close()],
      ["all()", (stmt: { all(): unknown }) => stmt.all()],
    ] as const) {
      it(`from ${name} during the database's close()`, () => {
        const db = new DatabaseSync(":memory:");
        const ref: { stmt?: ReturnType<typeof db.prepare> } = {};
        const state = reentrantModule(db, () => action(ref.stmt!));
        const stmt = (ref.stmt = db.prepare("SELECT v FROM m"));
        stmt.iterate().next();
        db.close();
        expect(state.error).toEqual(finalized);
      });

      it(`from ${name} during the iterator's return()`, () => {
        const db = new DatabaseSync(":memory:");
        const ref: { stmt?: ReturnType<typeof db.prepare> } = {};
        const state = reentrantModule(db, () => action(ref.stmt!));
        const stmt = (ref.stmt = db.prepare("SELECT v FROM m"));
        const iterator = stmt.iterate();
        iterator.next();
        iterator.return!();
        expect(state.error).toEqual(executing);
        db.close();
      });
    }
  });

  describe("worker threads", () => {
    // Runs `workerCode` in a worker of a child process, so an abort fails the
    // assertion instead of the Jest worker. The child prints the worker's exit
    // code; a worker that posts a message is terminated, which exits with 1.
    async function runInWorker(workerCode: string) {
      const childScript = `
        const { Worker } = require("node:worker_threads");
        const worker = new Worker(${JSON.stringify(workerCode)}, {
          eval: true,
          workerData: ${JSON.stringify({ root: projectRoot() })},
        });
        worker.once("message", () => worker.terminate());
        worker.once("exit", (code) => process.stdout.write(String(code)));
      `;
      const child = spawn(process.execPath, ["-e", childScript], {
        cwd: projectRoot(),
        stdio: ["ignore", "pipe", "pipe"],
        // Shorter than the Jest timeout, so a hang fails the assertion.
        timeout: getTestTimeout(20000),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (data) => (stdout += data));
      child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
      const exit = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      return { ...exit, stdout, stderr };
    }

    const setup = `
      const { parentPort, workerData } = require("node:worker_threads");
      const { DatabaseSync } = require("node-gyp-build")(workerData.root);
      const db = new DatabaseSync(":memory:");
    `;

    it(
      "exits with a suspended iterator",
      async () => {
        const result = await runInWorker(`${setup}
          db.createModule("m", {
            columns: [{ name: "v", type: "INTEGER" }],
            *rows() {
              for (let i = 0; ; i++) yield [i];
            },
          });
          globalThis.iterator = db.prepare("SELECT v FROM m").iterate();
          globalThis.iterator.next();
          process.exit(3);
        `);
        expect(result).toEqual({
          code: 0,
          signal: null,
          stdout: "3",
          stderr: "",
        });
      },
      getTestTimeout(30000),
    );

    it(
      "is terminated with a suspended iterator",
      async () => {
        const result = await runInWorker(`${setup}
          db.createModule("m", {
            columns: [{ name: "v", type: "INTEGER" }],
            *rows() {
              for (let i = 0; ; i++) yield [i];
            },
          });
          globalThis.iterator = db.prepare("SELECT v FROM m").iterate();
          globalThis.iterator.next();
          parentPort.postMessage("suspended");
          setInterval(() => {}, 1000);
        `);
        expect(result).toEqual({
          code: 0,
          signal: null,
          stdout: "1",
          stderr: "",
        });
      },
      getTestTimeout(30000),
    );

    // process.exit() in a worker terminates JavaScript while SQLite is in a
    // callback, leaving a termination exception that is not an object.
    // Through exec(), turning it into an error aborted the process with
    // "FATAL ERROR: Error::Error napi_define_properties"; that path is shared
    // with user-defined functions, so one of those is included.
    const exitingCallbacks = {
      rows: `db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        *rows() { process.exit(4); },
      });`,
      "next()": `db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows() { return { [Symbol.iterator]() { return this; }, next() { process.exit(4); } }; },
      });`,
      "a row getter": `db.createModule("m", {
        columns: [{ name: "v", type: "INTEGER" }],
        rows() { return [{ get 0() { process.exit(4); } }]; },
      });`,
      "a user-defined function": `db.function("m_fn", () => process.exit(4));
        db.exec("CREATE VIEW m AS SELECT m_fn() AS v");`,
    };
    // The same exit from the iterator's return(), which SQLite runs while
    // resetting or finalizing the statement. These aborted the process, with
    // "FATAL ERROR: Error::Error napi_define_properties" or with "terminate
    // called after throwing an instance of 'Napi::Error'" when the statement
    // also failed with a SQLite error.
    const exitingCleanup = `db.createModule("m", {
      columns: [{ name: "v", type: "INTEGER" }],
      *rows() {
        try { for (let i = 0; i < 50; i++) yield [i]; } finally { process.exit(4); }
      },
    });
    db.exec("CREATE TABLE t(v INTEGER PRIMARY KEY); INSERT INTO t VALUES (5)");
    const named = db.prepare("SELECT v FROM m WHERE v >= $min");
    const failing = "INSERT INTO t SELECT v FROM m";`;
    const cleanupTriggers = {
      "the iterator's return()": `const it = named.iterate({ $min: 0 }); it.next(); it.return();`,
      "iterate() reusing the statement": `named.iterate({ $min: 0 }).next(); named.iterate({ $min: 0 });`,
      "next() reaching LIMIT": `const it = db.prepare("SELECT v FROM m LIMIT 1").iterate(); it.next(); it.next();`,
      "a failing run()": `db.prepare(failing).run();`,
      "a failing all()": `db.prepare(failing).all();`,
      "a failing get()": `db.prepare(failing).get();`,
      "a failing exec()": `db.exec(failing);`,
      "a failing iterate().next()": `db.prepare(failing).iterate().next();`,
      "a failing iterate().toArray()": `db.prepare(failing).iterate().toArray();`,
      "the database's [Symbol.dispose]()": `named.iterate({ $min: 0 }).next(); db[Symbol.dispose]();`,
      // sqlite3_deserialize() runs an internal ATTACH that calls the authorizer.
      "deserialize() with an authorizer": `const image = new DatabaseSync(":memory:").serialize();
        db.setAuthorizer(() => 0);
        named.iterate({ $min: 0 }).next();
        db.deserialize(image);`,
    };
    for (const [name, trigger] of Object.entries(cleanupTriggers)) {
      it(
        `exits from return() run by ${name}`,
        async () => {
          const result = await runInWorker(`${setup}
            ${exitingCleanup}
            ${trigger}
          `);
          expect(result).toEqual({
            code: 0,
            signal: null,
            stdout: "4",
            stderr: "",
          });
        },
        getTestTimeout(30000),
      );
    }

    for (const [name, register] of Object.entries(exitingCallbacks)) {
      for (const run of [
        `db.prepare("SELECT v FROM m").all();`,
        `db.exec("SELECT v FROM m");`,
      ]) {
        it(
          `exits from ${name} in ${run.startsWith("db.exec") ? "exec()" : "all()"}`,
          async () => {
            const result = await runInWorker(`${setup}
              ${register}
              ${run}
            `);
            expect(result).toEqual({
              code: 0,
              signal: null,
              stdout: "4",
              stderr: "",
            });
          },
          getTestTimeout(30000),
        );
      }
    }
  });
});
