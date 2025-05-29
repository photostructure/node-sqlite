/**
 * @photostructure/sqlite - Node.js SQLite implementation extracted from Node.js core
 */

// Load the native binding
const binding = require('node-gyp-build')(require('path').join(__dirname, '..'));

export interface DatabaseOpenConfiguration {
  readonly location: string;
  readonly readOnly?: boolean;
  readonly enableForeignKeys?: boolean;
  readonly enableDoubleQuotedStringLiterals?: boolean;
  readonly timeout?: number;
}

export interface StatementOptions {
  readonly expandedSQL?: boolean;
  readonly anonymousParameters?: boolean;
}

export interface PreparedStatement {
  readonly sourceSQL: string;
  readonly expandedSQL: string | undefined;
  run(...parameters: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...parameters: any[]): any;
  all(...parameters: any[]): any[];
  iterate(...parameters: any[]): IterableIterator<any>;
  setReadBigInts(readBigInts: boolean): void;
  setAllowBareNamedParameters(allowBareNamedParameters: boolean): void;
  finalize(): void;
  [Symbol.dispose](): void;
}

export interface Database {
  readonly location: string;
  readonly isOpen: boolean;
  readonly isTransaction: boolean;
  
  open(configuration?: DatabaseOpenConfiguration): void;
  close(): void;
  prepare(sql: string, options?: StatementOptions): PreparedStatement;
  exec(sql: string): void;
  function(name: string, options: any, func: Function): void;
  aggregate(name: string, options: any, funcs: any): void;
  createSession(table?: string): any;
  applyChangeset(changeset: Uint8Array, options?: any): void;
  enableLoadExtension(enable: boolean): void;
  loadExtension(path: string, entryPoint?: string): void;
  
  [Symbol.dispose](): void;
}

export interface SqliteModule {
  DatabaseSync: new (location?: string, options?: DatabaseOpenConfiguration) => Database;
  StatementSync: new (database: Database, sql: string, options?: StatementOptions) => PreparedStatement;
  constants: {
    SQLITE_OPEN_READONLY: number;
    SQLITE_OPEN_READWRITE: number;
    SQLITE_OPEN_CREATE: number;
    // ... more constants
  };
  backup(source: Database, destination: Database, sourceDb?: string, destinationDb?: string): Promise<void>;
}

// Add Symbol.dispose to the native classes
if (binding.DatabaseSync && typeof Symbol.dispose !== 'undefined') {
  binding.DatabaseSync.prototype[Symbol.dispose] = function() {
    try {
      this.close();
    } catch {
      // Ignore errors during disposal
    }
  };
}

if (binding.StatementSync && typeof Symbol.dispose !== 'undefined') {
  binding.StatementSync.prototype[Symbol.dispose] = function() {
    try {
      this.finalize();
    } catch {
      // Ignore errors during disposal
    }
  };
}

// Export the native binding with TypeScript types
export const DatabaseSync = binding.DatabaseSync as SqliteModule['DatabaseSync'];
export const StatementSync = binding.StatementSync as SqliteModule['StatementSync'];
export const constants = binding.constants as SqliteModule['constants'];
export const backup = binding.backup as SqliteModule['backup'];

// Default export for CommonJS compatibility
export default binding as SqliteModule;