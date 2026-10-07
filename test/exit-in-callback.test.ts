import { describe, expect, it } from "@jest/globals";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { getTestTimeout, projectRoot } from "./test-utils";

// process.exit() in a worker terminates JavaScript while SQLite is running a
// JavaScript callback. The call then fails with a termination exception that
// is not an object, and node-addon-api aborted the process converting it into
// a Napi::Error ("FATAL ERROR: Error::Error napi_define_properties"). Once
// JavaScript cannot run, any error thrown on the way out fails too, ending in
// "terminating due to uncaught exception of type Napi::Error". node:sqlite
// exits the worker with the requested code. User-defined functions and virtual
// tables are covered in aggregate-error-handling.test.ts and
// create-module.test.ts.

describe("process.exit() in a worker's callback", () => {
  // Runs `workerCode` in a worker of a child process, so an abort fails the
  // assertion instead of the Jest worker. The child prints the worker's exit
  // code.
  async function runInWorker(workerCode: string) {
    const childScript = `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(${JSON.stringify(workerCode)}, { eval: true });
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
    const { DatabaseSync } = require(${JSON.stringify(
      path.join(projectRoot(), "dist", "index.cjs"),
    )});
    const db = new DatabaseSync(":memory:");
  `;
  // A changeset that inserts a row whose key the target already has.
  const conflictingChangeset = `
    db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY)");
    const session = db.createSession();
    db.exec("INSERT INTO t VALUES (1)");
    const changeset = session.changeset();
    const target = new DatabaseSync(":memory:");
    target.exec("CREATE TABLE t (k INTEGER PRIMARY KEY); INSERT INTO t VALUES (1)");
  `;
  const subscribe = `
    require("node:diagnostics_channel").subscribe("sqlite.db.query", () =>
      process.exit(7),
    );
  `;

  const callbacks: Record<string, string> = {
    "an authorizer in prepare()": `
      db.setAuthorizer(() => process.exit(7));
      db.prepare("SELECT 1");`,
    "an authorizer in exec()": `
      db.setAuthorizer(() => process.exit(7));
      db.exec("SELECT 1");`,
    // A schema change makes sqlite3_step() prepare the statement again.
    "an authorizer re-preparing a statement in get()": `
      db.exec("CREATE TABLE t (v)");
      const stmt = db.prepare("SELECT v FROM t");
      db.exec("CREATE TABLE u (v)");
      db.setAuthorizer(() => process.exit(7));
      stmt.get();`,
    "a changeset filter": `${conflictingChangeset}
      target.applyChangeset(changeset, { filter: () => process.exit(7) });`,
    "a changeset onConflict": `${conflictingChangeset}
      target.applyChangeset(changeset, { onConflict: () => process.exit(7) });`,
    // The statements below succeed, so each method goes on to build its result.
    "a sqlite.db.query subscriber in run()": `${subscribe}
      db.prepare("SELECT 1").run();`,
    "a sqlite.db.query subscriber in iterate()": `${subscribe}
      for (const row of db.prepare("SELECT 1").iterate());`,
    "a sqlite.db.query subscriber when iterate() stops early": `${subscribe}
      for (const row of db.prepare("SELECT 1 UNION ALL SELECT 2").iterate()) break;`,
    // Checking whether an aggregate's step returned a Promise reads `then`.
    "an aggregate step result's then getter": `
      db.aggregate("agg", {
        start: 0,
        step: (_acc, _value) => ({ get then() { process.exit(7); } }),
      });
      db.prepare("SELECT agg(1)").get();`,
    // An object accumulator is stored as JSON between steps.
    "an aggregate accumulator's toJSON()": `
      db.aggregate("agg", {
        start: 0,
        step: (_acc, _value) => ({ toJSON() { process.exit(7); } }),
      });
      db.prepare("SELECT agg(1)").get();`,
  };

  for (const [name, code] of Object.entries(callbacks)) {
    it(
      `exits from ${name}`,
      async () => {
        expect(await runInWorker(setup + code)).toEqual({
          code: 0,
          signal: null,
          stdout: "7",
          stderr: "",
        });
      },
      getTestTimeout(30000),
    );
  }
});
