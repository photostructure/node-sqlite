/**
 * API Compatibility Type Tests
 *
 * This file uses TypeScript's type system to ensure our API is compatible with node:sqlite.
 * It uses two patterns for compile-time type checking:
 *
 * 1. **Type-level assertions**: `type _Check = Assert<Extends<ActualType, ExpectedType>>`
 *    These are pure type aliases that produce compile errors if types don't match.
 *    No runtime code is generated.
 *
 * 2. **`satisfies` operator**: `const x = { ... } satisfies SomeType`
 *    Verifies object literals are assignable to expected types.
 *
 * The runtime Jest tests at the bottom verify actual behavior (constants values, etc).
 *
 * @note This file requires Node.js 24+ where node:sqlite is available.
 */

import * as NodeSqlite from "node:sqlite";
import * as OurSqlite from "../src";

// =============================================================================
// TYPE ASSERTION HELPERS
// =============================================================================

/** Produces `true` if T extends U, otherwise `never` (causing a compile error in Assert) */
type Extends<T, U> = T extends U ? true : never;

/** Produces `true` only if X and Y are exactly equal types */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time assertion - produces T if T is true, otherwise compile error */
type Assert<T extends true> = T;

// Suppress unused type warnings - these are used for compile-time checks only
type _UseEquals = Equals<number, number>;

// =============================================================================
// TYPE ALIASES FOR CONVENIENCE
// =============================================================================

type DBSync = InstanceType<typeof OurSqlite.DatabaseSync>;
type StmtSync = InstanceType<typeof OurSqlite.StatementSync>;
type SQLStore = OurSqlite.SQLTagStoreInstance;
type SessionInst = InstanceType<typeof OurSqlite.Session>;

type ChangesResult = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};

// =============================================================================
// EXPORT CHECKS - Verify main classes and functions are exported
// =============================================================================

type _Export_DatabaseSync = Assert<
  Extends<typeof OurSqlite.DatabaseSync, new (...args: any[]) => any>
>;
type _Export_StatementSync = Assert<
  Extends<typeof OurSqlite.StatementSync, new (...args: any[]) => any>
>;
type _Export_backup = Assert<
  Extends<typeof OurSqlite.backup, (...args: any[]) => Promise<number>>
>;
type _Export_Session = Assert<
  Extends<typeof OurSqlite.Session, new (...args: any[]) => any>
>;

// =============================================================================
// DATABASE METHODS - Core API surface
// =============================================================================

type _DB_close = Assert<Extends<DBSync["close"], () => void>>;
type _DB_exec = Assert<Extends<DBSync["exec"], (sql: string) => void>>;
type _DB_prepare = Assert<Extends<DBSync["prepare"], (sql: string) => any>>;
type _DB_open = Assert<
  Extends<DBSync["open"], (config?: OurSqlite.DatabaseSyncOptions) => void>
>;

// User functions
type _DB_function = Assert<
  Extends<
    DBSync["function"],
    {
      (name: string, func: Function): void;
      (
        name: string,
        options: OurSqlite.UserFunctionOptions,
        func: Function,
      ): void;
    }
  >
>;
type _DB_aggregate = Assert<
  Extends<
    DBSync["aggregate"],
    (name: string, options: OurSqlite.AggregateOptions) => void
  >
>;

// Properties
type _DB_isOpen = Assert<Extends<DBSync["isOpen"], boolean>>;
type _DB_isTransaction = Assert<Extends<DBSync["isTransaction"], boolean>>;
type _DB_location = Assert<Extends<DBSync["location"], () => string | null>>;

// Session support
type _DB_createSession = Assert<
  Extends<
    DBSync["createSession"],
    (options?: OurSqlite.SessionOptions) => OurSqlite.Session
  >
>;
type _DB_applyChangeset = Assert<
  Extends<
    DBSync["applyChangeset"],
    (changeset: Buffer, options?: OurSqlite.ChangesetApplyOptions) => boolean
  >
>;

