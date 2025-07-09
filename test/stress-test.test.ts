// Test for stress test functionality

import { createDriver } from "../benchmark/drivers";
import {
  createStressSchema,
  generateLargeDataset,
  getStressScenarios,
  NaturalDataGenerator,
} from "../benchmark/stress-scenarios";
import { TempDir } from "./test-utils";

describe("Stress Test Components", () => {
  const tempDirMgr = TempDir.perTest();

  describe("NaturalDataGenerator", () => {
    it("should generate consistent data with same seed", () => {
      const gen1 = new NaturalDataGenerator(12345);
      const gen2 = new NaturalDataGenerator(12345);

      expect(gen1.generateFirstName()).toBe(gen2.generateFirstName());
      expect(gen1.generateEmail()).toBe(gen2.generateEmail());
      expect(gen1.generateText(10, 20)).toBe(gen2.generateText(10, 20));
    });

    it("should generate different data with different seeds", () => {
      const gen1 = new NaturalDataGenerator(12345);
      const gen2 = new NaturalDataGenerator(54321);

      expect(gen1.generateFirstName()).not.toBe(gen2.generateFirstName());
    });

    it("should generate valid emails", () => {
      const gen = new NaturalDataGenerator();
      const email = gen.generateEmail();

      expect(email).toMatch(/^[a-z]+(?:[._][a-z]+)?@[a-z]+\.[a-z]+$/);
    });

    it("should generate valid JSON", () => {
      const gen = new NaturalDataGenerator();
      const jsonStr = gen.generateJson();

      expect(() => JSON.parse(jsonStr)).not.toThrow();

      const parsed = JSON.parse(jsonStr);
      expect(typeof parsed).toBe("object");
    });

    it("should generate text within specified word count", () => {
      const gen = new NaturalDataGenerator();
      const text = gen.generateText(5, 10);
      const wordCount = text.split(/\s+/).length;

      expect(wordCount).toBeGreaterThanOrEqual(5);
      expect(wordCount).toBeLessThanOrEqual(10);
    });

    it("should generate consistent randomInt values", () => {
      const gen = new NaturalDataGenerator(12345);
      const values = [];

      for (let i = 0; i < 100; i++) {
        values.push(gen.randomInt(1, 100));
      }

      // All values should be in range
      values.forEach((val) => {
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(100);
      });

      // Should have variety
      const unique = new Set(values);
      expect(unique.size).toBeGreaterThan(10);
    });
  });

  describe("Schema Creation", () => {
    it("should create all required tables", async () => {
      const dbPath = tempDirMgr.getDbPath("test.db");
      const driver = await createDriver("@photostructure/sqlite", dbPath);

      createStressSchema(driver);

      // Check that all tables exist
      const tables = driver
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
        )
        .all() as { name: string }[];

      const expectedTables = [
        "categories",
        "comments",
        "post_tags",
        "posts",
        "posts_fts",
        "tags",
        "users",
      ];

      const tableNames = tables.map((t) => t.name);
      expectedTables.forEach((table) => {
        expect(tableNames).toContain(table);
      });

      // Check that FTS table works by inserting a real post first
      // (FTS5 with content=posts requires a corresponding row in posts table)

      // First insert required dependencies
      const userInsert = driver.prepare(`
        INSERT INTO users (first_name, last_name, email, created_at, updated_at)
        VALUES ('Test', 'User', 'test@example.com', ?, ?)
      `);
      const userId = userInsert.run(Date.now(), Date.now()).lastInsertRowid;
      userInsert.finalize();

      const categoryInsert = driver.prepare(`
        INSERT INTO categories (name, slug, created_at)
        VALUES ('Test Category', 'test-category', ?)
      `);
      const categoryId = categoryInsert.run(Date.now()).lastInsertRowid;
      categoryInsert.finalize();

      // Now insert a post (this will automatically populate FTS via trigger)
      const postInsert = driver.prepare(`
        INSERT INTO posts (user_id, category_id, title, slug, excerpt, content, status, created_at, updated_at)
        VALUES (?, ?, 'Test Title', 'test-title', 'Test excerpt', 'Test content', 'published', ?, ?)
      `);
      postInsert.run(userId, categoryId, Date.now(), Date.now());
      postInsert.finalize();

      // Check FTS search works
      const search = driver
        .prepare(
          `
        SELECT * FROM posts_fts WHERE posts_fts MATCH 'test'
      `,
        )
        .all();
      expect(search.length).toBe(1);

      await driver.close();
    });

    it("should create all required indexes", async () => {
      const dbPath = tempDirMgr.getDbPath("test.db");
      const driver = await createDriver("@photostructure/sqlite", dbPath);

      createStressSchema(driver);

      // Check that indexes exist
      const indexes = driver
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
      `,
        )
        .all() as { name: string }[];

      expect(indexes.length).toBeGreaterThan(10);

      // Check for some key indexes
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_users_email");
      expect(indexNames).toContain("idx_posts_user_id");
      expect(indexNames).toContain("idx_posts_status_published");

      await driver.close();
    });
  });

  describe("Data Generation", () => {
    it("should generate small dataset without errors", async () => {
      const dbPath = tempDirMgr.getDbPath("test.db");
      const driver = await createDriver("@photostructure/sqlite", dbPath);

      createStressSchema(driver);

      // Generate small dataset (1MB)
      expect(() => {
        generateLargeDataset(driver, 1);
      }).not.toThrow();

      // Verify data was created
      const userCount = driver
        .prepare("SELECT COUNT(*) as count FROM users")
        .get() as { count: number };
      const postCount = driver
        .prepare("SELECT COUNT(*) as count FROM posts")
        .get() as { count: number };
      const commentCount = driver
        .prepare("SELECT COUNT(*) as count FROM comments")
        .get() as { count: number };

      expect(userCount.count).toBeGreaterThan(0);
      expect(postCount.count).toBeGreaterThan(0);
      expect(commentCount.count).toBeGreaterThan(0);

      // Verify foreign key relationships
      const orphanPosts = driver
        .prepare(
          `
        SELECT COUNT(*) as count FROM posts p 
        LEFT JOIN users u ON p.user_id = u.id 
        WHERE u.id IS NULL
      `,
        )
        .get() as { count: number };
      expect(orphanPosts.count).toBe(0);

      await driver.close();
    }, 30000); // 30 second timeout for data generation
  });

  describe("Stress Scenarios", () => {
    it("should return available stress scenarios", () => {
      const scenarios = getStressScenarios();

      expect(scenarios.length).toBeGreaterThan(0);

      const scenarioKeys = scenarios.map(([key]) => key);
      expect(scenarioKeys).toContain("stress-complex-joins");
      expect(scenarioKeys).toContain("stress-fts-search");
      expect(scenarioKeys).toContain("stress-bulk-operations");
      expect(scenarioKeys).toContain("stress-concurrent-reads");
    });

    it("should filter scenarios by pattern", () => {
      const ftsScenarios = getStressScenarios("fts");
      expect(ftsScenarios.length).toBe(1);
      expect(ftsScenarios[0][0]).toBe("stress-fts-search");

      const joinScenarios = getStressScenarios("join");
      expect(joinScenarios.length).toBe(1);
      expect(joinScenarios[0][0]).toBe("stress-complex-joins");
    });

    it("should run stress scenario without errors", async () => {
      const dbPath = tempDirMgr.getDbPath("test.db");
      const driver = await createDriver("@photostructure/sqlite", dbPath);

      // Create schema and minimal data
      createStressSchema(driver);
      generateLargeDataset(driver, 1); // 1MB dataset for quick test

      // Test complex joins scenario
      const scenarios = getStressScenarios("complex-joins");
      expect(scenarios.length).toBe(1);

      const [_, scenario] = scenarios[0];
      const context = scenario.setup(driver);

      // Run scenario a few times
      for (let i = 0; i < 5; i++) {
        expect(() => {
          const result = scenario.run(context, i);
          expect(result).toBeDefined();
        }).not.toThrow();
      }

      // Cleanup
      if (scenario.cleanup) {
        scenario.cleanup(context);
      } else {
        context.cleanup();
      }

      await driver.close();
    }, 30000);
  });
});
