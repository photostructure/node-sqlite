/**
 * This file uses TypeScript's type system to ensure our API is compatible with node:sqlite.
 * It maps our interface names to node:sqlite names and checks compatibility.
 *
 * Note: This file only performs type checking on Node.js 24 or later where node:sqlite is available.
 * On earlier versions, the type imports will fail and this file should be excluded from compilation.
 *
 * All "unused" variables and types in this file are intentional - they exist solely to perform
 * compile-time type checking to ensure API compatibility.
 *
 * @fileoverview
 * ⚠️ DO NOT "FIX" UNUSED VARIABLES IN THIS FILE! ⚠️
 *
 * This is a compile-time type compatibility test. All variables prefixed with underscore (_)
 * are intentionally unused. They exist to force TypeScript to check type compatibility.
 *
 * DO NOT:
 * - Add @ts-nocheck (defeats the purpose)
 * - Add @ts-ignore or @ts-expect-error comments
 * - Try to "use" the variables
 * - Add eslint-disable comments (they're not needed)
 *
 * This file is:
 * - Excluded from main tsconfig.json to avoid unused variable errors
 * - Checked separately via scripts/tsconfig.api-check.json with noUnusedLocals: false
 * - Run by npm run lint:api-compat which is called during precommit checks
 */

import * as OurSqlite from "../src";

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

// Check that standalone backup function is exported
const _hasBackup: typeof OurSqlite.backup = OurSqlite.backup;

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