// Extension support
type _DB_enableLoadExtension = Assert<
  Extends<DBSync["enableLoadExtension"], (enable: boolean) => void>
>;
type _DB_loadExtension = Assert<
  Extends<DBSync["loadExtension"], (path: string, entryPoint?: string) => void>
>;
type _DB_enableDefensive = Assert<
  Extends<DBSync["enableDefensive"], (active: boolean) => void>
>;

// Authorizer support (node:sqlite v24.10.0+)
type _DB_setAuthorizer = Assert<
  Extends<
    DBSync["setAuthorizer"],
    (
      callback:
        | ((
            actionCode: number,
            param1: string | null,
            param2: string | null,
            param3: string | null,
            param4: string | null,
          ) => number)
        | null,
    ) => void
  >
>;

// SQLTagStore support (node:sqlite v24.9.0+)
type _DB_createTagStore = Assert<
  Extends<
    DBSync["createTagStore"],
    (capacity?: number) => OurSqlite.SQLTagStoreInstance
  >
>;

// =============================================================================
// STATEMENT METHODS
// =============================================================================

type _Stmt_run = Assert<
  Extends<StmtSync["run"], (...params: any[]) => ChangesResult>
>;
type _Stmt_get = Assert<Extends<StmtSync["get"], (...params: any[]) => any>>;
type _Stmt_all = Assert<Extends<StmtSync["all"], (...params: any[]) => any[]>>;
type _Stmt_iterate = Assert<
  Extends<StmtSync["iterate"], (...params: any[]) => IterableIterator<any>>
>;

// Properties
type _Stmt_sourceSQL = Assert<Extends<StmtSync["sourceSQL"], string>>;
type _Stmt_expandedSQL = Assert<
  Extends<StmtSync["expandedSQL"], string | undefined>
>;

// Configuration methods
type _Stmt_setReadBigInts = Assert<
  Extends<StmtSync["setReadBigInts"], (readBigInts: boolean) => void>
>;
type _Stmt_setAllowBareNamedParameters = Assert<
  Extends<StmtSync["setAllowBareNamedParameters"], (allow: boolean) => void>
>;
type _Stmt_setAllowUnknownNamedParameters = Assert<
  Extends<
    StmtSync["setAllowUnknownNamedParameters"],
    (enabled: boolean) => void
  >
>;
type _Stmt_setReturnArrays = Assert<
  Extends<StmtSync["setReturnArrays"], (returnArrays: boolean) => void>
>;

// Column metadata
type _Stmt_columns = Assert<
  Extends<StmtSync["columns"], () => OurSqlite.StatementColumnMetadata[]>
>;

// =============================================================================
// SQL TAG STORE METHODS
// =============================================================================

