import { DatabaseSync } from "../src";

describe("STRICT Tables", () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe("Type Enforcement", () => {
    beforeEach(() => {
      // Create both STRICT and non-STRICT tables for comparison
      db.exec(`
        CREATE TABLE regular_table (
          id INTEGER PRIMARY KEY,
          int_col INTEGER,
          real_col REAL,
          text_col TEXT,
          blob_col BLOB,
          any_col ANY
        );

        CREATE TABLE strict_table (
          id INTEGER PRIMARY KEY,
          int_col INTEGER,
          real_col REAL,
          text_col TEXT,
          blob_col BLOB,
          any_col ANY
        ) STRICT;
      `);
    });

    test("should enforce INTEGER type in STRICT tables", () => {
      // Regular table allows text in INTEGER column
      expect(() => {
        db.prepare("INSERT INTO regular_table (int_col) VALUES (?)").run(
          "not a number",
        );
      }).not.toThrow();

      // STRICT table rejects non-integer values
      expect(() => {
        db.prepare("INSERT INTO strict_table (int_col) VALUES (?)").run(
          "not a number",
        );
      }).toThrow(/cannot store TEXT value in INTEGER column/);

      // STRICT table accepts proper integers
      const result = db
        .prepare("INSERT INTO strict_table (int_col) VALUES (?)")
        .run(42);
      expect(result.changes).toBe(1);

      // STRICT table rejects real numbers in INTEGER column
      expect(() => {
        db.prepare("INSERT INTO strict_table (int_col) VALUES (?)").run(42.7);
      }).toThrow(/cannot store REAL value in INTEGER column/);
    });

    test("should enforce REAL type in STRICT tables", () => {
      // Regular table allows text in REAL column
      expect(() => {
        db.prepare("INSERT INTO regular_table (real_col) VALUES (?)").run(
          "not a number",
        );
      }).not.toThrow();

      // STRICT table rejects non-numeric values
      expect(() => {
        db.prepare("INSERT INTO strict_table (real_col) VALUES (?)").run(
          "not a number",
        );
      }).toThrow(/cannot store TEXT value in REAL column/);

      // STRICT table accepts real numbers
      const result = db
        .prepare("INSERT INTO strict_table (real_col) VALUES (?)")
        .run(3.14159);
      expect(result.changes).toBe(1);

      // STRICT table converts integers to real
      const result2 = db
        .prepare("INSERT INTO strict_table (real_col) VALUES (?)")
        .run(42);
      expect(result2.changes).toBe(1);
    });

    test("should enforce TEXT type in STRICT tables", () => {
      // Regular table accepts any value in TEXT column
      expect(() => {
        db.prepare("INSERT INTO regular_table (text_col) VALUES (?)").run(
          Buffer.from("blob"),
        );
      }).not.toThrow();

      // STRICT table rejects BLOB values in TEXT column
      expect(() => {
        db.prepare("INSERT INTO strict_table (text_col) VALUES (?)").run(
          Buffer.from("blob"),
        );
      }).toThrow(/cannot store BLOB value in TEXT column/);

      // STRICT table accepts text values
      const result = db
        .prepare("INSERT INTO strict_table (text_col) VALUES (?)")
        .run("hello");
      expect(result.changes).toBe(1);

      // STRICT table converts numbers to text
      const result2 = db
        .prepare("INSERT INTO strict_table (text_col) VALUES (?)")
        .run(42);
      expect(result2.changes).toBe(1);

      const value = db
        .prepare("SELECT text_col FROM strict_table WHERE text_col = '42'")
        .get();
      expect(value.text_col).toBe("42");
    });

    test("should enforce BLOB type in STRICT tables", () => {
      // STRICT table accepts only BLOB values in BLOB column
      const result = db
        .prepare("INSERT INTO strict_table (blob_col) VALUES (?)")
        .run(Buffer.from("data"));
      expect(result.changes).toBe(1);

      // Other types are rejected
      expect(() => {
        db.prepare("INSERT INTO strict_table (blob_col) VALUES (?)").run(
          "text",
        );
      }).toThrow(/cannot store TEXT value in BLOB column/);

      expect(() => {
        db.prepare("INSERT INTO strict_table (blob_col) VALUES (?)").run(42);
      }).toThrow(/cannot store INT value in BLOB column/);
    });

    test("should allow any type in ANY column in STRICT tables", () => {
      // ANY column accepts all types even in STRICT tables
      const stmt = db.prepare("INSERT INTO strict_table (any_col) VALUES (?)");

      expect(() => stmt.run(42)).not.toThrow();
      expect(() => stmt.run(3.14)).not.toThrow();
      expect(() => stmt.run("text")).not.toThrow();
      expect(() => stmt.run(Buffer.from("blob"))).not.toThrow();
      expect(() => stmt.run(null)).not.toThrow();

      // Verify all values were inserted
      const count = db
        .prepare("SELECT COUNT(*) as count FROM strict_table")
        .get();
      expect(count.count).toBe(5);
    });

    test("should reject invalid column types in STRICT tables", () => {
      // STRICT tables only allow INTEGER, REAL, TEXT, BLOB, ANY
      expect(() => {
        db.exec(`
          CREATE TABLE invalid_strict (
            id INTEGER PRIMARY KEY,
            varchar_col VARCHAR(255)
          ) STRICT;
        `);
      }).toThrow(
        /unknown datatype for invalid_strict.varchar_col: "VARCHAR\(255\)"/,
      );

      // But regular tables accept any type name
      expect(() => {
        db.exec(`
          CREATE TABLE valid_regular (
            id INTEGER PRIMARY KEY,
            varchar_col VARCHAR(255)
          );
        `);
      }).not.toThrow();
    });
  });

  describe("Primary Key Constraints", () => {
    test("should handle PRIMARY KEY types in STRICT tables", () => {
      // STRICT tables allow INT as an alias for INTEGER in PRIMARY KEY
      expect(() => {
        db.exec(`
          CREATE TABLE strict_pk1 (
            id INT PRIMARY KEY,
            data TEXT
          ) STRICT;
        `);
      }).not.toThrow();

      // TEXT PRIMARY KEY is actually allowed in STRICT tables
      expect(() => {
        db.exec(`
          CREATE TABLE strict_pk2 (
            id TEXT PRIMARY KEY,
            data TEXT
          ) STRICT;
        `);
      }).not.toThrow();

      // INTEGER PRIMARY KEY works as expected
      expect(() => {
        db.exec(`
          CREATE TABLE strict_pk3 (
            id INTEGER PRIMARY KEY,
            data TEXT
          ) STRICT;
        `);
      }).not.toThrow();

      // SQLite allows various PRIMARY KEY types in STRICT tables
      // The main difference is that only INTEGER PRIMARY KEY acts as an alias for rowid
    });

    test("should handle AUTOINCREMENT with STRICT tables", () => {
      db.exec(`
        CREATE TABLE strict_auto (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT
        ) STRICT;
      `);

      const stmt = db.prepare("INSERT INTO strict_auto (data) VALUES (?)");
      const result1 = stmt.run("first");
      const result2 = stmt.run("second");

      expect(result1.lastInsertRowid).toBe(1);
      expect(result2.lastInsertRowid).toBe(2);
    });
  });

  describe("NOT NULL Constraints", () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE strict_not_null (
          id INTEGER PRIMARY KEY,
          required_int INTEGER NOT NULL,
          required_text TEXT NOT NULL,
          optional_text TEXT
        ) STRICT;
      `);
    });

    test("should enforce NOT NULL in STRICT tables", () => {
      // NULL values rejected in NOT NULL columns
      expect(() => {
        db.prepare(
          "INSERT INTO strict_not_null (required_int, required_text) VALUES (?, ?)",
        ).run(null, "text");
      }).toThrow(/NOT NULL constraint failed/);

      expect(() => {
        db.prepare(
          "INSERT INTO strict_not_null (required_int, required_text) VALUES (?, ?)",
        ).run(42, null);
      }).toThrow(/NOT NULL constraint failed/);

      // Valid insert works
      const result = db
        .prepare(
          "INSERT INTO strict_not_null (required_int, required_text) VALUES (?, ?)",
        )
        .run(42, "text");
      expect(result.changes).toBe(1);

      // NULL allowed in optional column
      const result2 = db
        .prepare(
          "INSERT INTO strict_not_null (required_int, required_text, optional_text) VALUES (?, ?, ?)",
        )
        .run(43, "text", null);
      expect(result2.changes).toBe(1);
    });
  });

  describe("CHECK Constraints", () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE strict_check (
          id INTEGER PRIMARY KEY,
          age INTEGER CHECK (age >= 0 AND age <= 150),
          email TEXT CHECK (email LIKE '%@%'),
          status TEXT CHECK (status IN ('active', 'inactive', 'pending'))
        ) STRICT;
      `);
    });

    test("should enforce CHECK constraints in STRICT tables", () => {
      // Age check
      expect(() => {
        db.prepare("INSERT INTO strict_check (age) VALUES (?)").run(-1);
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        db.prepare("INSERT INTO strict_check (age) VALUES (?)").run(200);
      }).toThrow(/CHECK constraint failed/);

      // Email check
      expect(() => {
        db.prepare("INSERT INTO strict_check (email) VALUES (?)").run(
          "invalid",
        );
      }).toThrow(/CHECK constraint failed/);

      // Status check
      expect(() => {
        db.prepare("INSERT INTO strict_check (status) VALUES (?)").run(
          "unknown",
        );
      }).toThrow(/CHECK constraint failed/);

      // Valid values work
      const result = db
        .prepare(
          "INSERT INTO strict_check (age, email, status) VALUES (?, ?, ?)",
        )
        .run(25, "user@example.com", "active");
      expect(result.changes).toBe(1);
    });
  });

  describe("UNIQUE Constraints", () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE strict_unique (
          id INTEGER PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE
        ) STRICT;
      `);
    });

    test("should enforce UNIQUE constraints in STRICT tables", () => {
      // First insert works
      const result1 = db
        .prepare("INSERT INTO strict_unique (username, email) VALUES (?, ?)")
        .run("user1", "user1@example.com");
      expect(result1.changes).toBe(1);

      // Duplicate username fails
      expect(() => {
        db.prepare(
          "INSERT INTO strict_unique (username, email) VALUES (?, ?)",
        ).run("user1", "user2@example.com");
      }).toThrow(/UNIQUE constraint failed: strict_unique.username/);

      // Duplicate email fails
      expect(() => {
        db.prepare(
          "INSERT INTO strict_unique (username, email) VALUES (?, ?)",
        ).run("user2", "user1@example.com");
      }).toThrow(/UNIQUE constraint failed: strict_unique.email/);

      // NULL emails are allowed and don't conflict
      const result2 = db
        .prepare("INSERT INTO strict_unique (username, email) VALUES (?, ?)")
        .run("user2", null);
      const result3 = db
        .prepare("INSERT INTO strict_unique (username, email) VALUES (?, ?)")
        .run("user3", null);
      expect(result2.changes).toBe(1);
      expect(result3.changes).toBe(1);
    });
  });

  describe("Foreign Key Constraints with STRICT", () => {
    beforeEach(() => {
      // Enable foreign keys
      db.exec("PRAGMA foreign_keys = ON");

      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        ) STRICT;

        CREATE TABLE posts (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        ) STRICT;
      `);

      // Insert test users
      db.prepare("INSERT INTO users (id, name) VALUES (1, 'Alice')").run();
      db.prepare("INSERT INTO users (id, name) VALUES (2, 'Bob')").run();
    });

    test("should enforce foreign key constraints in STRICT tables", () => {
      // Valid foreign key works
      const result = db
        .prepare("INSERT INTO posts (user_id, title) VALUES (?, ?)")
        .run(1, "First Post");
      expect(result.changes).toBe(1);

      // Invalid foreign key fails
      expect(() => {
        db.prepare("INSERT INTO posts (user_id, title) VALUES (?, ?)").run(
          999,
          "Invalid Post",
        );
      }).toThrow(/FOREIGN KEY constraint failed/);

      // Deleting referenced user fails
      expect(() => {
        db.prepare("DELETE FROM users WHERE id = ?").run(1);
      }).toThrow(/FOREIGN KEY constraint failed/);

      // Deleting unreferenced user works
      const deleteResult = db.prepare("DELETE FROM users WHERE id = ?").run(2);
      expect(deleteResult.changes).toBe(1);
    });

    test("should handle CASCADE actions with STRICT tables", () => {
      db.exec(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        ) STRICT;

        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          category_id INTEGER,
          name TEXT NOT NULL,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        ) STRICT;
      `);

      // Insert test data
      db.prepare(
        "INSERT INTO categories (id, name) VALUES (1, 'Electronics')",
      ).run();
      db.prepare(
        "INSERT INTO products (category_id, name) VALUES (1, 'Laptop')",
      ).run();
      db.prepare(
        "INSERT INTO products (category_id, name) VALUES (1, 'Phone')",
      ).run();

      // Deleting category cascades to products
      const result = db.prepare("DELETE FROM categories WHERE id = 1").run();
      expect(result.changes).toBe(1);

      const products = db
        .prepare("SELECT COUNT(*) as count FROM products")
        .get();
      expect(products.count).toBe(0);
    });
  });

  describe("Edge Cases and Interactions", () => {
    test("should handle mixed STRICT and non-STRICT tables", () => {
      db.exec(`
        CREATE TABLE regular (
          id INTEGER PRIMARY KEY,
          data TEXT
        );

        CREATE TABLE strict (
          id INTEGER PRIMARY KEY,
          data TEXT
        ) STRICT;
      `);

      // Regular table accepts any value
      db.prepare("INSERT INTO regular (data) VALUES (?)").run(42);
      db.prepare("INSERT INTO regular (data) VALUES (?)").run("text");

      // STRICT table with proper types
      db.prepare("INSERT INTO strict (data) VALUES (?)").run("42");
      db.prepare("INSERT INTO strict (data) VALUES (?)").run("text");

      // Join between STRICT and non-STRICT works
      const result = db
        .prepare(
          `
        SELECT r.data as regular_data, s.data as strict_data
        FROM regular r
        JOIN strict s ON r.data = s.data
        WHERE r.data = '42'
      `,
        )
        .get();

      expect(result).toBeDefined();
      expect(result.regular_data).toBe("42");
      expect(result.strict_data).toBe("42");
    });

    test("should handle triggers with STRICT tables", () => {
      db.exec(`
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          action TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE data (
          id INTEGER PRIMARY KEY,
          value INTEGER NOT NULL
        ) STRICT;

        CREATE TRIGGER audit_insert
        AFTER INSERT ON data
        BEGIN
          INSERT INTO audit_log (table_name, action, timestamp)
          VALUES ('data', 'INSERT', unixepoch());
        END;
      `);

      // Insert should trigger audit
      db.prepare("INSERT INTO data (value) VALUES (?)").run(42);

      const audit = db.prepare("SELECT * FROM audit_log").get();
      expect(audit).toBeDefined();
      expect(audit.table_name).toBe("data");
      expect(audit.action).toBe("INSERT");
      expect(audit.timestamp).toBeGreaterThan(0);
    });

    test("should handle DEFAULT values with STRICT tables", () => {
      db.exec(`
        CREATE TABLE defaults (
          id INTEGER PRIMARY KEY,
          created_at INTEGER DEFAULT (unixepoch()),
          status TEXT DEFAULT 'pending',
          count INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1
        ) STRICT;
      `);

      // Insert without specifying defaults
      const result = db.prepare("INSERT INTO defaults (id) VALUES (?)").run(1);
      expect(result.changes).toBe(1);

      const row = db.prepare("SELECT * FROM defaults WHERE id = 1").get();
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.status).toBe("pending");
      expect(row.count).toBe(0);
      expect(row.is_active).toBe(1);
    });
  });

  describe("Performance Characteristics", () => {
    test("should handle bulk inserts in STRICT tables", () => {
      db.exec(`
        CREATE TABLE strict_bulk (
          id INTEGER PRIMARY KEY,
          value INTEGER NOT NULL
        ) STRICT;
      `);

      const stmt = db.prepare("INSERT INTO strict_bulk (value) VALUES (?)");

      db.exec("BEGIN");
      for (let i = 0; i < 1000; i++) {
        stmt.run(i);
      }
      db.exec("COMMIT");

      const count = db
        .prepare("SELECT COUNT(*) as count FROM strict_bulk")
        .get();
      expect(count.count).toBe(1000);
    });
  });
});