// Check constants exist - compile-time type checking for all 65 constants
function _checkConstants() {
  if (OurSqlite.constants) {
    // Database open flags (extension beyond node:sqlite)
    const _openReadonly: number = OurSqlite.constants.SQLITE_OPEN_READONLY;
    const _openReadwrite: number = OurSqlite.constants.SQLITE_OPEN_READWRITE;
    const _openCreate: number = OurSqlite.constants.SQLITE_OPEN_CREATE;
    const _openDeleteOnClose: number =
      OurSqlite.constants.SQLITE_OPEN_DELETEONCLOSE;
    const _openExclusive: number = OurSqlite.constants.SQLITE_OPEN_EXCLUSIVE;
    const _openAutoproxy: number = OurSqlite.constants.SQLITE_OPEN_AUTOPROXY;
    const _openUri: number = OurSqlite.constants.SQLITE_OPEN_URI;
    const _openMemory: number = OurSqlite.constants.SQLITE_OPEN_MEMORY;
    const _openMainDb: number = OurSqlite.constants.SQLITE_OPEN_MAIN_DB;
    const _openTempDb: number = OurSqlite.constants.SQLITE_OPEN_TEMP_DB;
    const _openTransientDb: number =
      OurSqlite.constants.SQLITE_OPEN_TRANSIENT_DB;
    const _openMainJournal: number =
      OurSqlite.constants.SQLITE_OPEN_MAIN_JOURNAL;
    const _openTempJournal: number =
      OurSqlite.constants.SQLITE_OPEN_TEMP_JOURNAL;
    const _openSubjournal: number = OurSqlite.constants.SQLITE_OPEN_SUBJOURNAL;
    const _openSuperJournal: number =
      OurSqlite.constants.SQLITE_OPEN_SUPER_JOURNAL;
    const _openNoMutex: number = OurSqlite.constants.SQLITE_OPEN_NOMUTEX;
    const _openFullMutex: number = OurSqlite.constants.SQLITE_OPEN_FULLMUTEX;
    const _openSharedCache: number =
      OurSqlite.constants.SQLITE_OPEN_SHAREDCACHE;
    const _openPrivateCache: number =
      OurSqlite.constants.SQLITE_OPEN_PRIVATECACHE;
    const _openWal: number = OurSqlite.constants.SQLITE_OPEN_WAL;

    // Changeset conflict resolution constants
    const _omit: number = OurSqlite.constants.SQLITE_CHANGESET_OMIT;
    const _replace: number = OurSqlite.constants.SQLITE_CHANGESET_REPLACE;
    const _abort: number = OurSqlite.constants.SQLITE_CHANGESET_ABORT;

    // Changeset conflict type constants
    const _data: number = OurSqlite.constants.SQLITE_CHANGESET_DATA;
    const _notfound: number = OurSqlite.constants.SQLITE_CHANGESET_NOTFOUND;
    const _conflict: number = OurSqlite.constants.SQLITE_CHANGESET_CONFLICT;
    const _constraint: number = OurSqlite.constants.SQLITE_CHANGESET_CONSTRAINT;
    const _foreignKey: number =
      OurSqlite.constants.SQLITE_CHANGESET_FOREIGN_KEY;

    // Authorization result codes
    const _ok: number = OurSqlite.constants.SQLITE_OK;
    const _deny: number = OurSqlite.constants.SQLITE_DENY;
    const _ignore: number = OurSqlite.constants.SQLITE_IGNORE;

    // Authorization action codes
    const _createIndex: number = OurSqlite.constants.SQLITE_CREATE_INDEX;
    const _createTable: number = OurSqlite.constants.SQLITE_CREATE_TABLE;
    const _createTempIndex: number =
      OurSqlite.constants.SQLITE_CREATE_TEMP_INDEX;
    const _createTempTable: number =
      OurSqlite.constants.SQLITE_CREATE_TEMP_TABLE;
    const _createTempTrigger: number =
      OurSqlite.constants.SQLITE_CREATE_TEMP_TRIGGER;
    const _createTempView: number = OurSqlite.constants.SQLITE_CREATE_TEMP_VIEW;
    const _createTrigger: number = OurSqlite.constants.SQLITE_CREATE_TRIGGER;
    const _createView: number = OurSqlite.constants.SQLITE_CREATE_VIEW;
    const _delete: number = OurSqlite.constants.SQLITE_DELETE;
    const _dropIndex: number = OurSqlite.constants.SQLITE_DROP_INDEX;
    const _dropTable: number = OurSqlite.constants.SQLITE_DROP_TABLE;
    const _dropTempIndex: number = OurSqlite.constants.SQLITE_DROP_TEMP_INDEX;
    const _dropTempTable: number = OurSqlite.constants.SQLITE_DROP_TEMP_TABLE;
    const _dropTempTrigger: number =
      OurSqlite.constants.SQLITE_DROP_TEMP_TRIGGER;
    const _dropTempView: number = OurSqlite.constants.SQLITE_DROP_TEMP_VIEW;
    const _dropTrigger: number = OurSqlite.constants.SQLITE_DROP_TRIGGER;
    const _dropView: number = OurSqlite.constants.SQLITE_DROP_VIEW;
    const _insert: number = OurSqlite.constants.SQLITE_INSERT;
    const _pragma: number = OurSqlite.constants.SQLITE_PRAGMA;
    const _read: number = OurSqlite.constants.SQLITE_READ;
    const _select: number = OurSqlite.constants.SQLITE_SELECT;
    const _transaction: number = OurSqlite.constants.SQLITE_TRANSACTION;
    const _update: number = OurSqlite.constants.SQLITE_UPDATE;
    const _attach: number = OurSqlite.constants.SQLITE_ATTACH;
    const _detach: number = OurSqlite.constants.SQLITE_DETACH;
    const _alterTable: number = OurSqlite.constants.SQLITE_ALTER_TABLE;
    const _reindex: number = OurSqlite.constants.SQLITE_REINDEX;
    const _analyze: number = OurSqlite.constants.SQLITE_ANALYZE;
    const _createVtable: number = OurSqlite.constants.SQLITE_CREATE_VTABLE;
    const _dropVtable: number = OurSqlite.constants.SQLITE_DROP_VTABLE;
    const _function: number = OurSqlite.constants.SQLITE_FUNCTION;
    const _savepoint: number = OurSqlite.constants.SQLITE_SAVEPOINT;
    const _copy: number = OurSqlite.constants.SQLITE_COPY;
    const _recursive: number = OurSqlite.constants.SQLITE_RECURSIVE;
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

// Check standalone backup function signature
function _checkBackupFunction() {
  // The standalone backup function should match node:sqlite's export
  const _backup: (
    sourceDb: InstanceType<typeof OurSqlite.DatabaseSync>,
    destination: string | Buffer | URL,
    options?: OurSqlite.BackupOptions,
  ) => Promise<number> = OurSqlite.backup;

  // Verify our BackupOptions type has the right shape
  const _opts: OurSqlite.BackupOptions = {
    rate: 100,
    source: "main",
    target: "main",
    progress: ({ totalPages, remainingPages }) => {
      const _t: number = totalPages;
      const _r: number = remainingPages;
    },
  };
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

  describe("constants compatibility with node:sqlite", () => {
    it("includes all node:sqlite constants", () => {
      const nodeKeys = Object.keys(NodeSqlite.constants);
      const ourKeys = new Set(Object.keys(OurSqlite.constants));

      const missingFromOurs = nodeKeys.filter((k) => !ourKeys.has(k));
      expect(missingFromOurs).toEqual([]);
    });

    it("has matching values for all node:sqlite constants", () => {
      const nodeConstants = NodeSqlite.constants as unknown as Record<
        string,
        number
      >;
      const ourConstants = OurSqlite.constants as unknown as Record<
        string,
        number
      >;

      for (const key of Object.keys(nodeConstants)) {
        expect(ourConstants[key]).toBe(nodeConstants[key]);
      }
    });

    it("documents extra constants beyond node:sqlite as SQLITE_OPEN_* flags", () => {
      const nodeKeys = new Set(Object.keys(NodeSqlite.constants));
      const ourKeys = Object.keys(OurSqlite.constants);
      const extras = ourKeys.filter((k) => !nodeKeys.has(k));

      // Our extensions should all be SQLITE_OPEN_* flags
      expect(extras.every((k) => k.startsWith("SQLITE_OPEN_"))).toBe(true);
      // We have 20 extra SQLITE_OPEN_* constants
      expect(extras.length).toBe(20);
    });

    it("exports exactly 65 constants total", () => {
      expect(Object.keys(OurSqlite.constants).length).toBe(65);
    });
  });

  describe("standalone backup() function compatibility", () => {
    it("exports backup as a function", () => {
      expect(typeof OurSqlite.backup).toBe("function");
    });

    it("backup has correct name property", () => {
      expect(OurSqlite.backup.name).toBe("backup");
    });

    it("backup has correct length property (2 parameters)", () => {
      expect(OurSqlite.backup.length).toBe(2);
    });

    it("backup matches node:sqlite export", () => {
      // Verify our backup function matches node:sqlite's backup
      expect(typeof NodeSqlite.backup).toBe("function");
      expect(OurSqlite.backup.name).toBe(NodeSqlite.backup.name);
      expect(OurSqlite.backup.length).toBe(NodeSqlite.backup.length);
    });
  });
});

export {}; // Make this a module
