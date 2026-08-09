import { describe, expect, it } from "@jest/globals";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { getTestTimeout, projectRoot } from "./test-utils";

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

function runNode(args: string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
  });
}

function expectSuccessfulSelect(result: ChildResult): void {
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(
      `SELECT child exited with code ${String(result.code)} and signal ${String(result.signal)}:\n${result.stderr}`,
    );
  }
  expect(result.stdout).toBe("SELECT_OK");
}

function waitForReady(worker: Worker, run: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const onMessage = (message: unknown) => {
      cleanup();
      if (message === "ready") {
        resolve();
      } else {
        reject(
          new Error(
            `Worker ${run} sent an unexpected readiness message: ${String(message)}`,
          ),
        );
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(
        new Error(`Worker ${run} exited before readiness with code ${code}`),
      );
    };

    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
  });
}

describe("Statement environment boundaries", () => {
  const cjsEntry = path.join(projectRoot(), "dist", "index.cjs");
  const esmEntry = pathToFileURL(
    path.join(projectRoot(), "dist", "index.mjs"),
  ).href;

  it.each([
    {
      label: "CommonJS",
      args: [
        "--disallow-code-generation-from-strings",
        "--eval",
        `
          const { DatabaseSync } = require(${JSON.stringify(cjsEntry)});
          const db = new DatabaseSync(":memory:");
          try {
            const row = db.prepare("SELECT 42 AS answer").get();
            if (row.answer !== 42) throw new Error("unexpected SELECT result");
            process.stdout.write("SELECT_OK");
          } finally {
            db.close();
          }
        `,
      ],
    },
    {
      label: "ESM",
      args: [
        "--disallow-code-generation-from-strings",
        "--input-type=module",
        "--eval",
        `
          import { DatabaseSync } from ${JSON.stringify(esmEntry)};
          const db = new DatabaseSync(":memory:");
          try {
            const row = db.prepare("SELECT 42 AS answer").get();
            if (row.answer !== 42) throw new Error("unexpected SELECT result");
            process.stdout.write("SELECT_OK");
          } finally {
            db.close();
          }
        `,
      ],
    },
  ])(
    "imports the $label build and executes SELECT when string code generation is disabled",
    async ({ args }) => {
      expectSuccessfulSelect(await runNode(args));
    },
    getTestTimeout(),
  );

  it(
    "survives repeated abrupt worker termination with live SELECT wrappers",
    async () => {
      const workerSource = `
        const { parentPort } = require("node:worker_threads");
        const { DatabaseSync } = require(${JSON.stringify(cjsEntry)});

        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO test VALUES (1, 'one'), (2, 'two')");
        const statement = db.prepare("SELECT value FROM test ORDER BY id");
        const iterator = statement.iterate();
        const first = iterator.next();
        if (first.done || first.value.value !== "one") {
          throw new Error("worker SELECT did not produce the expected first row");
        }

        // Keep every wrapper reachable while the parent tears down this N-API
        // environment. The readiness handshake proves termination happens only
        // after the addon, database, statement, and iterator are all live.
        globalThis.liveSelectState = { db, statement, iterator };
        parentPort.postMessage("ready");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      `;

      for (let run = 1; run <= 25; run++) {
        const worker = new Worker(workerSource, { eval: true });
        let terminationStarted = false;
        try {
          await waitForReady(worker, run);
          terminationStarted = true;
          const exitCode = await worker.terminate();
          expect(Number.isInteger(exitCode)).toBe(true);
        } finally {
          if (!terminationStarted) {
            await worker.terminate();
          }
        }
      }
    },
    getTestTimeout(30000),
  );
});
