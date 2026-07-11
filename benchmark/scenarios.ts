// Benchmark scenarios for SQLite operations

import type { Driver, Statement } from "./drivers.js";

type ScenarioContext = Statement | Record<string, any>;

export interface Scenario {
  name: string;
  // Categories drive how a scenario is grouped in the summary/rankings:
  //   "cpu"   - read/query scenarios. Cost is row materialization and query
  //             execution (the path this project focuses on); fully driver-bound.
  //   "fsync" - single-op writes. Each run() commits once, so cost is dominated
  //             by durable-commit sync latency, which is I/O-bound and largely
  //             driver-independent — these tie across drivers.
  //   "batch" - batched writes (~1000 rows per commit). The durable commit cost
  //             is amortized, so cost is again CPU/binding-bound and
  //             driver differences remain visible.
  // The summary uses these categories to distinguish read paths from
  // durability-bound and batched writes without blending them into one score.
  category: "cpu" | "fsync" | "batch";
  description: string;
  setup: (driver: Driver) => ScenarioContext;
  run: (stmt: ScenarioContext, iteration?: number) => any;
  cleanup?: (stmt: ScenarioContext) => void;
}

// Deterministic PRNG (mulberry32) so every driver benchmarks the identical
// dataset and access pattern. Each setup() calls resetRng() first, so a fresh
// db built for any trial/driver is byte-for-byte identical — Math.random() would
// give each driver a different dataset and add needless run-to-run noise.
let rngState = 0;
function resetRng(seed = 0x9e3779b9): void {
  rngState = seed >>> 0;
}
function rng(): number {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const scenarios: Record<string, Scenario> = {
  // Single row SELECT operations
  "select-by-id": {
    name: "SELECT by Primary Key",
    category: "cpu",
    description: "Fetch single row by integer primary key",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          age INTEGER,
          bio TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);

      const insert = driver.prepare(
        "INSERT INTO users (name, email, age, bio) VALUES (?, ?, ?, ?)",
      );
      const tx = driver.transaction((count: number) => {
        for (let i = 0; i < count; i++) {
          insert.run(
            `User ${i}`,
            `user${i}@example.com`,
            20 + (i % 50),
            `This is the bio for user ${i}. `.repeat(10),
          );
        }
      });
      tx(10000);
      insert.finalize();

      return driver.prepare("SELECT * FROM users WHERE id = ?");
    },
    run: (stmt) => {
      const id = Math.floor(rng() * 10000) + 1;
      return stmt.get(id);
    },
  },

  // Multiple row SELECT operations
  "select-range": {
    name: "SELECT Range",
    category: "cpu",
    description: "Fetch ~1000 rows by indexed key",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          data TEXT,
          timestamp INTEGER DEFAULT (unixepoch())
        )
      `);

      const insert = driver.prepare(
        "INSERT INTO events (user_id, type, data) VALUES (?, ?, ?)",
      );
      const tx = driver.transaction((count: number) => {
        const types = ["login", "logout", "purchase", "view", "click"];
        for (let i = 0; i < count; i++) {
          // 50 distinct user_ids over 50k rows => ~1000 rows per user, so the
          // LIMIT 1000 query below actually returns ~1000 rows (a real
          // multi-row materialization) instead of ~50.
          insert.run(
            Math.floor(rng() * 50) + 1,
            types[i % types.length],
            JSON.stringify({ value: i, extra: "x".repeat(100) }),
          );
        }
      });
      tx(50000);
      insert.finalize();

      driver.exec("CREATE INDEX idx_events_user_id ON events(user_id)");

      return driver.prepare(
        "SELECT * FROM events WHERE user_id = ? LIMIT 1000",
      );
    },
    run: (stmt) => {
      // Match the 50-user insert domain so every query hits a populated user.
      const userId = Math.floor(rng() * 50) + 1;
      return stmt.all(userId);
    },
  },

  // Iterator performance
  "select-iterate": {
    name: "SELECT with Iterator",
    category: "cpu",
    description: "Iterate over 1k rows",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          price REAL NOT NULL,
          stock INTEGER DEFAULT 0
        )
      `);

      const insert = driver.prepare(
        "INSERT INTO products (name, description, price, stock) VALUES (?, ?, ?, ?)",
      );
      const tx = driver.transaction((count: number) => {
        for (let i = 0; i < count; i++) {
          insert.run(
            `Product ${i}`,
            `Description for product ${i}`,
            9.99 + (i % 100),
            Math.floor(rng() * 1000),
          );
        }
      });
      tx(10000);
      insert.finalize();

      return driver.prepare("SELECT * FROM products LIMIT 1000");
    },
    run: (stmt) => {
      let count = 0;
      for (const _row of stmt.iterate()) {
        count++;
      }
      return count;
    },
  },

  // Single INSERT operations
  "insert-simple": {
    name: "INSERT Single Row",
    category: "fsync",
    description: "Insert one row at a time (one durable commit per row)",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE logs (
          id INTEGER PRIMARY KEY,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);

      return driver.prepare(
        "INSERT INTO logs (level, message, metadata) VALUES (?, ?, ?)",
      );
    },
    run: (stmt, iteration) => {
      return stmt.run(
        "INFO",
        `Log message ${iteration}`,
        JSON.stringify({ iteration, timestamp: Date.now() }),
      );
    },
  },

  // Transactional INSERT operations
  "insert-transaction": {
    name: "INSERT in Transaction",
    category: "batch",
    description:
      "Insert 1k rows in a single transaction (one durable commit per 1k rows)",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          total REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          items TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);

      const stmt = driver.prepare(
        "INSERT INTO orders (customer_id, total, items) VALUES (?, ?, ?)",
      );
      const insertBatch = driver.transaction(
        (rows: Array<{ customerId: number; total: number; items: string }>) => {
          for (const row of rows) {
            stmt.run(row.customerId, row.total, row.items);
          }
          return rows.length;
        },
      );

      return { stmt, insertBatch };
    },
    run: (context, _iteration) => {
      const { insertBatch } = context as { insertBatch: any };
      const rows = [];
      for (let i = 0; i < 1000; i++) {
        rows.push({
          customerId: Math.floor(rng() * 1000) + 1,
          total: rng() * 1000,
          items: JSON.stringify([
            { id: i, quantity: Math.floor(rng() * 10) + 1 },
          ]),
        });
      }
      return insertBatch(rows);
    },
    cleanup: (context) => {
      const { stmt } = context as { stmt: Statement };
      stmt.finalize();
    },
  },

  // Complex queries
  "select-join": {
    name: "SELECT with JOIN",
    category: "cpu",
    description: "Join two tables and aggregate results",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE customers (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          country TEXT
        );

        CREATE TABLE purchases (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          product TEXT NOT NULL,
          date INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
      `);

      // Insert customers
      const insertCustomer = driver.prepare(
        "INSERT INTO customers (name, email, country) VALUES (?, ?, ?)",
      );
      const countries = ["USA", "UK", "Canada", "Germany", "France"];
      const txCustomers = driver.transaction((count: number) => {
        for (let i = 0; i < count; i++) {
          insertCustomer.run(
            `Customer ${i}`,
            `customer${i}@example.com`,
            countries[i % countries.length],
          );
        }
      });
      txCustomers(1000);
      insertCustomer.finalize();

      // Insert purchases
      const insertPurchase = driver.prepare(
        "INSERT INTO purchases (customer_id, amount, product) VALUES (?, ?, ?)",
      );
      const products = ["Widget", "Gadget", "Tool", "Device", "Instrument"];
      const txPurchases = driver.transaction((count: number) => {
        for (let i = 0; i < count; i++) {
          insertPurchase.run(
            Math.floor(rng() * 1000) + 1,
            rng() * 500,
            products[i % products.length],
          );
        }
      });
      txPurchases(10000);
      insertPurchase.finalize();

      driver.exec(
        "CREATE INDEX idx_purchases_customer_id ON purchases(customer_id)",
      );

      return driver.prepare(`
        SELECT
          c.name,
          c.country,
          COUNT(p.id) as purchase_count,
          SUM(p.amount) as total_spent
        FROM customers c
        LEFT JOIN purchases p ON c.id = p.customer_id
        WHERE c.country = ?
        GROUP BY c.id
        ORDER BY total_spent DESC
        LIMIT 10
      `);
    },
    run: (stmt) => {
      const countries = ["USA", "UK", "Canada", "Germany", "France"];
      const country = countries[Math.floor(rng() * countries.length)];
      return stmt.all(country);
    },
  },

  // BLOB handling
  "insert-blob": {
    name: "INSERT with BLOB",
    category: "fsync",
    description:
      "Insert one 10KB binary blob per operation (one durable commit per row)",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE files (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          data BLOB NOT NULL,
          size INTEGER NOT NULL
        )
      `);

      const stmt = driver.prepare(
        "INSERT INTO files (name, type, data, size) VALUES (?, ?, ?, ?)",
      );

      // Build the 10KB payload once, OUTSIDE the timed region. The scenario
      // measures binding + writing a blob, not the cost of generating random
      // bytes (the old code filled a fresh buffer byte-by-byte on every run).
      const size = 10 * 1024;
      const buffer = Buffer.allocUnsafe(size);
      for (let i = 0; i < size; i++) {
        buffer[i] = i & 0xff;
      }

      return { stmt, buffer, size };
    },
    run: (context, iteration) => {
      const { stmt, buffer, size } = context as {
        stmt: Statement;
        buffer: Buffer;
        size: number;
      };
      return stmt.run(
        `file_${iteration}.bin`,
        "application/octet-stream",
        buffer,
        size,
      );
    },
    cleanup: (context) => {
      const { stmt } = context as { stmt: Statement };
      stmt.finalize();
    },
  },

  // UPDATE operations
  "update-indexed": {
    name: "UPDATE with Index",
    category: "fsync",
    description:
      "Update one row via an indexed column (one durable commit per update)",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE inventory (
          id INTEGER PRIMARY KEY,
          sku TEXT UNIQUE NOT NULL,
          quantity INTEGER NOT NULL,
          last_updated INTEGER DEFAULT (unixepoch())
        )
      `);

      const insert = driver.prepare(
        "INSERT INTO inventory (sku, quantity) VALUES (?, ?)",
      );
      const tx = driver.transaction((count: number) => {
        for (let i = 0; i < count; i++) {
          insert.run(
            `SKU${String(i).padStart(6, "0")}`,
            Math.floor(rng() * 1000),
          );
        }
      });
      tx(10000);
      insert.finalize();

      driver.exec("CREATE INDEX idx_inventory_sku ON inventory(sku)");

      return driver.prepare(
        "UPDATE inventory SET quantity = quantity + ?, last_updated = unixepoch() WHERE sku = ?",
      );
    },
    run: (stmt) => {
      const sku = `SKU${String(Math.floor(rng() * 10000)).padStart(6, "0")}`;
      const delta = Math.floor(rng() * 100) - 50;
      return stmt.run(delta, sku);
    },
  },

  // DELETE operations
  "delete-bulk": {
    name: "DELETE Bulk",
    category: "batch",
    description:
      "Insert 1k expired rows then bulk-delete all of them in one transaction",
    setup: (driver) => {
      resetRng();
      driver.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          data TEXT
        )
      `);

      const insert = driver.prepare(
        "INSERT INTO sessions (id, user_id, expires_at, data) VALUES (?, ?, ?, ?)",
      );
      const del = driver.prepare("DELETE FROM sessions WHERE expires_at < ?");
      const data = JSON.stringify({ active: true });

      // Each call inserts 1000 rows that are ALL already expired, then deletes
      // them all in the same transaction. The old scenario inserted rows with
      // future expiry and deleted with a past cutoff, so the DELETE matched
      // zero rows every time — it measured 1000 INSERTs plus a no-op scan, not
      // a bulk delete. Deleting all 1000 makes the DELETE do real work and
      // returns the table to empty, so every iteration measures identical work
      // instead of scanning an ever-growing table.
      const deleteBatch = driver.transaction((batchId: number) => {
        const now = Date.now();
        for (let i = 0; i < 1000; i++) {
          insert.run(
            `s${batchId}-${i}`,
            (i % 1000) + 1,
            now - 1 - i, // strictly in the past => expired
            data,
          );
        }
        return del.run(now); // deletes all 1000 rows just inserted
      });

      return { del, insert, deleteBatch };
    },
    run: (context, iteration) => {
      const { deleteBatch } = context as { deleteBatch: any };
      return deleteBatch(iteration ?? 0);
    },
    cleanup: (context) => {
      const { del, insert } = context as {
        del: Statement;
        insert: Statement;
      };
      del.finalize();
      insert.finalize();
    },
  },
};

// Helper to get scenario by name or pattern
export function getScenarios(
  filter?: string | null,
): Array<[string, Scenario]> {
  if (!filter) {
    return Object.entries(scenarios);
  }

  const pattern = filter.toLowerCase();
  return Object.entries(scenarios).filter(
    ([key, scenario]) =>
      key.toLowerCase().includes(pattern) ||
      scenario.name.toLowerCase().includes(pattern),
  );
}
