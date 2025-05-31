import { URL } from "node:url";
import { DatabaseSync, type DatabaseSyncInstance } from "../src";
import { useTempDir } from "./test-utils";

describe("Path Validation", () => {
  const { getDbPath } = useTempDir("sqlite-path-test-", {
    waitForWindows: true,
  });

  describe("String paths", () => {
    it("should accept valid string paths", () => {
      const db = new DatabaseSync(":memory:");
      expect(db.isOpen).toBe(true);
      db.close();
    });

    it("should accept file paths as strings", () => {
      const filePath = getDbPath("test.db");
      const db = new DatabaseSync(filePath);
      expect(db.isOpen).toBe(true);
      expect(db.location()).toBe(filePath);
      db.close();
    });

    it("should reject string paths with null bytes", () => {
      expect(() => {
        new DatabaseSync("test\0.db");
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });
  });

  describe("Buffer paths", () => {
    it("should accept valid Buffer paths", () => {
      const filePath = getDbPath("buffer-test.db");
      const buffer = Buffer.from(filePath, "utf8");
      const db = new DatabaseSync(buffer);
      expect(db.isOpen).toBe(true);
      expect(db.location()).toBe(filePath);
      db.close();
    });

    it("should accept in-memory database via Buffer", () => {
      const buffer = Buffer.from(":memory:", "utf8");
      const db = new DatabaseSync(buffer);
      expect(db.isOpen).toBe(true);
      // In-memory databases return null for location() - this is correct SQLite behavior
      expect(db.location()).toBe(null);
      db.close();
    });

    it("should reject Buffer paths with null bytes", () => {
      const buffer = Buffer.from("test\0.db", "utf8");
      expect(() => {
        new DatabaseSync(buffer);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });
  });

  describe("URL paths", () => {
    it("should accept file:// URLs", () => {
      const filePath = getDbPath("url-test.db");
      const fileUrl = new URL(`file://${filePath}`);
      const db = new DatabaseSync(fileUrl);
      expect(db.isOpen).toBe(true);
      // Note: SQLite may normalize the path, so we check the actual path
      expect(db.location()).toContain("url-test.db");
      db.close();
    });

    it("should accept file:// URL strings", () => {
      const filePath = getDbPath("url-string-test.db");
      const fileUrlString = `file://${filePath}`;
      const urlObj = { href: fileUrlString };
      const db = new DatabaseSync(urlObj as any);
      expect(db.isOpen).toBe(true);
      // SQLite returns the converted file path, not the original URL
      expect(db.location()).toBe(filePath);
      db.close();
    });

    it("should reject non-file:// URLs", () => {
      const httpUrl = { href: "http://example.com/test.db" };
      expect(() => {
        new DatabaseSync(httpUrl as any);
      }).toThrow(/Invalid URL scheme/);
    });

    it("should reject URLs with null bytes in href", () => {
      const urlWithNull = { href: "file:///test\0.db" };
      expect(() => {
        new DatabaseSync(urlWithNull as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });

    it("should reject URL objects without href property", () => {
      const invalidUrl = { protocol: "file:" };
      expect(() => {
        new DatabaseSync(invalidUrl as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });
  });

  describe("Invalid path types", () => {
    it("should reject numeric paths", () => {
      expect(() => {
        new DatabaseSync(123 as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });

    it("should reject boolean paths", () => {
      expect(() => {
        new DatabaseSync(true as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });

    it("should reject null paths", () => {
      expect(() => {
        new DatabaseSync(null as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });

    it("should reject undefined paths", () => {
      expect(() => {
        new DatabaseSync(undefined as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });
  });

  describe("Backup path validation", () => {
    let sourceDb: DatabaseSyncInstance;
    const openDbs: DatabaseSyncInstance[] = [];

    beforeEach(() => {
      sourceDb = new DatabaseSync(":memory:");
      sourceDb.exec("CREATE TABLE test (id INTEGER, value TEXT)");
      sourceDb.exec("INSERT INTO test VALUES (1, 'test')");
    });

    afterEach(async () => {
      // Close all databases opened during tests
      for (const db of openDbs) {
        try {
          if (db.isOpen) {
            db.close();
          }
        } catch {
          // Ignore close errors
        }
      }
      openDbs.length = 0;

      if (sourceDb?.isOpen) {
        sourceDb.close();
      }

      // Wait for Windows file handles to be released
      if (process.platform === "win32") {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });

    it("should accept string destination paths", async () => {
      const destPath = getDbPath("backup-string.db");
      await sourceDb.backup(destPath);

      // Verify backup was created
      const verifyDb = new DatabaseSync(destPath);
      openDbs.push(verifyDb);
      const result = verifyDb.prepare("SELECT * FROM test").get();
      expect(result).toEqual({ id: 1, value: "test" });
      verifyDb.close();
    });

    it("should accept Buffer destination paths", async () => {
      const destPath = getDbPath("backup-buffer.db");
      const buffer = Buffer.from(destPath, "utf8");
      await sourceDb.backup(buffer);

      // Verify backup was created
      const verifyDb = new DatabaseSync(destPath);
      openDbs.push(verifyDb);
      const result = verifyDb.prepare("SELECT * FROM test").get();
      expect(result).toEqual({ id: 1, value: "test" });
      verifyDb.close();
    });

    it("should accept file:// URL destination paths", async () => {
      const destPath = getDbPath("backup-url.db");
      const fileUrl = new URL(`file://${destPath}`);
      await sourceDb.backup(fileUrl);

      // Verify backup was created
      const verifyDb = new DatabaseSync(destPath);
      openDbs.push(verifyDb);
      const result = verifyDb.prepare("SELECT * FROM test").get();
      expect(result).toEqual({ id: 1, value: "test" });
      verifyDb.close();
    });

    it("should reject invalid destination paths", () => {
      // Path validation throws immediately for invalid types
      expect(() => {
        sourceDb.backup(123 as any);
      }).toThrow(/must be a string, Buffer, or URL without null bytes/);
    });
  });
});
