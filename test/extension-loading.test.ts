import { DatabaseSync } from "../src";

describe("Extension Loading Tests", () => {
  describe("allowExtension option", () => {
    test("extension loading is disabled by default", () => {
      const db = new DatabaseSync(":memory:");

      // Should not be able to enable extension loading
      expect(() => {
        db.enableLoadExtension(true);
      }).toThrow(
        /Cannot enable extension loading because it was disabled at database creation/,
      );

      db.close();
    });

    test("can enable extension loading when allowExtension is true", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });

      // Should not throw
      expect(() => {
        db.enableLoadExtension(true);
      }).not.toThrow();

      // Disable it again
      expect(() => {
        db.enableLoadExtension(false);
      }).not.toThrow();

      db.close();
    });

    test("allowExtension option works with open method", () => {
      const db = new DatabaseSync();
      db.open({
        location: ":memory:",
        allowExtension: true,
      });

      // Should be able to enable extension loading
      expect(() => {
        db.enableLoadExtension(true);
      }).not.toThrow();

      db.close();
    });
  });

  describe("enableLoadExtension method", () => {
    test("requires boolean argument", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });

      expect(() => {
        (db as any).enableLoadExtension();
      }).toThrow(/The "allow" argument must be a boolean/);

      expect(() => {
        (db as any).enableLoadExtension("true");
      }).toThrow(/The "allow" argument must be a boolean/);

      expect(() => {
        (db as any).enableLoadExtension(1);
      }).toThrow(/The "allow" argument must be a boolean/);

      db.close();
    });

    test("throws when database is closed", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.close();

      expect(() => {
        db.enableLoadExtension(true);
      }).toThrow(/Database is not open/);
    });

    test("can toggle extension loading on and off", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });

      // Enable
      db.enableLoadExtension(true);

      // Disable
      db.enableLoadExtension(false);

      // Re-enable
      db.enableLoadExtension(true);

      db.close();
    });
  });

  describe("loadExtension method", () => {
    test("requires string path argument", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      expect(() => {
        (db as any).loadExtension();
      }).toThrow(/The "path" argument must be a string/);

      expect(() => {
        (db as any).loadExtension(123);
      }).toThrow(/The "path" argument must be a string/);

      db.close();
    });

    test("throws when extension loading is not allowed", () => {
      const db = new DatabaseSync(":memory:");

      expect(() => {
        db.loadExtension("some-extension.so");
      }).toThrow(/Extension loading is not allowed/);

      db.close();
    });

    test("throws when extension loading is not enabled", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      // Don't call enableLoadExtension(true)

      expect(() => {
        db.loadExtension("some-extension.so");
      }).toThrow(/Extension loading is not enabled/);

      db.close();
    });

    test("throws when database is closed", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);
      db.close();

      expect(() => {
        db.loadExtension("some-extension.so");
      }).toThrow(/Database is not open/);
    });

    test("attempts to load non-existent extension", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      // This should fail because the file doesn't exist
      expect(() => {
        db.loadExtension("/nonexistent/extension.so");
      }).toThrow(/Failed to load extension/);

      db.close();
    });

    test("accepts optional entry point parameter", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      // This should also fail, but tests that the API accepts two parameters
      expect(() => {
        db.loadExtension("/nonexistent/extension.so", "sqlite3_extension_init");
      }).toThrow(/Failed to load extension/);

      db.close();
    });
  });

  describe("security considerations", () => {
    test("extension loading must be explicitly allowed at creation", () => {
      // Create database without allowExtension
      const db1 = new DatabaseSync(":memory:");
      expect(() => {
        db1.enableLoadExtension(true);
      }).toThrow(/Cannot enable extension loading/);
      db1.close();

      // Create database with allowExtension: false
      const db2 = new DatabaseSync(":memory:", { allowExtension: false });
      expect(() => {
        db2.enableLoadExtension(true);
      }).toThrow(/Cannot enable extension loading/);
      db2.close();

      // Only works with explicit allowExtension: true
      const db3 = new DatabaseSync(":memory:", { allowExtension: true });
      expect(() => {
        db3.enableLoadExtension(true);
      }).not.toThrow();
      db3.close();
    });

    test("requires two-step process to load extensions", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });

      // Step 1: Must explicitly allow at creation (done above)

      // Step 2: Must enable loading
      db.enableLoadExtension(true);

      // Only then can extensions be loaded
      expect(() => {
        db.loadExtension("/some/extension.so");
      }).toThrow(/Failed to load extension/); // Fails because file doesn't exist, not because of permissions

      db.close();
    });
  });
});
