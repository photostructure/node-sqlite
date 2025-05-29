import { DatabaseSync } from '../src';

describe('DatabaseSync Tests', () => {
  test('can create in-memory database', () => {
    const db = new DatabaseSync(':memory:');
    expect(db).toBeInstanceOf(DatabaseSync);
    expect(db.isOpen).toBe(true);
    expect(db.location).toBe(':memory:');
    db.close();
  });

  test('can execute DDL statements', () => {
    const db = new DatabaseSync(':memory:');
    
    expect(() => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
    }).not.toThrow();
    
    db.close();
  });

  test('can prepare and execute INSERT statement', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    
    const stmt = db.prepare('INSERT INTO test (value) VALUES (?)');
    expect(stmt).toBeDefined();
    expect(stmt.sourceSQL).toBe('INSERT INTO test (value) VALUES (?)');
    
    const result = stmt.run('test value');
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1);
    
    db.close();
  });

  test('can query data with SELECT', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec('CREATE TABLE test (id INTEGER, name TEXT)');
    db.exec("INSERT INTO test VALUES (1, 'Alice'), (2, 'Bob')");
    
    const stmt = db.prepare('SELECT * FROM test WHERE id = ?');
    const row = stmt.get(1);
    
    expect(row).toEqual({ id: 1, name: 'Alice' });
    
    db.close();
  });

  test('can query all rows', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec('CREATE TABLE test (id INTEGER, name TEXT)');
    db.exec("INSERT INTO test VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')");
    
    const stmt = db.prepare('SELECT * FROM test ORDER BY id');
    const rows = stmt.all();
    
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ id: 1, name: 'Alice' });
    expect(rows[1]).toEqual({ id: 2, name: 'Bob' });
    expect(rows[2]).toEqual({ id: 3, name: 'Charlie' });
    
    db.close();
  });

  test('handles different data types', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE types_test (
        int_col INTEGER,
        real_col REAL,
        text_col TEXT,
        blob_col BLOB
      )
    `);
    
    const stmt = db.prepare('INSERT INTO types_test VALUES (?, ?, ?, ?)');
    const buffer = Buffer.from('hello world', 'utf8');
    
    stmt.run(42, 3.14, 'test string', buffer);
    
    const selectStmt = db.prepare('SELECT * FROM types_test');
    const row = selectStmt.get();
    
    expect(row.int_col).toBe(42);
    expect(row.real_col).toBeCloseTo(3.14);
    expect(row.text_col).toBe('test string');
    expect(Buffer.isBuffer(row.blob_col)).toBe(true);
    expect(row.blob_col.toString('utf8')).toBe('hello world');
    
    db.close();
  });

  test('handles NULL values', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec('CREATE TABLE null_test (id INTEGER, value TEXT)');
    
    const stmt = db.prepare('INSERT INTO null_test VALUES (?, ?)');
    stmt.run(1, null);
    stmt.run(2, undefined);
    
    const selectStmt = db.prepare('SELECT * FROM null_test ORDER BY id');
    const rows = selectStmt.all();
    
    expect(rows[0]).toEqual({ id: 1, value: null });
    expect(rows[1]).toEqual({ id: 2, value: null });
    
    db.close();
  });

  test('can close and reopen database', () => {
    const db = new DatabaseSync(':memory:');
    
    expect(db.isOpen).toBe(true);
    
    db.close();
    expect(db.isOpen).toBe(false);
    
    // Note: Can't reopen in-memory DB, but this tests the state
  });

  test('throws error for invalid SQL', () => {
    const db = new DatabaseSync(':memory:');
    
    expect(() => {
      db.exec('INVALID SQL STATEMENT');
    }).toThrow();
    
    db.close();
  });

  test('property getters work correctly', () => {
    const db = new DatabaseSync(':memory:');
    
    expect(db.location).toBe(':memory:');
    expect(db.isOpen).toBe(true);
    expect(db.isTransaction).toBe(false);
    
    db.close();
    expect(db.isOpen).toBe(false);
  });
});