import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { backup, DatabaseSync } from "../src";
import { useTempDir } from "./test-utils";

// A getter that a native method runs while reading an argument can throw any
// value, and the caller must receive that same value, as from node:sqlite
// (checked on v24.21.0 for every entry point below that it has). The
// constructor turned it into a new ERR_SQLITE_ERROR error, and get(), run(),
// and all() into a new Error carrying a thrown Error's message, or an empty
// message for a thrown primitive.

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
}

// An object whose `key` getter throws `value`.
function throwing(value: unknown, key: string): object {
  return Object.defineProperty({}, key, {
    enumerable: true,
    get() {
      throw value;
    },
  });
}

describe("a value thrown by an argument getter", () => {
  const { getDbPath } = useTempDir("sqlite-getter-errors-");
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) db.close();
  });

  function changeset(): Uint8Array {
    const source = new DatabaseSync(":memory:");
    try {
      source.exec("CREATE TABLE t (k INTEGER PRIMARY KEY)");
      const session = source.createSession();
      source.exec("INSERT INTO t VALUES (1)");
      return session.changeset();
    } finally {
      source.close();
    }
  }

  function serialized(): Uint8Array {
    const source = new DatabaseSync(":memory:");
    try {
      return source.serialize();
    } finally {
      source.close();
    }
  }

  const entryPoints: Record<string, (thrown: unknown) => unknown> = {
    "a constructor option": (thrown) =>
      new DatabaseSync(":memory:", throwing(thrown, "open")),
    "a constructor limit": (thrown) =>
      new DatabaseSync(":memory:", { limits: throwing(thrown, "length") }),
    "a prepare() option": (thrown) =>
      db.prepare("SELECT 1", throwing(thrown, "readBigInts")),
    "a get() named parameter": (thrown) =>
      db.prepare("SELECT $x").get(throwing(thrown, "$x")),
    "a run() named parameter": (thrown) =>
      db.prepare("SELECT $x").run(throwing(thrown, "$x")),
    "an all() named parameter": (thrown) =>
      db.prepare("SELECT $x").all(throwing(thrown, "$x")),
    "an iterate() named parameter": (thrown) =>
      db.prepare("SELECT $x").iterate(throwing(thrown, "$x")),
    "a function() option": (thrown) =>
      db.function("f", throwing(thrown, "deterministic"), () => 1),
    "an aggregate() option": (thrown) =>
      db.aggregate("a", throwing(thrown, "start") as never),
    "a createModule() option": (thrown) =>
      db.createModule("m", throwing(thrown, "columns") as never),
    "a createSession() option": (thrown) =>
      db.createSession(throwing(thrown, "table")),
    "an applyChangeset() option": (thrown) =>
      db.applyChangeset(changeset(), throwing(thrown, "filter")),
    "a backup() option": (thrown) =>
      backup(db, getDbPath("backup.db"), throwing(thrown, "rate")),
    "a deserialize() option": (thrown) =>
      db.deserialize(serialized(), throwing(thrown, "dbName")),
  };

  describe.each(Object.entries(entryPoints))("on %s", (_name, run) => {
    it("reaches the caller as the same Error", () => {
      const error = new Error("getter failed");
      expect(thrownBy(() => run(error))).toBe(error);
    });

    it("reaches the caller as the same primitive", () => {
      expect(thrownBy(() => run("getter failed"))).toBe("getter failed");
    });
  });
});
