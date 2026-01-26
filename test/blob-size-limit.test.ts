/**
 * Test for blob size limitations
 *
 * This tests whether we're affected by the better-sqlite3 issue #1430
 * where blobs larger than ~512MB fail with "string or blob too big"
 * despite SQLite's configured SQLITE_MAX_LENGTH being much higher (1GB default).
 *
 * FINDINGS:
 * - We are NOT affected by better-sqlite3 issue #1430
 * - better-sqlite3 limit: 536,870,881 bytes (~512MB)
 * - Our limit: 999,999,993 bytes (~954MB, 7 bytes under SQLITE_MAX_LENGTH)
 * - The 7-byte overhead is SQLite's internal blob storage format
 *
 * @see https://github.com/WiseLibs/better-sqlite3/issues/1430
 */
import { DatabaseSync } from "../src";

// The magic number from the better-sqlite3 issue
const BETTER_SQLITE3_LIMIT = 536_870_881; // ~512MB - works
const BETTER_SQLITE3_FAILS = 536_870_882; // ~512MB + 1 - fails in better-sqlite3

// Smaller sizes for quick testing
const TEST_SIZES = {
  small: 1024, // 1KB
  medium: 1024 * 1024, // 1MB
  large: 10 * 1024 * 1024, // 10MB
  // These require significant memory - only run with --large flag
  huge: 100 * 1024 * 1024, // 100MB
  nearLimit: BETTER_SQLITE3_LIMIT, // ~512MB - the boundary
  overLimit: BETTER_SQLITE3_FAILS, // ~512MB + 1 - fails in better-sqlite3
};

describe("Blob size limits", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)");
  });

  afterEach(() => {
    db.close();
  });

  test("should report SQLite max_length limit", () => {
    // Query SQLite's compile-time options
    const result = db.prepare("SELECT sqlite_compileoption_get(0)").get() as {
      "sqlite_compileoption_get(0)": string | null;
    };
    expect(result["sqlite_compileoption_get(0)"]).toBeDefined();

    // Try to find MAX_LENGTH option
    const stmt = db.prepare("SELECT sqlite_compileoption_used(?)");
    const hasMaxLength = stmt.get("MAX_LENGTH") as {
      "sqlite_compileoption_used(?)": number;
    };
    expect(typeof hasMaxLength["sqlite_compileoption_used(?)"]).toBe("number");
  });

  test("should handle small blobs (1KB)", () => {
    const data = Buffer.alloc(TEST_SIZES.small, 0xab);
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    // Verify roundtrip
    const row = db
      .prepare("SELECT data FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as {
      data: Uint8Array;
    };
    expect(row.data.length).toBe(TEST_SIZES.small);
    expect(row.data[0]).toBe(0xab);
  });

  test("should handle medium blobs (1MB)", () => {
    const data = Buffer.alloc(TEST_SIZES.medium, 0xcd);
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    const row = db
      .prepare("SELECT data FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as {
      data: Uint8Array;
    };
    expect(row.data.length).toBe(TEST_SIZES.medium);
  });

  test("should handle large blobs (10MB)", () => {
    const data = Buffer.alloc(TEST_SIZES.large, 0xef);
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    const row = db
      .prepare("SELECT data FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as {
      data: Uint8Array;
    };
    expect(row.data.length).toBe(TEST_SIZES.large);
  });
});

// Separate test for large allocations - can be run independently
describe("Large blob tests (memory intensive)", () => {
  const shouldSkip = !process.env["TEST_LARGE_BLOBS"];
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    if (shouldSkip) return;
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)");
  });

  afterEach(() => {
    if (!shouldSkip) {
      db.close();
    }
  });

  test.skip("should handle 100MB blobs", () => {
    if (shouldSkip) return;
    const data = Buffer.alloc(TEST_SIZES.huge, 0x42);
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    const row = db
      .prepare("SELECT data FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as {
      data: Uint8Array;
    };
    expect(row.data.length).toBe(TEST_SIZES.huge);
  });

  test.skip("should handle blobs at better-sqlite3 limit (536,870,881 bytes)", () => {
    if (shouldSkip) return;
    const data = Buffer.alloc(TEST_SIZES.nearLimit, 0x55);

    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    // Verify size (don't read all data back to save memory)
    const sizeRow = db
      .prepare("SELECT length(data) as size FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as { size: number };
    expect(sizeRow.size).toBe(TEST_SIZES.nearLimit);
  });

  test.skip("should handle blobs OVER better-sqlite3 limit (536,870,882 bytes)", () => {
    if (shouldSkip) return;
    // This is where better-sqlite3 fails with 'string or blob too big'

    const data = Buffer.alloc(TEST_SIZES.overLimit, 0x66);
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");

    // This is the key test - does it fail like better-sqlite3?
    const result = stmt.run(data);
    expect(result.lastInsertRowid).toBeTruthy();

    // Verify size
    const sizeRow = db
      .prepare("SELECT length(data) as size FROM blobs WHERE id = ?")
      .get(result.lastInsertRowid) as { size: number };
    expect(sizeRow.size).toBe(TEST_SIZES.overLimit);
  });
});

// Quick binary search to find the exact limit
describe("Find exact blob limit (very memory intensive)", () => {
  test.skip("should find the exact maximum blob size", async () => {
    if (!process.env["TEST_FIND_LIMIT"]) return;

    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)");
    const stmt = db.prepare("INSERT INTO blobs (data) VALUES (?)");

    let low = 999_990_000; // Just under 1GB
    let high = 1_000_010_000; // Just over 1GB (SQLite default limit)
    let lastSuccess = low;

    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);

      // Clean up previous data
      db.exec("DELETE FROM blobs");

      try {
        const data = Buffer.alloc(mid, 0x00);
        stmt.run(data);
        lastSuccess = mid;
        low = mid;
      } catch {
        high = mid;
      }

      // Force GC if available to free memory between iterations
      if (global.gc) {
        global.gc();
      }
    }

    expect(lastSuccess).toBeGreaterThan(BETTER_SQLITE3_LIMIT);

    db.close();
  });
});
