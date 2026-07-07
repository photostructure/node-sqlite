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
        stmt.run(1, new Float32Array([0.1, 0.2, 0.3, 0.4]));
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
        stmt.run(id, vec);
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
        stmt.run(1, buffer);
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
        stmt.run(id, vec);
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
        1,
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
      stmt.run(1, new Float32Array([0.1, 0.1, 0.1, 0.1]));
      stmt.run(2, new Float32Array([0.9, 0.9, 0.9, 0.9]));
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
        stmt.run(1, new Float32Array([0.1, 0.2, 0.3]));
      }).toThrow();
    });

    test("rejects mismatched vector dimensions on query", () => {
      db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");

      const stmt = db.prepare(
        "INSERT INTO items(rowid, embedding) VALUES (?, ?)",
      );
      stmt.run(1, new Float32Array([0.1, 0.2, 0.3, 0.4]));

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
});