type _SQL_db = Assert<Extends<SQLStore["db"], OurSqlite.DatabaseSyncInstance>>;
type _SQL_capacity = Assert<Extends<SQLStore["capacity"], number>>;
type _SQL_size = Assert<Extends<SQLStore["size"], number>>;
type _SQL_clear = Assert<Extends<SQLStore["clear"], () => void>>;
type _SQL_run = Assert<
  Extends<
    SQLStore["run"],
    (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => { changes: number; lastInsertRowid: number | bigint }
  >
>;
type _SQL_get = Assert<
  Extends<
    SQLStore["get"],
    (strings: TemplateStringsArray, ...values: unknown[]) => unknown
  >
>;
type _SQL_all = Assert<
  Extends<
    SQLStore["all"],
    (strings: TemplateStringsArray, ...values: unknown[]) => unknown[]
  >
>;
type _SQL_iterate = Assert<
  Extends<
    SQLStore["iterate"],
    (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => IterableIterator<unknown>
  >
>;

// =============================================================================
// SESSION CLASS
// =============================================================================

type _Session_changeset = Assert<
  Extends<SessionInst["changeset"], () => Uint8Array>
>;
type _Session_patchset = Assert<
  Extends<SessionInst["patchset"], () => Uint8Array>
>;
type _Session_close = Assert<Extends<SessionInst["close"], () => void>>;

// =============================================================================
// BACKUP FUNCTION SIGNATURE
// =============================================================================

type _Backup_signature = Assert<
  Extends<
    typeof OurSqlite.backup,
    (
      sourceDb: DBSync,
      destination: string | Buffer | URL,
      options?: OurSqlite.BackupOptions,
    ) => Promise<number>
  >
>;

// =============================================================================
// OBJECT LITERAL CHECKS - Using satisfies
// =============================================================================

// Database options
const _databaseOptions = {
  location: ":memory:",
  readOnly: false,
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: true,
  timeout: 5000,
  allowExtension: false,
} satisfies OurSqlite.DatabaseSyncOptions;

// Aggregate options (with all fields)
const _aggregateOptions = {
  start: 0,
  step: (acc: number, value: number) => acc + value,
  inverse: (acc: number, value: number) => acc - value,
  result: (acc: number) => acc,
  deterministic: true,
  directOnly: false,
  useBigIntArguments: false,
  varargs: false,
} satisfies OurSqlite.AggregateOptions;

// Backup options
const _backupOptions = {
  rate: 100,
  source: "main",
  target: "main",
  progress: ({ totalPages, remainingPages }) => {
    void totalPages;
    void remainingPages;
  },
} satisfies OurSqlite.BackupOptions;

// Statement column metadata (with values)
const _columnMetadata = {
  column: "id",
  database: "main",
  name: "id",
  table: "users",
  type: "INTEGER",
} satisfies OurSqlite.StatementColumnMetadata;

// Statement column metadata (with nulls for expressions)
const _columnMetadataNull = {
  column: null,
  database: null,
  name: "expr",
  table: null,
  type: null,
} satisfies OurSqlite.StatementColumnMetadata;

// =============================================================================
// TYPE COMPATIBILITY CHECKS
// =============================================================================

// SQL value types compatibility
type _NodeSQLInput = NodeSqlite.SQLInputValue;
type _NodeSQLOutput = NodeSqlite.SQLOutputValue;
type _OurInputTypes = null | number | bigint | string | Buffer | Uint8Array;
type _OurOutputTypes = null | number | bigint | string | Uint8Array;

// StatementResultingChanges shape compatibility
type _NodeChangesResult = NodeSqlite.StatementResultingChanges;
type _ChangesShapeOK = Assert<Extends<ChangesResult, _NodeChangesResult>>;

// =============================================================================
// CONSTANTS TYPE CHECKS - Verify all 65 constants exist with correct types
// =============================================================================

type Constants = typeof OurSqlite.constants;

// Database open flags (our extension beyond node:sqlite - 20 flags)
type _C_OPEN_READONLY = Assert<
  Extends<Constants["SQLITE_OPEN_READONLY"], number>
>;
type _C_OPEN_READWRITE = Assert<
  Extends<Constants["SQLITE_OPEN_READWRITE"], number>
>;
type _C_OPEN_CREATE = Assert<Extends<Constants["SQLITE_OPEN_CREATE"], number>>;
type _C_OPEN_DELETEONCLOSE = Assert<
  Extends<Constants["SQLITE_OPEN_DELETEONCLOSE"], number>
>;
type _C_OPEN_EXCLUSIVE = Assert<
  Extends<Constants["SQLITE_OPEN_EXCLUSIVE"], number>
>;
type _C_OPEN_AUTOPROXY = Assert<
  Extends<Constants["SQLITE_OPEN_AUTOPROXY"], number>
>;
type _C_OPEN_URI = Assert<Extends<Constants["SQLITE_OPEN_URI"], number>>;
type _C_OPEN_MEMORY = Assert<Extends<Constants["SQLITE_OPEN_MEMORY"], number>>;
type _C_OPEN_MAIN_DB = Assert<
  Extends<Constants["SQLITE_OPEN_MAIN_DB"], number>
>;
type _C_OPEN_TEMP_DB = Assert<
  Extends<Constants["SQLITE_OPEN_TEMP_DB"], number>
>;
type _C_OPEN_TRANSIENT_DB = Assert<
  Extends<Constants["SQLITE_OPEN_TRANSIENT_DB"], number>
>;
type _C_OPEN_MAIN_JOURNAL = Assert<
  Extends<Constants["SQLITE_OPEN_MAIN_JOURNAL"], number>
>;
type _C_OPEN_TEMP_JOURNAL = Assert<
  Extends<Constants["SQLITE_OPEN_TEMP_JOURNAL"], number>
>;
type _C_OPEN_SUBJOURNAL = Assert<
  Extends<Constants["SQLITE_OPEN_SUBJOURNAL"], number>
>;
type _C_OPEN_SUPER_JOURNAL = Assert<
  Extends<Constants["SQLITE_OPEN_SUPER_JOURNAL"], number>
>;
type _C_OPEN_NOMUTEX = Assert<
  Extends<Constants["SQLITE_OPEN_NOMUTEX"], number>
>;
type _C_OPEN_FULLMUTEX = Assert<
  Extends<Constants["SQLITE_OPEN_FULLMUTEX"], number>
>;
type _C_OPEN_SHAREDCACHE = Assert<
  Extends<Constants["SQLITE_OPEN_SHAREDCACHE"], number>
>;
type _C_OPEN_PRIVATECACHE = Assert<
  Extends<Constants["SQLITE_OPEN_PRIVATECACHE"], number>
>;
type _C_OPEN_WAL = Assert<Extends<Constants["SQLITE_OPEN_WAL"], number>>;

// Changeset conflict resolution constants
type _C_CHANGESET_OMIT = Assert<
  Extends<Constants["SQLITE_CHANGESET_OMIT"], number>
>;
type _C_CHANGESET_REPLACE = Assert<
  Extends<Constants["SQLITE_CHANGESET_REPLACE"], number>
>;
type _C_CHANGESET_ABORT = Assert<
  Extends<Constants["SQLITE_CHANGESET_ABORT"], number>
>;

// Changeset conflict type constants
type _C_CHANGESET_DATA = Assert<
  Extends<Constants["SQLITE_CHANGESET_DATA"], number>
>;
type _C_CHANGESET_NOTFOUND = Assert<
  Extends<Constants["SQLITE_CHANGESET_NOTFOUND"], number>
>;
type _C_CHANGESET_CONFLICT = Assert<
  Extends<Constants["SQLITE_CHANGESET_CONFLICT"], number>
>;
type _C_CHANGESET_CONSTRAINT = Assert<
  Extends<Constants["SQLITE_CHANGESET_CONSTRAINT"], number>
>;
type _C_CHANGESET_FOREIGN_KEY = Assert<
  Extends<Constants["SQLITE_CHANGESET_FOREIGN_KEY"], number>
>;

// Authorization result codes
type _C_OK = Assert<Extends<Constants["SQLITE_OK"], number>>;
type _C_DENY = Assert<Extends<Constants["SQLITE_DENY"], number>>;
type _C_IGNORE = Assert<Extends<Constants["SQLITE_IGNORE"], number>>;

// Authorization action codes (31 codes)
type _C_CREATE_INDEX = Assert<
  Extends<Constants["SQLITE_CREATE_INDEX"], number>
>;
type _C_CREATE_TABLE = Assert<
  Extends<Constants["SQLITE_CREATE_TABLE"], number>
>;
type _C_CREATE_TEMP_INDEX = Assert<
  Extends<Constants["SQLITE_CREATE_TEMP_INDEX"], number>
>;
type _C_CREATE_TEMP_TABLE = Assert<
  Extends<Constants["SQLITE_CREATE_TEMP_TABLE"], number>
>;
type _C_CREATE_TEMP_TRIGGER = Assert<
  Extends<Constants["SQLITE_CREATE_TEMP_TRIGGER"], number>
>;
type _C_CREATE_TEMP_VIEW = Assert<
  Extends<Constants["SQLITE_CREATE_TEMP_VIEW"], number>
>;
type _C_CREATE_TRIGGER = Assert<
  Extends<Constants["SQLITE_CREATE_TRIGGER"], number>
>;
type _C_CREATE_VIEW = Assert<Extends<Constants["SQLITE_CREATE_VIEW"], number>>;
type _C_DELETE = Assert<Extends<Constants["SQLITE_DELETE"], number>>;
type _C_DROP_INDEX = Assert<Extends<Constants["SQLITE_DROP_INDEX"], number>>;
type _C_DROP_TABLE = Assert<Extends<Constants["SQLITE_DROP_TABLE"], number>>;
type _C_DROP_TEMP_INDEX = Assert<
  Extends<Constants["SQLITE_DROP_TEMP_INDEX"], number>
>;
type _C_DROP_TEMP_TABLE = Assert<
  Extends<Constants["SQLITE_DROP_TEMP_TABLE"], number>
>;
type _C_DROP_TEMP_TRIGGER = Assert<
  Extends<Constants["SQLITE_DROP_TEMP_TRIGGER"], number>
>;
type _C_DROP_TEMP_VIEW = Assert<
  Extends<Constants["SQLITE_DROP_TEMP_VIEW"], number>
>;
type _C_DROP_TRIGGER = Assert<
  Extends<Constants["SQLITE_DROP_TRIGGER"], number>
>;
type _C_DROP_VIEW = Assert<Extends<Constants["SQLITE_DROP_VIEW"], number>>;
type _C_INSERT = Assert<Extends<Constants["SQLITE_INSERT"], number>>;
type _C_PRAGMA = Assert<Extends<Constants["SQLITE_PRAGMA"], number>>;
type _C_READ = Assert<Extends<Constants["SQLITE_READ"], number>>;
type _C_SELECT = Assert<Extends<Constants["SQLITE_SELECT"], number>>;
type _C_TRANSACTION = Assert<Extends<Constants["SQLITE_TRANSACTION"], number>>;
type _C_UPDATE = Assert<Extends<Constants["SQLITE_UPDATE"], number>>;
type _C_ATTACH = Assert<Extends<Constants["SQLITE_ATTACH"], number>>;
type _C_DETACH = Assert<Extends<Constants["SQLITE_DETACH"], number>>;
type _C_ALTER_TABLE = Assert<Extends<Constants["SQLITE_ALTER_TABLE"], number>>;
type _C_REINDEX = Assert<Extends<Constants["SQLITE_REINDEX"], number>>;
type _C_ANALYZE = Assert<Extends<Constants["SQLITE_ANALYZE"], number>>;
type _C_CREATE_VTABLE = Assert<
  Extends<Constants["SQLITE_CREATE_VTABLE"], number>
>;
type _C_DROP_VTABLE = Assert<Extends<Constants["SQLITE_DROP_VTABLE"], number>>;
type _C_FUNCTION = Assert<Extends<Constants["SQLITE_FUNCTION"], number>>;
type _C_SAVEPOINT = Assert<Extends<Constants["SQLITE_SAVEPOINT"], number>>;
type _C_COPY = Assert<Extends<Constants["SQLITE_COPY"], number>>;
type _C_RECURSIVE = Assert<Extends<Constants["SQLITE_RECURSIVE"], number>>;

// =============================================================================
// RUNTIME TESTS - Verify actual behavior
// =============================================================================

describe("API Compatibility", () => {
  it("type checks pass at compile time", () => {
    // This test file is primarily for TypeScript compile-time checks
    // If this file compiles, all type assertions above have passed
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
      expect(typeof NodeSqlite.backup).toBe("function");
      expect(OurSqlite.backup.name).toBe(NodeSqlite.backup.name);
      expect(OurSqlite.backup.length).toBe(NodeSqlite.backup.length);
    });
  });
});

// Suppress unused variable warnings for satisfies checks
void _databaseOptions;
void _aggregateOptions;
void _backupOptions;
void _columnMetadata;
void _columnMetadataNull;

export {}; // Make this a module
