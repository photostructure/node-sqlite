import { DatabaseSync, type DatabaseSyncInstance } from "../src";

type Statement = ReturnType<DatabaseSyncInstance["prepare"]>;
type IteratorWithToArray = IterableIterator<unknown> & {
  toArray(): unknown[];
};
type RowReader = (statement: Statement) => unknown;

const rowReaders: ReadonlyArray<[string, RowReader]> = [
  ["get()", (statement) => statement.get()],
  ["all()", (statement) => statement.all()[0]],
  ["iterate().next()", (statement) => statement.iterate().next().value],
  [
    "iterate().toArray()",
    (statement) => (statement.iterate() as IteratorWithToArray).toArray()[0],
  ],
];

function expectNullPrototype(value: unknown): asserts value is object {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Object.getPrototypeOf(value)).toBeNull();
}

function expectOutOfRange(callback: () => unknown): void {
  let error: unknown;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }

  expect(error).toEqual(
    expect.objectContaining({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: expect.stringContaining(
        "Value is too large to be represented as a JavaScript number",
      ),
    }),
  );
}

describe("Statement row materialization", () => {
  let db: DatabaseSyncInstance;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) db.close();
  });

  test.each(rowReaders)(
    "%s preserves null prototypes, special names, duplicates, and key order",
    (_name, readRow) => {
      const statement = db.prepare(`
        SELECT
          1 AS first,
          2 AS duplicate,
          3 AS middle,
          4 AS duplicate,
          5 AS "__proto__",
          6 AS last
      `);

      const row = readRow(statement) as Record<string, unknown>;

      expectNullPrototype(row);
      expect(Object.keys(row)).toEqual([
        "first",
        "duplicate",
        "middle",
        "__proto__",
        "last",
      ]);
      expect(row).toEqual(
        Object.assign(Object.create(null), {
          first: 1,
          duplicate: 4,
          middle: 3,
          ["__proto__"]: 5,
          last: 6,
        }),
      );
      expect(Object.hasOwn(row, "__proto__")).toBe(true);
      expect(Object.getOwnPropertyDescriptor(row, "__proto__")).toEqual({
        configurable: true,
        enumerable: true,
        value: 5,
        writable: true,
      });
    },
  );

  test("iterator records keep their null prototype and field order", () => {
    const iterator = db.prepare("SELECT 1 AS value").iterate();
    const rowRecord = iterator.next();
    const terminalRecord = iterator.next();
    const repeatedTerminalRecord = iterator.next();

    const returnedIterator = db.prepare("SELECT 2 AS value").iterate();
    const returnRecord = returnedIterator.return!();
    const terminalAfterReturn = returnedIterator.next();

    for (const record of [
      rowRecord,
      terminalRecord,
      repeatedTerminalRecord,
      returnRecord,
      terminalAfterReturn,
    ]) {
      expectNullPrototype(record);
      expect(Object.keys(record)).toEqual(["done", "value"]);
    }

    expect(rowRecord.done).toBe(false);
    expectNullPrototype(rowRecord.value);
    expect(rowRecord.value).toEqual(
      Object.assign(Object.create(null), { value: 1 }),
    );

    for (const record of [
      terminalRecord,
      repeatedTerminalRecord,
      returnRecord,
      terminalAfterReturn,
    ]) {
      expect(record).toEqual(
        Object.assign(Object.create(null), { done: true, value: null }),
      );
    }
  });

  test.each(rowReaders)(
    "%s preserves every SQLite value kind with readBigInts enabled",
    (_name, readRow) => {
      const statement = db.prepare(`
        SELECT
          42 AS integerValue,
          1.25 AS floatValue,
          CAST(X'610062' AS TEXT) AS textValue,
          NULL AS nullValue,
          X'DEADBEEF' AS blobValue,
          9007199254740992 AS bigValue
      `);
      statement.setReadBigInts(true);

      const row = readRow(statement) as Record<string, unknown>;

      expectNullPrototype(row);
      expect(row["integerValue"]).toBe(42n);
      expect(row["floatValue"]).toBe(1.25);
      expect(row["textValue"]).toBe("a\0b");
      expect(row["nullValue"]).toBeNull();
      expect(row["blobValue"]).toEqual(
        new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      );
      expect(row["bigValue"]).toBe(9007199254740992n);
    },
  );

  test.each(rowReaders)(
    "%s surfaces the exact unsafe-integer error",
    (_name, readRow) => {
      const statement = db.prepare("SELECT 9007199254740992 AS unsafeInteger");

      expectOutOfRange(() => readRow(statement));
    },
  );

  test.each(rowReaders)(
    "%s follows return-array toggles made between executions",
    (_name, readRow) => {
      const statement = db.prepare(
        "SELECT 1 AS duplicate, 2 AS duplicate, 3 AS last",
      );

      statement.setReturnArrays(true);
      expect(readRow(statement)).toEqual([1, 2, 3]);

      statement.setReturnArrays(false);
      const row = readRow(statement) as Record<string, unknown>;
      expectNullPrototype(row);
      expect(Object.keys(row)).toEqual(["duplicate", "last"]);
      expect(row).toEqual(
        Object.assign(Object.create(null), { duplicate: 2, last: 3 }),
      );
    },
  );

  test("empty and non-row statements keep their path-specific results", () => {
    const empty = db.prepare("SELECT 1 AS value WHERE false");
    expect(empty.get()).toBeUndefined();
    expect(empty.all()).toEqual([]);

    const emptyRecord = empty.iterate().next();
    expectNullPrototype(emptyRecord);
    expect(emptyRecord).toEqual(
      Object.assign(Object.create(null), { done: true, value: null }),
    );
    expect((empty.iterate() as IteratorWithToArray).toArray()).toEqual([]);

    expect(db.prepare("CREATE TABLE edge_get(value)").get()).toBeUndefined();
    expect(db.prepare("CREATE TABLE edge_all(value)").all()).toEqual([]);

    const nonRowRecord = db
      .prepare("CREATE TABLE edge_next(value)")
      .iterate()
      .next();
    expectNullPrototype(nonRowRecord);
    expect(nonRowRecord).toEqual(
      Object.assign(Object.create(null), { done: true, value: null }),
    );
    expect(
      (
        db
          .prepare("CREATE TABLE edge_to_array(value)")
          .iterate() as IteratorWithToArray
      ).toArray(),
    ).toEqual([]);
  });

  test.each(rowReaders)(
    "%s uses the post-reprepare result shape",
    (name, readRow) => {
      const suffix = name.replaceAll(/[^a-z]/gi, "_");
      const table = `shape_${suffix}`;
      db.exec(`
        CREATE TABLE ${table} (original INTEGER);
        INSERT INTO ${table} VALUES (1);
      `);
      const statement = db.prepare(`SELECT * FROM ${table}`);

      db.exec(`ALTER TABLE ${table} ADD COLUMN added TEXT DEFAULT 'new value'`);

      const row = readRow(statement) as Record<string, unknown>;
      expectNullPrototype(row);
      expect(Object.keys(row)).toEqual(["original", "added"]);
      expect(row).toEqual(
        Object.assign(Object.create(null), {
          original: 1,
          added: "new value",
        }),
      );
    },
  );
});
