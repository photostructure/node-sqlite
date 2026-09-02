import { jest } from "@jest/globals";
import nodeGypBuild from "node-gyp-build";
import { AsyncLocalStorage, createHook } from "node:async_hooks";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "../src";
import { DatabasePool } from "../src/experimental";
import { waitForCondition } from "./test-reliability-utils";
import {
  getDirname,
  getTestTimeout,
  projectRoot,
  useTempDir,
} from "./test-utils";

const testWithExtension =
  process.env["TEST_EXTENSION_BUILT"] === "1" ? test : test.skip;

describe("DatabasePool lifecycle", () => {
  jest.setTimeout(getTestTimeout(30_000));
  const tempDir = useTempDir("sqlite-async-pool-lifecycle-");

  test("SQLite execution does not block the event loop", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    let heartbeats = 0;
    let done = false;
    const beat = () => {
      heartbeats++;
      if (!done) setImmediate(beat);
    };
    setImmediate(beat);

    try {
      await pool.get(`
        WITH RECURSIVE n(x) AS (
          VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 1000000
        )
        SELECT max(x) AS value FROM n
      `);
      done = true;
      expect(heartbeats).toBeGreaterThan(0);
    } finally {
      done = true;
      await pool.close();
    }
  });

  test("preserves AsyncLocalStorage and exposes the named async resource", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    const storage = new AsyncLocalStorage<string>();
    const observedTypes = new Set<string>();
    const hook = createHook({
      init(_asyncId, type) {
        if (type.startsWith("photostructure.sqlite.pool")) {
          observedTypes.add(type);
        }
      },
    });
    hook.enable();

    try {
      await storage.run("request-context", async () => {
        await expect(pool.get("SELECT 1 AS value")).resolves.toEqual({
          value: 1,
        });
        expect(storage.getStore()).toBe("request-context");
        await expect(pool.get("SELECT * FROM missing_table")).rejects.toThrow();
        expect(storage.getStore()).toBe("request-context");
      });
      expect(observedTypes).toContain("photostructure.sqlite.pool.request");
    } finally {
      hook.disable();
      await pool.close();
    }
  });

  test("close enters closing synchronously, drains accepted work, and is idempotent", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    await pool.run("CREATE TABLE item(value TEXT)");

    const longRead = pool.get(`
      WITH RECURSIVE n(x) AS (
        VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 500000
      )
      SELECT max(x) AS value FROM n
    `);
    const acceptedWrite = pool.run("INSERT INTO item VALUES ('accepted')");
    const firstClose = pool.close();
    const secondClose = pool.close();

    await expect(pool.get("SELECT 1")).rejects.toThrow(/closing|closed/i);
    await expect(longRead).resolves.toEqual({ value: 500000 });
    await expect(acceptedWrite).resolves.toEqual({ changes: 1 });
    await expect(firstClose).resolves.toBeUndefined();
    await expect(secondClose).resolves.toBeUndefined();
  });

  test("raw native concurrent close callers share the active close worker", async () => {
    const root = projectRoot();
    const childScript = `
      const { pbkdf2 } = require('node:crypto');
      const binding = require('node-gyp-build')(${JSON.stringify(root)});

      (async () => {
        const connection = await binding._openAsyncPoolConnection(':memory:', {
          readBigInts: false,
          returnArrays: false,
          authorizer: 'none',
          allowExtension: false,
          connectionSetup: [],
        });
        const blocker = new Promise((resolve, reject) => {
          pbkdf2('password', 'salt', 500000, 32, 'sha256', (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        // Contract ground truth: close is idempotent and settles after native
        // closure. Fatal auto-close can win this same race with TS cleanup. The
        // blocker keeps the sole libuv worker busy so both callers join one
        // CloseWorker.
        const first = connection.close();
        const second = connection.close();
        const statuses = (await Promise.allSettled([first, second])).map(
          ({ status }) => status,
        );
        await blocker;
        if (statuses.some((status) => status !== 'fulfilled')) {
          throw new Error('concurrent native close rejected');
        }
        await connection.close();
        process.send({ statuses, third: 'fulfilled' }, () => process.exit(0));
      })().catch((error) => {
        process.stderr.write(error.stack || error.message);
        process.exit(2);
      });
    `;
    const child = spawn(process.execPath, ["-e", childScript], {
      cwd: root,
      env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let message: unknown;
    child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("message", (value) => (message = value));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });

    expect({ exitCode, message, stderr }).toEqual({
      exitCode: 0,
      message: {
        statuses: ["fulfilled", "fulfilled"],
        third: "fulfilled",
      },
      stderr: "",
    });
  });

  test("an unrelated completion retains a queued connection open", async () => {
    const root = projectRoot();
    const childScript = `
      const { pbkdf2 } = require('node:crypto');
      const { promisify } = require('node:util');
      const { DatabasePool } = require('./src/experimental.ts');
      const occupyWorker = promisify(pbkdf2);

      (async () => {
        const first = await DatabasePool.open(':memory:', {
          authorizer: 'none',
        });
        let second;
        let result;
        try {
          const completed = first.get('SELECT 1 AS value');
          // Let the facade submit the native request before occupying libuv's
          // only worker. Its completion will run while the second open waits.
          await Promise.resolve();
          const blocker = occupyWorker(
            'password',
            'salt',
            3000000,
            32,
            'sha256',
          );
          const opening = DatabasePool.open(':memory:', {
            authorizer: 'none',
          });

          await completed;
          await blocker;
          second = await opening;
          result = await second.get('SELECT 1 AS value');
        } finally {
          await Promise.allSettled([first.close(), second?.close()]);
        }
        process.send(result, () => process.exit(0));
      })().catch((error) => {
        process.stderr.write(error.stack || error.message);
        process.exit(2);
      });
    `;
    const child = spawn(
      process.execPath,
      ["-r", "tsx/cjs", "-e", childScript],
      {
        cwd: root,
        env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    let message: unknown;
    child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("message", (value) => (message = value));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });

    expect({ exitCode, message, stderr }).toEqual({
      exitCode: 0,
      message: { value: 1 },
      stderr: "",
    });
  });

  testWithExtension(
    "native close accepts extension-owned statements without hanging teardown",
    async () => {
      const binding = nodeGypBuild(projectRoot()) as {
        _openAsyncPoolConnection(
          location: string,
          options: {
            readBigInts: boolean;
            returnArrays: boolean;
            authorizer: string;
            allowExtension: boolean;
            connectionSetup: Array<{
              kind: string;
              sql: string;
              params?: unknown[];
            }>;
          },
        ): Promise<{
          execute(request: {
            operations: Array<{ kind: string; sql: string }>;
          }): Promise<unknown>;
          close(): Promise<void>;
        }>;
      };
      const extensionBase = path.join(
        getDirname(),
        "fixtures",
        "test-extension",
        "test_extension",
      );
      const connection = await binding._openAsyncPoolConnection(":memory:", {
        readBigInts: false,
        returnArrays: false,
        authorizer: "none",
        allowExtension: true,
        connectionSetup: [
          {
            kind: "run",
            sql: "SELECT load_extension(?, ?)",
            params: [extensionBase, "sqlite3_testextension_init"],
          },
        ],
      });

      try {
        await expect(
          connection.execute({
            operations: [
              {
                kind: "get",
                sql: "SELECT test_extension_hold_statement() AS held",
              },
            ],
          }),
        ).resolves.toEqual([{ held: 1 }]);
        await expect(connection.close()).resolves.toBeUndefined();
      } finally {
        const releaser = new DatabaseSync(":memory:", { allowExtension: true });
        try {
          releaser.enableLoadExtension(true);
          releaser.loadExtension(extensionBase, "sqlite3_testextension_init");
          expect(
            releaser
              .prepare("SELECT test_extension_release_statement() AS released")
              .get(),
          ).toEqual({ released: 1 });
        } finally {
          releaser.close();
          await connection.close();
        }
      }
    },
  );

  test("fatal auto-close observes its internal cleanup rejection", async () => {
    const root = projectRoot();
    const childScript = `
      const Module = require('node:module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'node-gyp-build') {
          return () => ({
            async _openAsyncPoolConnection() {
              return {
                execute() {
                  return Promise.reject(
                    Object.assign(new Error('synthetic fatal request'), {
                      fatal: true,
                    }),
                  );
                },
                close() {
                  return Promise.reject(
                    new Error('synthetic native close failure'),
                  );
                },
              };
            },
          });
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      const { DatabasePool } = require('./src/experimental.ts');
      Module._load = originalLoad;

      (async () => {
        const pool = await DatabasePool.open(':memory:', { authorizer: 'none' });
        try {
          await pool.get('SELECT 1');
          throw new Error('fatal request unexpectedly resolved');
        } catch (error) {
          if (error?.fatal !== true) throw error;
        }
        setImmediate(() => {
          pool.close().then(
            () => {
              process.stderr.write('fatal cleanup unexpectedly resolved');
              process.exit(3);
            },
            (error) => {
              if (error?.message !== 'synthetic native close failure') {
                process.stderr.write(error?.stack || String(error));
                process.exit(4);
                return;
              }
              process.send('survived', () => process.exit(0));
            },
          );
        });
      })().catch((error) => {
        process.stderr.write(error.stack || error.message);
        process.exit(2);
      });
    `;
    const child = spawn(
      process.execPath,
      ["--unhandled-rejections=throw", "-r", "tsx/cjs", "-e", childScript],
      {
        cwd: root,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    let message: unknown;
    child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("message", (value) => (message = value));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });

    expect({ exitCode, message, stderr }).toEqual({
      exitCode: 0,
      message: "survived",
      stderr: "",
    });
  });

  test("Symbol.asyncDispose closes idempotently", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    await pool[Symbol.asyncDispose]();
    await pool[Symbol.asyncDispose]();
    await expect(pool.get("SELECT 1")).rejects.toThrow(/closed/i);
  });

  test("in-flight work owns native state independently of the public wrapper", async () => {
    const { operation, weak } = await (async () => {
      const pool = await DatabasePool.open(":memory:", {
        authorizer: "none",
      });
      return {
        weak: new WeakRef(pool),
        operation: pool.get(`
          WITH RECURSIVE n(x) AS (
            VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 250000
          )
          SELECT max(x) AS value FROM n
        `),
      };
    })();
    try {
      global.gc?.();
      await expect(operation).resolves.toEqual({ value: 250000 });
    } finally {
      await weak.deref()?.close();
    }
  });

  test("abrupt worker termination does not hang or race an executing connection", async () => {
    const dbPath = tempDir.getDbPath("terminated-executing.db");
    const setup = new DatabaseSync(dbPath);
    setup.exec(`
      CREATE TABLE item(value INTEGER);
      CREATE TRIGGER slow_insert AFTER INSERT ON item BEGIN
        SELECT max(x) FROM (
          WITH RECURSIVE n(x) AS (
            VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 10000000
          )
          SELECT x FROM n
        );
      END;
    `);
    setup.close();

    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        const binding = require('node-gyp-build')(workerData.root);
        (async () => {
          const connection = await binding._openAsyncPoolConnection(
            workerData.dbPath,
            {
              readBigInts: false,
              returnArrays: false,
              authorizer: 'none',
              allowExtension: false,
              connectionSetup: [],
            },
          );
          const pending = connection.execute({
            operations: [{ kind: 'run', sql: 'INSERT INTO item VALUES (1)' }],
          });
          parentPort.postMessage('submitted');
          await pending;
        })().catch((error) => parentPort.postMessage({ error: error.message }));
      `,
      {
        eval: true,
        workerData: {
          dbPath,
          root: projectRoot(),
        },
      },
    );

    await new Promise<void>((resolve, reject) => {
      worker.once("message", (message) => {
        if (message === "submitted") resolve();
        else
          reject(
            new Error(
              `worker failed before execution: ${JSON.stringify(message)}`,
            ),
          );
      });
      worker.once("error", reject);
    });

    const probe = new DatabaseSync(dbPath, { timeout: 0 });
    let terminated = false;
    try {
      expect(
        await waitForCondition(
          () => {
            try {
              probe.exec("BEGIN IMMEDIATE; ROLLBACK");
              return false;
            } catch (error) {
              if (/busy|locked/i.test((error as Error).message)) return true;
              throw error;
            }
          },
          {
            maxAttempts: 1_000,
            delay: 1,
            description: "executing SQLite write lock",
          },
        ),
      ).toBe(true);
      await expect(worker.terminate()).resolves.toBeGreaterThanOrEqual(0);
      terminated = true;
      expect(probe.prepare("SELECT count(*) AS count FROM item").get()).toEqual(
        {
          count: 1,
        },
      );
    } finally {
      if (!terminated) await worker.terminate();
      if (probe.isOpen) probe.close();
    }
  });

  test("abrupt worker termination safely drains native work queued in libuv", async () => {
    const root = projectRoot();
    const dbPath = tempDir.getDbPath("terminated-queued.db");
    const childScript = `
      const { pbkdf2 } = require('node:crypto');
      const { Worker } = require('node:worker_threads');

      // With UV_THREADPOOL_SIZE=1 this request is ahead of SQLite in libuv's
      // FIFO, so the connection open below is deterministically still queued.
      pbkdf2('password', 'salt', 20000000, 32, 'sha256', () => {});

      const worker = new Worker(\`
        const { parentPort, workerData } = require('node:worker_threads');
        const binding = require('node-gyp-build')(workerData.root);
        const opening = binding._openAsyncPoolConnection(workerData.dbPath, {
          readBigInts: false,
          returnArrays: false,
          authorizer: 'none',
          allowExtension: false,
          connectionSetup: [],
        });
        parentPort.postMessage('open-submitted');
        void opening;
      \`, {
        eval: true,
        workerData: ${JSON.stringify({ root, dbPath })},
      });

      worker.once('message', async (message) => {
        if (message !== 'open-submitted') process.exit(2);
        await worker.terminate();
        process.send('queued work drained', () => process.exit(0));
      });
      worker.once('error', (error) => {
        process.stderr.write(error.stack || error.message);
        process.exit(3);
      });
    `;
    const child = spawn(process.execPath, ["-e", childScript], {
      cwd: root,
      env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let message: unknown;
    child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("message", (value) => (message = value));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect({ exitCode, message, stderr }).toEqual({
      exitCode: 0,
      message: "queued work drained",
      stderr: "",
    });
    expect(existsSync(dbPath)).toBe(true);
  });
});
