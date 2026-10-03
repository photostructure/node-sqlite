import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { constants } from "node:buffer";
import * as diagnosticsChannel from "node:diagnostics_channel";
import { totalmem } from "node:os";
import { DatabaseSync, type DatabaseSyncInstance } from "../src";
import { DatabasePool } from "../src/experimental";
import { getTestTimeout, isEmulated } from "./test-utils";

// SQLite serves TEXT up to SQLITE_MAX_LENGTH (1,000,000,000 bytes), longer
// than V8 can hold in a string. node:sqlite throws ERR_STRING_TOO_LONG when it
// converts such a value (nodejs/node#66209), and so does this package, on
// every path that turns SQLite TEXT into a JavaScript string.
//
// hex() doubles its input, so this is the smallest blob whose text form
// exceeds what V8 can hold in a string.
const blobSize = (constants.MAX_STRING_LENGTH >>> 1) + 1;
const oversizedText = `hex(zeroblob(${blobSize}))`;
const tooLong = { name: "Error", code: "ERR_STRING_TOO_LONG" };

// Measured on Linux x64, a Jest process running one of these cases peaks at
// about 1.6 GB RSS (2.1 GB for DatabasePool, which copies the 512 MB hex()
// text off its worker thread; 1.1 GB for an expanded SQL case), against
// 0.34 GB running none. Upstream gates
// its version of this test on 1.75 GB of total memory for a lone node:test
// process; Jest runs other suites in parallel worker processes, so require
// 4 GiB.
const enoughMemory = totalmem() >= 4 * 1024 ** 3;
const describeLarge = enoughMemory && !isEmulated() ? describe : describe.skip;

type Statement = ReturnType<DatabaseSyncInstance["prepare"]>;
type IteratorWithToArray = IterableIterator<unknown> & {
  toArray(): unknown[];
};

const rowReaders: ReadonlyArray<[string, (statement: Statement) => unknown]> = [
  ["get()", (statement) => statement.get(blobSize)],
  ["all()", (statement) => statement.all(blobSize)],
  ["iterate().next()", (statement) => statement.iterate(blobSize).next()],
  [
    "iterate().toArray()",
    (statement) =>
      (statement.iterate(blobSize) as IteratorWithToArray).toArray(),
  ],
];

describeLarge("TEXT values longer than the maximum string length", () => {
  jest.setTimeout(getTestTimeout(30_000));

  let db: DatabaseSyncInstance;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) db.close();
  });

  test.each(rowReaders)(
    "%s throws ERR_STRING_TOO_LONG and the statement stays usable",
    (_name, readRows) => {
      const statement = db.prepare("SELECT hex(zeroblob(?)) AS val");
      expect(() => readRows(statement)).toThrow(
        expect.objectContaining(tooLong),
      );
      expect(statement.get(1)).toEqual({ val: "00" });
    },
  );

  test("exec() surfaces the error from a user-defined function argument", () => {
    db.exec("CREATE TABLE data(val TEXT)");
    let calls = 0;
    db.function("identity", (val: unknown) => {
      calls++;
      return val;
    });

    expect(() =>
      db.exec(`INSERT INTO data (val) VALUES (identity(${oversizedText}))`),
    ).toThrow(expect.objectContaining(tooLong));
    expect(calls).toBe(0);
    expect(db.prepare("SELECT count(*) AS count FROM data").get()).toEqual({
      count: 0,
    });
    expect(() => db.close()).not.toThrow();
  });

  test("a statement surfaces the error from a user-defined function argument", () => {
    db.function("identity", (val: unknown) => val);
    const statement = db.prepare("SELECT identity(hex(zeroblob(?))) AS val");

    expect(() => statement.get(blobSize)).toThrow(
      expect.objectContaining(tooLong),
    );
    expect(statement.get(1)).toEqual({ val: "00" });
    expect(() => db.close()).not.toThrow();
  });

  test("exec() surfaces the error from an aggregate step argument", () => {
    let steps = 0;
    db.aggregate("first", {
      start: null,
      step: (accumulator: unknown, value: unknown) => {
        steps++;
        return accumulator ?? value;
      },
    });

    expect(() => db.exec(`SELECT first(${oversizedText})`)).toThrow(
      expect.objectContaining(tooLong),
    );
    expect(steps).toBe(0);
    expect(() => db.close()).not.toThrow();
  });

  test("DatabasePool rejects with ERR_STRING_TOO_LONG and stays usable", async () => {
    const pool = await DatabasePool.open(":memory:", { authorizer: "none" });
    try {
      await expect(
        pool.get("SELECT hex(zeroblob(?)) AS val", [blobSize]),
      ).rejects.toMatchObject(tooLong);
      await expect(
        pool.get("SELECT hex(zeroblob(?)) AS val", [1]),
      ).resolves.toEqual({ val: "00" });
    } finally {
      await pool.close();
    }
  });
});

// A bound blob appears in expanded SQL as x'<hex>', twice its size, so a
// blobSize blob also expands past the limit. node:sqlite has no behavior to
// match here: it converts expanded SQL with V8's auto-length
// String::NewFromUtf8(), which aborts the process on such a string (Node.js
// v24.21.0 does when reading expandedSQL).
describeLarge("expanded SQL longer than the maximum string length", () => {
  jest.setTimeout(getTestTimeout(30_000));

  let db: DatabaseSyncInstance;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) db.close();
  });

  test("expandedSQL throws ERR_STRING_TOO_LONG", () => {
    const statement = db.prepare("SELECT length(?) AS n");
    expect(statement.get(Buffer.alloc(blobSize))).toEqual({ n: blobSize });

    expect(() => statement.expandedSQL).toThrow(
      expect.objectContaining(tooLong),
    );
    statement.get(Buffer.from([0xab]));
    expect(statement.expandedSQL).toBe("SELECT length(x'ab') AS n");
  });

  test("a sqlite.db.query subscriber gets no event and the statement succeeds", () => {
    const published: string[] = [];
    const handler = (message: unknown) => {
      published.push((message as { sql: string }).sql);
    };
    diagnosticsChannel.subscribe("sqlite.db.query", handler);

    try {
      const statement = db.prepare("SELECT length(?) AS n");
      expect(statement.get(Buffer.alloc(blobSize))).toEqual({ n: blobSize });
      expect(published).toEqual([]);

      expect(statement.get(Buffer.from([0xab]))).toEqual({ n: 1 });
      expect(published).toEqual(["SELECT length(x'ab') AS n"]);
    } finally {
      diagnosticsChannel.unsubscribe("sqlite.db.query", handler);
    }
    expect(() => db.close()).not.toThrow();
  });
});
