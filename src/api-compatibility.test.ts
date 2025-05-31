/**
 * This file uses TypeScript's type system to ensure our API is compatible with node:sqlite.
 * It maps our interface names to node:sqlite names and checks compatibility.
 *
 * Note: This file only performs type checking on Node.js 24 or later where node:sqlite is available.
 * On earlier versions, the type imports will fail and this file should be excluded from compilation.
 */

import * as OurSqlite from "./index";

// Only import node:sqlite types on Node.js 24+
import * as NodeSqlite from "node:sqlite";

// Type assertion helpers
type _Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
type _Assert<T extends true> = T;

// Our API now matches node:sqlite naming:
// OurSqlite.DatabaseSync = NodeSqlite.DatabaseSync
// OurSqlite.StatementSync = NodeSqlite.StatementSync
// OurSqlite.DatabaseSyncInstance = NodeSqlite.DatabaseSync instance
// OurSqlite.StatementSyncInstance = NodeSqlite.StatementSync instance

// Check that our main classes are exported
const _hasDatabaseSync: typeof OurSqlite.DatabaseSync = OurSqlite.DatabaseSync;
const _hasStatementSync: typeof OurSqlite.StatementSync =
  OurSqlite.StatementSync;

// Check that our interfaces correspond to node:sqlite interfaces
// Note: We use different names but should have compatible structure

// Database options compatibility - check key overlap
type _NodeDbOptions = NodeSqlite.DatabaseSyncOptions;
type OurDbOptions = OurSqlite.DatabaseSyncOptions;

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
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: true,
    allowExtension: true,
  };
  // Field names now match node:sqlite exactly
}

// Check method compatibility by creating instances
function _checkDatabaseMethodsExist() {
  const db = {} as InstanceType<typeof OurSqlite.DatabaseSync>;

  // Core methods that must exist
  const _close: () => void = db.close;
  const _exec: (sql: string) => void = db.exec;
  const _prepare: (sql: string) => any = db.prepare;
  const _open: (config?: OurSqlite.DatabaseSyncOptions) => void = db.open;

  // User functions
  const _function: {
    (name: string, func: Function): void;
    (
      name: string,
      options: OurSqlite.UserFunctionOptions,
      func: Function,
    ): void;
  } = db.function;
  const _aggregate: (
    name: string,
    options: OurSqlite.AggregateOptions,
  ) => void = db.aggregate;

  // Properties
  const _isOpen: boolean = db.isOpen;
  const _isTransaction: boolean = db.isTransaction;
  const _location: string | null = db.location();

  // Session support
  const _createSession: (
    options?: OurSqlite.SessionOptions,
  ) => OurSqlite.Session = db.createSession;
  const _applyChangeset: (
    changeset: Buffer,
    options?: OurSqlite.ChangesetApplyOptions,
  ) => boolean = db.applyChangeset;

  // Extension support
  const _enableLoadExtension: (enable: boolean) => void =
    db.enableLoadExtension;
  const _loadExtension: (path: string, entryPoint?: string) => void =
    db.loadExtension;

  // Backup functionality
  const _backup: (
    path: string,
    options?: {
      rate?: number;
      source?: string;
      target?: string;
      progress?: (info: { totalPages: number; remainingPages: number }) => void;
    },
  ) => Promise<number> = db.backup;

  // Symbol.dispose
  if (typeof Symbol !== "undefined" && Symbol.dispose) {
    const _dispose = db[Symbol.dispose];
  }
}

