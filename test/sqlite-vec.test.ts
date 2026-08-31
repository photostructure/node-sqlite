/**
 * Integration tests for @photostructure/sqlite-vec extension
 *
 * These tests validate that sqlite-vec can be loaded as an extension
 * and that vec0 virtual tables and vector functions work correctly.
 */
import { DatabaseSync } from "../src";
import { useTempDir } from "./test-utils";

// Try to load sqlite-vec and get the extension path
let sqliteVecPath: string | undefined;
let sqliteVecLoadError: string | undefined;

try {
  const sqliteVec = require("@photostructure/sqlite-vec");
  sqliteVecPath = sqliteVec.getLoadablePath();
} catch (error: any) {
  sqliteVecLoadError = `Failed to load @photostructure/sqlite-vec: ${error.message}`;
}

// Log status at module load time
if (sqliteVecLoadError) {
  console.warn(sqliteVecLoadError);
  console.warn("sqlite-vec tests will be skipped on this platform");
}

// Conditional describe for tests requiring sqlite-vec
const describeWithSqliteVec = sqliteVecPath ? describe : describe.skip;

describeWithSqliteVec("sqlite-vec Integration Tests", () => {
  const { getDbPath, closeDatabases } = useTempDir("sqlite-vec-test-");

  // node:sqlite binds JavaScript Number values as REAL. vec0 requires INTEGER
  // primary keys, so rowid and integer-metadata bindings use BigInt below.

  // Helper to create a database with extension loading enabled and sqlite-vec loaded
  function createVecDb(dbPath?: string): InstanceType<typeof DatabaseSync> {
    const db = new DatabaseSync(dbPath ?? ":memory:", { allowExtension: true });
    db.enableLoadExtension(true);
    db.loadExtension(sqliteVecPath!);
    db.enableLoadExtension(false); // Disable after loading for security
    return db;
  }

  describe("extension loading", () => {
    test("can load sqlite-vec extension", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      expect(() => {
        db.loadExtension(sqliteVecPath!);
      }).not.toThrow();

      db.close();
    });

    test("vec_version() returns version string", () => {
      const db = createVecDb();

      const result = db.prepare("SELECT vec_version() as version").get() as {
        version: string;
      };
      // Version string may have 'v' prefix (e.g., "v0.3.2")
      expect(result.version).toMatch(/^v?\d+\.\d+\.\d+/);

      db.close();
    });

    test("extension persists after disabling extension loading", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVecPath!);
      db.enableLoadExtension(false);

      // vec functions should still work
      const result = db.prepare("SELECT vec_version() as version").get() as {
        version: string;
      };
      // Version string may have 'v' prefix (e.g., "v0.3.2")
      expect(result.version).toMatch(/^v?\d+\.\d+\.\d+/);

      db.close();
    });
  });

  describe("vec0 virtual table", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = createVecDb();
    });

    afterEach(() => {
      closeDatabases(db);
    });

    test("can create vec0 virtual table", () => {
      expect(() => {
        db.exec("CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[4])");
      }).not.toThrow();

      // Verify table exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='test_vec'",
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    test("can create vec0 table with multiple vector columns", () => {
      expect(() => {
        db.exec(`
          CREATE VIRTUAL TABLE multi_vec USING vec0(
            title_embedding float[128],
            content_embedding float[256]
          )
        `);
      }).not.toThrow();
    });

    test("can create vec0 table with int8 quantization", () => {
      expect(() => {
        db.exec(
          "CREATE VIRTUAL TABLE quantized_vec USING vec0(embedding int8[4])",
        );
      }).not.toThrow();
    });
  });

  describe("vector insertion", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = createVecDb();
      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");
    });

    afterEach(() => {
      closeDatabases(db);
    });

    test("can insert vector using Float32Array", () => {
      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );

      expect(() => {
        stmt.run(1n, new Float32Array([0.1, 0.2, 0.3, 0.4]));
      }).not.toThrow();

      const count = db.prepare("SELECT COUNT(*) as cnt FROM items").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });

    test("can insert multiple vectors", () => {
      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );

      const vectors = [
        [1, new Float32Array([0.1, 0.1, 0.1, 0.1])],
        [2, new Float32Array([0.2, 0.2, 0.2, 0.2])],
        [3, new Float32Array([0.3, 0.3, 0.3, 0.3])],
        [4, new Float32Array([0.4, 0.4, 0.4, 0.4])],
        [5, new Float32Array([0.5, 0.5, 0.5, 0.5])],
      ] as const;

      for (const [id, vec] of vectors) {
        stmt.run(BigInt(id), vec);
      }

      const count = db.prepare("SELECT COUNT(*) as cnt FROM items").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(5);
    });

    test("can insert vector using Buffer", () => {
      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );

      // Create buffer from Float32Array
      const floats = new Float32Array([0.5, 0.6, 0.7, 0.8]);
      const buffer = Buffer.from(floats.buffer);

      expect(() => {
        stmt.run(1n, buffer);
      }).not.toThrow();

      const count = db.prepare("SELECT COUNT(*) as cnt FROM items").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });
  });

  describe("vector queries", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = createVecDb();
      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");

      // Insert test data
      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );
      const vectors = [
        [1, new Float32Array([0.1, 0.1, 0.1, 0.1])],
        [2, new Float32Array([0.2, 0.2, 0.2, 0.2])],
        [3, new Float32Array([0.3, 0.3, 0.3, 0.3])],
        [4, new Float32Array([0.4, 0.4, 0.4, 0.4])],
        [5, new Float32Array([0.5, 0.5, 0.5, 0.5])],
      ] as const;

      for (const [id, vec] of vectors) {
        stmt.run(BigInt(id), vec);
      }
    });

    afterEach(() => {
      closeDatabases(db);
    });

    test("can query vectors with MATCH", () => {
      const query = new Float32Array([0.3, 0.3, 0.3, 0.3]);

      const results = db
        .prepare(
          `
          SELECT rowid, distance
          FROM items
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT 3
        `,
        )
        .all(query) as Array<{ rowid: bigint; distance: number }>;

      expect(results).toHaveLength(3);
      // First result should be the exact match (rowid 3)
      // rowid may be number or bigint depending on SQLite/extension behavior
      expect(results[0]).toBeDefined();
      expect(Number(results[0]!.rowid)).toBe(3);
      expect(results[0]!.distance).toBeCloseTo(0, 5);
    });

    test("returns correct k nearest neighbors", () => {
      const query = new Float32Array([0.25, 0.25, 0.25, 0.25]);

      const results = db
        .prepare(
          `
          SELECT rowid, distance
          FROM items
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT 2
        `,
        )
        .all(query) as Array<{ rowid: bigint; distance: number }>;

      expect(results).toHaveLength(2);
      // Closest should be rowid 2 or 3 (equidistant from query)
      // rowid may be number or bigint depending on SQLite/extension behavior
      expect(results[0]).toBeDefined();
      expect([2, 3]).toContain(Number(results[0]!.rowid));
    });

    test("distance values are numeric", () => {
      const query = new Float32Array([0.0, 0.0, 0.0, 0.0]);

      const results = db
        .prepare(
          `
          SELECT rowid, distance
          FROM items
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT 5
        `,
        )
        .all(query) as Array<{ rowid: bigint; distance: number }>;

      for (const result of results) {
        expect(typeof result.distance).toBe("number");
        expect(result.distance).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("vector utility functions", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = createVecDb();
    });

    afterEach(() => {
      closeDatabases(db);
    });

    test("vec_length() returns vector dimension", () => {
      const vec = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      const result = db.prepare("SELECT vec_length(?) as len").get(vec) as {
        len: number;
      };
      expect(result.len).toBe(4);
    });

    test("vec_distance_L2() computes Euclidean distance", () => {
      const vec1 = new Float32Array([0.0, 0.0, 0.0, 0.0]);
      const vec2 = new Float32Array([1.0, 0.0, 0.0, 0.0]);

      const result = db
        .prepare("SELECT vec_distance_L2(?, ?) as dist")
        .get(vec1, vec2) as { dist: number };
      expect(result.dist).toBeCloseTo(1.0, 5);
    });

    test("vec_distance_cosine() computes cosine distance", () => {
      const vec1 = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      const vec2 = new Float32Array([1.0, 0.0, 0.0, 0.0]);

      const result = db
        .prepare("SELECT vec_distance_cosine(?, ?) as dist")
        .get(vec1, vec2) as { dist: number };
      // Same vectors should have cosine distance of 0
      expect(result.dist).toBeCloseTo(0.0, 5);
    });

    test("vec_normalize() normalizes vector", () => {
      const vec = new Float32Array([3.0, 4.0, 0.0, 0.0]); // 3-4-5 triangle
      const zeroVec = new Float32Array([0.0, 0.0, 0.0, 0.0]);

      // vec_length returns dimension count, not magnitude
      // Use L2 distance from zero vector to verify magnitude is 1
      const result = db
        .prepare("SELECT vec_distance_L2(vec_normalize(?), ?) as dist")
        .get(vec, zeroVec) as { dist: number };
      // Normalized vector should have L2 distance of 1 from origin
      expect(result.dist).toBeCloseTo(1.0, 5);
    });

    test("vec_add() adds vectors", () => {
      const vec1 = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      const vec2 = new Float32Array([1.0, 1.0, 1.0, 1.0]);

      // Get raw result as blob and convert back to Float32Array
      const result = db.prepare("SELECT vec_add(?, ?) as sum").get(vec1, vec2);
      expect(result).toBeDefined();
    });

    test("vec_sub() subtracts vectors", () => {
      const vec1 = new Float32Array([5.0, 5.0, 5.0, 5.0]);
      const vec2 = new Float32Array([1.0, 2.0, 3.0, 4.0]);

      const result = db.prepare("SELECT vec_sub(?, ?) as diff").get(vec1, vec2);
      expect(result).toBeDefined();
    });
  });

  describe("file-based database", () => {
    let db: InstanceType<typeof DatabaseSync> | undefined;

    afterEach(() => {
      closeDatabases(db);
      db = undefined;
    });

    test("vec0 table persists in file-based database", () => {
      const dbPath = getDbPath("vec-persist.db");

      // Create database and insert data
      db = new DatabaseSync(dbPath, { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVecPath!);
      db.enableLoadExtension(false);

      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");
      db.prepare("INSERT INTO items(rowid, embedding) VALUES (?, ?)").run(
        1n,
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
      );
      db.close();
      db = undefined;

      // Reopen and verify data (need to reload extension)
      db = new DatabaseSync(dbPath, { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVecPath!);
      db.enableLoadExtension(false);

      const count = db.prepare("SELECT COUNT(*) as cnt FROM items").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });

    test("vec0 query works after database reopen", () => {
      const dbPath = getDbPath("vec-reopen.db");

      // Create and populate
      db = new DatabaseSync(dbPath, { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVecPath!);

      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");

      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );
      stmt.run(1n, new Float32Array([0.1, 0.1, 0.1, 0.1]));
      stmt.run(2n, new Float32Array([0.9, 0.9, 0.9, 0.9]));
      db.close();
      db = undefined;

      // Reopen and query
      db = new DatabaseSync(dbPath, { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVecPath!);

      const query = new Float32Array([0.1, 0.1, 0.1, 0.1]);
      const results = db
        .prepare(
          `
          SELECT rowid, distance FROM items
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT 1
        `,
        )
        .all(query) as Array<{ rowid: bigint; distance: number }>;

      expect(results).toHaveLength(1);
      // rowid may be number or bigint depending on SQLite/extension behavior
      expect(results[0]).toBeDefined();
      expect(Number(results[0]!.rowid)).toBe(1);
    });
  });

  describe("error handling", () => {
    let db: InstanceType<typeof DatabaseSync>;

    beforeEach(() => {
      db = createVecDb();
    });

    afterEach(() => {
      closeDatabases(db);
    });

    test("rejects mismatched vector dimensions on insert", () => {
      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");

      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );

      // Try to insert 3-dimensional vector into 4-dimensional column
      expect(() => {
        stmt.run(1n, new Float32Array([0.1, 0.2, 0.3]));
      }).toThrow();
    });

    test("rejects mismatched vector dimensions on query", () => {
      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");

      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );
      stmt.run(1n, new Float32Array([0.1, 0.2, 0.3, 0.4]));

      // Try to query with 3-dimensional vector
      expect(() => {
        db.prepare(
          `
            SELECT rowid FROM items
            WHERE embedding MATCH ?
          `,
        ).all(new Float32Array([0.1, 0.2, 0.3]));
      }).toThrow();
    });
  });

  // Regression: the fork-only `optimize` command hard-crashed the host process
  // (native SIGTRAP) while compacting chunks on a vec0 table with metadata
  // columns. Mirrors a PhotoStructure reporter's schema: a bit[] vector plus
  // INTEGER and long-TEXT (>12 bytes, spills to the _metadatatextNN shadow
  // table) metadata, spanning multiple chunks with scattered deletes so
  // `optimize` has real work. Fixed in @photostructure/sqlite-vec v1.2.0 by
  // hardening the metadata-copy path to fail as a catchable SQLITE_ERROR
  // instead of corrupting the heap. A crash here takes down the whole process,
  // so `.not.toThrow()` doubles as "did not abort".
  describe("optimize compaction (metadata columns)", () => {
    let db: InstanceType<typeof DatabaseSync> | undefined;

    afterEach(() => {
      closeDatabases(db);
      db = undefined;
    });

    // Deterministic, distinct 24-byte (bit[192]) pattern per rowid.
    function bitVec(rowid: number): Uint8Array {
      const v = new Uint8Array(24);
      for (let j = 0; j < 24; j++) v[j] = (rowid * 31 + j * 7) & 0xff;
      return v;
    }
    // TEXT value guaranteed > 12 bytes so it uses the long-value shadow table.
    const longName = (rowid: number) =>
      `photo_${String(rowid).padStart(8, "0")}_long_filename.jpeg`;

    function createChurnTable(dbPath: string) {
      const d = new DatabaseSync(dbPath, { allowExtension: true });
      d.enableLoadExtension(true);
      d.loadExtension(sqliteVecPath!);
      d.enableLoadExtension(false);
      // Small chunk_size forces many chunks (and mid-optimize chunk rollovers)
      // with few rows. 40 rows at chunk_size=8 => 5 full chunks.
      d.exec(
        "CREATE VIRTUAL TABLE t USING vec0(" +
          "  assetFileId INTEGER," +
          "  lHash bit[192]," +
          "  capturedAt INTEGER," +
          "  bname TEXT," +
          "  chunk_size=8)",
      );
      return d;
    }

    function insertRows(
      d: InstanceType<typeof DatabaseSync>,
      rowids: number[],
    ) {
      const ins = d.prepare(
        "INSERT INTO t(rowid, assetFileId, lHash, capturedAt, bname) " +
          "VALUES (?, ?, vec_bit(?), ?, ?)",
      );
      for (const r of rowids) {
        ins.run(
          BigInt(r),
          BigInt(r * 7),
          bitVec(r),
          BigInt(1_700_000_000 + r),
          longName(r),
        );
      }
    }

    test("optimize over metadata columns does not crash and stays consistent", () => {
      const dbPath = getDbPath("vec-optimize.db");
      db = createChurnTable(dbPath);

      insertRows(
        db,
        Array.from({ length: 40 }, (_, i) => i + 1),
      );

      // Scattered deletes (~40%) fragment the chunks so optimize compacts.
      const del = db.prepare("DELETE FROM t WHERE rowid = ?");
      for (let r = 1; r <= 40; r++) if (r % 5 < 2) del.run(BigInt(r));

      // The operation that used to abort the process.
      expect(() => {
        db!.exec("INSERT INTO t(t) VALUES('optimize')");
      }).not.toThrow();

      // Shadow tables must remain consistent after compaction.
      const integrity = db.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      expect(integrity.integrity_check).toBe("ok");

      // Surviving rows are still queryable, including their long-TEXT metadata.
      const rows = db
        .prepare(
          "SELECT rowid, bname, distance FROM t " +
            "WHERE lHash MATCH vec_bit(?) AND k = 5",
        )
        .all(bitVec(3)) as Array<{
        rowid: bigint | number;
        bname: string;
        distance: number;
      }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.bname).toBe(longName(Number(row.rowid)));
      }
    });

    test("repeated optimize under churn does not crash", () => {
      const dbPath = getDbPath("vec-optimize-churn.db");
      db = createChurnTable(dbPath);

      let next = 1;
      insertRows(
        db,
        Array.from({ length: 40 }, () => next++),
      );

      const del = db.prepare("DELETE FROM t WHERE rowid = ?");
      for (let round = 0; round < 5; round++) {
        // Delete a scattered subset, then grow with fresh rowids.
        for (let r = 1; r < next; r++)
          if ((r + round) % 3 === 0) del.run(BigInt(r));
        insertRows(
          db,
          Array.from({ length: 12 }, () => next++),
        );
        expect(() => {
          db!.exec("INSERT INTO t(t) VALUES('optimize')");
        }).not.toThrow();
      }

      const integrity = db.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      expect(integrity.integrity_check).toBe("ok");
    });
  });
});
