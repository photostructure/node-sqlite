import * as diagnosticsChannel from "node:diagnostics_channel";
import { DatabaseSync, constants } from "../src";

describe("session lifetime during SQLite callbacks", () => {
  test("keeps sessions alive during an authorizer callback", () => {
    expect(typeof global.gc).toBe("function");

    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE data(key INTEGER PRIMARY KEY)");
    database.createSession();

    let callbackRan = false;
    database.setAuthorizer((actionCode, parameter) => {
      if (
        actionCode === constants.SQLITE_PRAGMA &&
        parameter === "table_xinfo"
      ) {
        callbackRan = true;
        global.gc!();
        global.gc!();
      }
      return constants.SQLITE_OK;
    });

    database.exec("INSERT INTO data VALUES (1)");
    expect(callbackRan).toBe(true);
    database.setAuthorizer(null);
    database.close();
  });

  test("keeps sessions alive during a query diagnostics subscriber", () => {
    expect(typeof global.gc).toBe("function");

    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE data(key INTEGER PRIMARY KEY)");
    database.createSession();

    let callbackRan = false;
    const handler = (message: unknown) => {
      const { sql } = message as { sql: string };
      if (sql.includes("table_xinfo")) {
        callbackRan = true;
        global.gc!();
        global.gc!();
      }
    };
    diagnosticsChannel.subscribe("sqlite.db.query", handler);

    try {
      database.exec("INSERT INTO data VALUES (1)");
      expect(callbackRan).toBe(true);
    } finally {
      diagnosticsChannel.unsubscribe("sqlite.db.query", handler);
      database.close();
    }
  });

  test.each(["changeset", "patchset"] as const)(
    "%s rejects close and disposal while the session is in use",
    (method) => {
      for (const close of ["close", Symbol.dispose] as const) {
        const database = new DatabaseSync(":memory:");
        database.exec("CREATE TABLE data(key INTEGER PRIMARY KEY)");
        const session = database.createSession({ table: "data" });
        database.exec("INSERT INTO data VALUES (1)");

        let closeError: unknown;
        database.setAuthorizer(() => {
          try {
            session[close]();
          } catch (error) {
            closeError = error;
          }
          return constants.SQLITE_OK;
        });

        expect(session[method]().length).toBeGreaterThan(0);
        expect(closeError).toEqual(
          expect.objectContaining({
            code: "ERR_INVALID_STATE",
            message: "session is currently in use",
          }),
        );

        database.setAuthorizer(null);
        session.close();
        database.close();
      }
    },
  );
});