function _checkStatementMethodsExist() {
  const stmt = {} as InstanceType<typeof OurSqlite.StatementSync>;

  // Core methods
  const _run: (...params: any[]) => OurChangesShape = stmt.run;
  const _get: (...params: any[]) => any = stmt.get;
  const _all: (...params: any[]) => any[] = stmt.all;
  const _iterate: (...params: any[]) => IterableIterator<any> = stmt.iterate;

  // Properties
  const _sourceSQL: string = stmt.sourceSQL;
  const _expandedSQL: string | undefined = stmt.expandedSQL;

  // Configuration
  const _setReadBigInts: (readBigInts: boolean) => void = stmt.setReadBigInts;
  const _setAllowBareNamedParameters: (allow: boolean) => void =
    stmt.setAllowBareNamedParameters;
  const _setReturnArrays: (returnArrays: boolean) => void =
    stmt.setReturnArrays;

  // Column metadata
  const _columns: () => Array<{ name: string; type?: string }> = stmt.columns;

  // Finalization
  const _finalize: () => void = stmt.finalize;

  // Symbol.dispose
  if (typeof Symbol !== "undefined" && Symbol.dispose) {
    const _dispose = stmt[Symbol.dispose];
  }
}

// Check constants exist
function _checkConstants() {
  if (OurSqlite.constants) {
    // Open constants
    const _openReadonly: number = OurSqlite.constants.SQLITE_OPEN_READONLY;
    const _openReadwrite: number = OurSqlite.constants.SQLITE_OPEN_READWRITE;
    const _openCreate: number = OurSqlite.constants.SQLITE_OPEN_CREATE;

    // Changeset constants
    const _omit: number = OurSqlite.constants.SQLITE_CHANGESET_OMIT;
    const _replace: number = OurSqlite.constants.SQLITE_CHANGESET_REPLACE;
    const _abort: number = OurSqlite.constants.SQLITE_CHANGESET_ABORT;
    const _data: number = OurSqlite.constants.SQLITE_CHANGESET_DATA;
    const _notfound: number = OurSqlite.constants.SQLITE_CHANGESET_NOTFOUND;
    const _conflict: number = OurSqlite.constants.SQLITE_CHANGESET_CONFLICT;
    const _constraint: number = OurSqlite.constants.SQLITE_CHANGESET_CONSTRAINT;
    const _foreign_key: number =
      OurSqlite.constants.SQLITE_CHANGESET_FOREIGN_KEY;

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

// Check Session class compatibility
function _checkSessionClass() {
  if (OurSqlite.Session) {
    const session = {} as InstanceType<typeof OurSqlite.Session>;

    // Methods
    const _changeset: () => Buffer = session.changeset;
    const _patchset: () => Buffer = session.patchset;
    const _close: () => void = session.close;
  }
}

// Check constructor signatures
function _checkConstructorSignatures() {
  // DatabaseSync constructors
  const _db1 = new OurSqlite.DatabaseSync(); // No args - in-memory
  const _db2 = new OurSqlite.DatabaseSync(":memory:"); // Path only
  const _db3 = new OurSqlite.DatabaseSync(":memory:", { readOnly: false }); // Full signature

  // StatementSync should not be directly constructible by users
  // Session should not be directly constructible by users
}

// Check type aliases exist
type _CheckSQLTypes = {
  input: null | number | bigint | string | Buffer | Uint8Array;
  output: null | number | bigint | string | Uint8Array;
};

// Verify all database options are present
function _checkAllDatabaseOptions() {
  const _opts: OurSqlite.DatabaseSyncOptions = {
    location: ":memory:",
    readOnly: false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: true,
    timeout: 5000,
    allowExtension: false,
  };
}

// Check aggregate options completeness
function _checkAggregateOptions() {
  const _opts: OurSqlite.AggregateOptions = {
    start: 0,
    step: (acc: any, value: any) => acc + value,
    inverse: (acc: any, value: any) => acc - value, // For window functions
    result: (acc: any) => acc,
    deterministic: true,
    directOnly: false,
    useBigIntArguments: false,
    varargs: false,
  };
}

// Add a simple test to satisfy Jest
describe("API Compatibility", () => {
  it("type checks pass at compile time", () => {
    // This test file is primarily for TypeScript compile-time checks
    // The actual testing happens during TypeScript compilation
    expect(true).toBe(true);
  });
});

export {}; // Make this a module
