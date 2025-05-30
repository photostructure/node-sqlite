// Benchmark scenarios for SQLite operations

import type { Driver, Statement } from "./drivers.js";

type ScenarioContext = Statement | Record<string, any>;

export interface Scenario {
  name: string;
  description: string;
  setup: (driver: Driver) => ScenarioContext;
  run: (stmt: ScenarioContext, iteration?: number) => any;
  cleanup?: (stmt: ScenarioContext) => void;
  iterations: number;
}

export const scenarios: Record<string, Scenario> = {
  // Single row SELECT operations
  "select-by-id": {
    name: "SELECT by Primary Key",
    description: "Fetch single row by integer primary key",
    setup: (driver) => {
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
      const id = Math.floor(Math.random() * 10000) + 1;
      return stmt.get(id);
    },
    iterations: 1000,
  },

  // Multiple row SELECT operations
  "select-range": {
    name: "SELECT Range",
    description: "Fetch up to 1k rows with WHERE clause",
    setup: (driver) => {
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
          insert.run(
            Math.floor(Math.random() * 1000) + 1,
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
      const userId = Math.floor(Math.random() * 1000) + 1;
      return stmt.all(userId);
    },
    iterations: 100,
  },

  // Iterator performance
  "select-iterate": {
    name: "SELECT with Iterator",
    description: "Iterate over 1k rows",
    setup: (driver) => {
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
            Math.floor(Math.random() * 1000),
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
    iterations: 50,
  },

  // Single INSERT operations
  "insert-simple": {
    name: "INSERT Single Row",
    description: "Insert one row at a time",
    setup: (driver) => {
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
    iterations: 1000,
  },

  // Transactional INSERT operations
  "insert-transaction": {
    name: "INSERT in Transaction",
    description: "Insert 1k rows in a single transaction",
    setup: (driver) => {
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
          customerId: Math.floor(Math.random() * 1000) + 1,
          total: Math.random() * 1000,
          items: JSON.stringify([
            { id: i, quantity: Math.floor(Math.random() * 10) + 1 },
          ]),
        });
      }
      return insertBatch(rows);
    },
    cleanup: (context) => {
      const { stmt } = context as { stmt: Statement };
      stmt.finalize();
    },
    iterations: 100,
  },

  // Complex queries
  "select-join": {
    name: "SELECT with JOIN",
    description: "Join two tables and aggregate results",
    setup: (driver) => {
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
            Math.floor(Math.random() * 1000) + 1,
            Math.random() * 500,
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
      const country = countries[Math.floor(Math.random() * countries.length)];
      return stmt.all(country);
    },
    iterations: 100,
  },

  // BLOB handling
  "insert-blob": {
    name: "INSERT with BLOB",
    description: "Insert binary data",
    setup: (driver) => {
      driver.exec(`
        CREATE TABLE files (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          data BLOB NOT NULL,
          size INTEGER NOT NULL
        )
      `);

      return driver.prepare(
        "INSERT INTO files (name, type, data, size) VALUES (?, ?, ?, ?)",
      );
    },
    run: (stmt, iteration) => {
      // Create a buffer of random data (10KB)
      const size = 10 * 1024;
      const buffer = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
      }

      return stmt.run(
        `file_${iteration}.bin`,
        "application/octet-stream",
        buffer,
        size,
      );
    },
    iterations: 100,
  },

  // UPDATE operations
  "update-indexed": {
    name: "UPDATE with Index",
    description: "Update rows using indexed column",
    setup: (driver) => {
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
            Math.floor(Math.random() * 1000),
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
      const sku = `SKU${String(Math.floor(Math.random() * 10000)).padStart(6, "0")}`;
      const delta = Math.floor(Math.random() * 100) - 50;
      return stmt.run(delta, sku);
    },
    iterations: 1000,
  },

  // DELETE operations
  "delete-bulk": {
    name: "DELETE Bulk",
    description: "Delete multiple rows in transaction",
    setup: (driver) => {
      driver.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          data TEXT
        )
      `);

      // Keep inserting data continuously
      const insert = driver.prepare(
        "INSERT INTO sessions (id, user_id, expires_at, data) VALUES (?, ?, ?, ?)",
      );

      const stmt = driver.prepare("DELETE FROM sessions WHERE expires_at < ?");
      const deleteBatch = driver.transaction((timestamp: number) => {
        // Insert some new sessions
        for (let i = 0; i < 1000; i++) {
          const id = Math.random().toString(36).substring(2);
          insert.run(
            id,
            Math.floor(Math.random() * 1000) + 1,
            Date.now() + Math.random() * 86400000, // Random expiry within 24h
            JSON.stringify({ active: true }),
          );
        }

        // Delete expired sessions
        return stmt.run(timestamp);
      });

      return { stmt, insert, deleteBatch };
    },
    run: (context) => {
      const { deleteBatch } = context as { deleteBatch: any };
      return deleteBatch(Date.now() - 3600000); // Delete sessions older than 1 hour
    },
    cleanup: (context) => {
      const { stmt, insert } = context as {
        stmt: Statement;
        insert: Statement;
      };
      stmt.finalize();
      insert.finalize();
    },
    iterations: 100,
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
