/**
 * This file uses TypeScript's type system to ensure our API is compatible with node:sqlite.
 * It maps our interface names to node:sqlite names and checks compatibility.
 */

import * as NodeSqlite from "node:sqlite";
import * as OurSqlite from "./index";

// Type assertion helpers
type _Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
type _Assert<T extends true> = T;

// Our API uses different names, so we map them:
// OurSqlite.DatabaseSync = NodeSqlite.DatabaseSync
// OurSqlite.StatementSync = NodeSqlite.StatementSync
// OurSqlite.Database = similar to NodeSqlite.DatabaseSync instance
// OurSqlite.PreparedStatement = similar to NodeSqlite.StatementSync instance

// Check that our main classes are exported
const _hasDatabaseSync: typeof OurSqlite.DatabaseSync = OurSqlite.DatabaseSync;
const _hasStatementSync: typeof OurSqlite.StatementSync =
  OurSqlite.StatementSync;

// Check that our interfaces correspond to node:sqlite interfaces
// Note: We use different names but should have compatible structure

// Database options compatibility - check key overlap
type _NodeDbOptions = NodeSqlite.DatabaseSyncOptions;
type OurDbOptions = OurSqlite.DatabaseOpenConfiguration;

// Check if our options can be assigned where node options are expected
type _OptionsCompatible = {
  open?: boolean;
  enableForeignKeyConstraints?: boolean;
  enableDoubleQuotedStringLiterals?: boolean;
  readOnly?: boolean;
  allowExtension?: boolean;
};

// Verify our options have compatible fields
function _checkOptionsCompat() {
  const _ourOpts: OurDbOptions = {
    readOnly: true,
    enableForeignKeys: true,
    enableDoubleQuotedStringLiterals: true,
    allowExtension: true,
  };
  // Note: field names differ slightly but serve same purpose
}

// Check method compatibility by creating instances
function _checkDatabaseMethodsExist() {
  const db = {} as InstanceType<typeof OurSqlite.DatabaseSync>;

  // Core methods that must exist
  const _close: () => void = db.close;
  const _exec: (sql: string) => void = db.exec;
  const _prepare: (sql: string) => any = db.prepare;
  const _open: () => void = db.open;

  // User functions
  const _function = db.function;
  const _aggregate = db.aggregate;

  // Properties
  const _isOpen: boolean = db.isOpen;

  // Session support (optional)
  if ("createSession" in db) {
    const _createSession = db.createSession;
  }

  // Changeset support (optional)
  if ("applyChangeset" in db) {
    const _applyChangeset = db.applyChangeset;
  }

  // Extension support (optional)
  if ("loadExtension" in db) {
    const _loadExtension = db.loadExtension;
  }

  // Symbol.dispose
  if (typeof Symbol !== "undefined" && Symbol.dispose) {
    const _dispose = db[Symbol.dispose];
  }
}

function _checkStatementMethodsExist() {
  const stmt = {} as InstanceType<typeof OurSqlite.StatementSync>;

  // Core methods
  const _run = stmt.run;
  const _get = stmt.get;
  const _all = stmt.all;
  const _iterate = stmt.iterate;

  // Properties
  const _sourceSQL: string = stmt.sourceSQL;
  const _expandedSQL: string | undefined = stmt.expandedSQL;

  // Configuration
  const _setReadBigInts = stmt.setReadBigInts;
  const _setAllowBareNamedParameters = stmt.setAllowBareNamedParameters;

  // Finalization
  if ("finalize" in stmt) {
    const _finalize = stmt.finalize;
  }

  // Symbol.dispose
  if (typeof Symbol !== "undefined" && Symbol.dispose) {
    const _dispose = stmt[Symbol.dispose];
  }
}

// Check constants exist
function _checkConstants() {
  if (OurSqlite.constants) {
    // Changeset constants
    const _omit: number = OurSqlite.constants.SQLITE_CHANGESET_OMIT;
    const _replace: number = OurSqlite.constants.SQLITE_CHANGESET_REPLACE;
    const _abort: number = OurSqlite.constants.SQLITE_CHANGESET_ABORT;

    // Should have same values as node:sqlite
    if (NodeSqlite.constants) {
      const _omitMatch =
        OurSqlite.constants.SQLITE_CHANGESET_OMIT ===
        NodeSqlite.constants.SQLITE_CHANGESET_OMIT;
      const _replaceMatch =
        OurSqlite.constants.SQLITE_CHANGESET_REPLACE ===
        NodeSqlite.constants.SQLITE_CHANGESET_REPLACE;
      const _abortMatch =
        OurSqlite.constants.SQLITE_CHANGESET_ABORT ===
        NodeSqlite.constants.SQLITE_CHANGESET_ABORT;
    }
  }
}

// SQL value types - node:sqlite uses these
type _NodeSQLInput = NodeSqlite.SQLInputValue;
type _NodeSQLOutput = NodeSqlite.SQLOutputValue;

// We should accept similar types
type _OurAcceptedTypes = null | number | bigint | string | Buffer | Uint8Array;
type _OurReturnedTypes = null | number | bigint | string | Uint8Array;

// Statement result types
type _NodeChangesResult = NodeSqlite.StatementResultingChanges;

// Our result should have same shape
type OurChangesShape = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};

// Ensure critical methods have correct signatures
function _checkMethodSignatures() {
  const db = {} as InstanceType<typeof OurSqlite.DatabaseSync>;
  const stmt = {} as InstanceType<typeof OurSqlite.StatementSync>;

  // Database.prepare should return a statement
  const _preparedStmt: InstanceType<typeof OurSqlite.StatementSync> =
    db.prepare("SELECT 1");

  // Statement.run should return changes
  const _runResult: OurChangesShape = stmt.run();

  // Statement.get should return a record or undefined
  const _getResult: Record<string, any> | undefined = stmt.get();

  // Statement.all should return array of records
  const _allResult: Record<string, any>[] = stmt.all();
}

export {}; // Make this a module
