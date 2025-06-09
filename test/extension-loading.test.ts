import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "../src";
import { getDirname, rm } from "./test-utils";

describe("Extension Loading Tests", () => {
  // Build the test extension before running tests
  let testExtensionPath: string;

  beforeAll(() => {
    const extensionDir = path.join(getDirname(), "fixtures", "test-extension");

    // Build the extension
    try {
      execSync("node build.js", { cwd: extensionDir, stdio: "inherit" });
    } catch (error) {
      console.error("Failed to build test extension:", error);
      throw new Error("Test extension build failed");
    }

    // SQLite automatically adds the platform-specific extension, so we just provide the base name
    testExtensionPath = path.join(extensionDir, "test_extension");

    // Verify the extension was built - check with actual file extension
    let actualExtensionPath: string;
    if (process.platform === "win32") {
      actualExtensionPath = testExtensionPath + ".dll";
    } else if (process.platform === "darwin") {
      actualExtensionPath = testExtensionPath + ".dylib";
    } else {
      actualExtensionPath = testExtensionPath + ".so";
    }

    if (!fs.existsSync(actualExtensionPath)) {
      throw new Error(`Test extension not found at ${actualExtensionPath}`);
    }
  });
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

  describe("loading real extension", () => {
    test("can load test extension and use its functions", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      // Load the test extension
      expect(() => {
        db.loadExtension(testExtensionPath);
      }).not.toThrow();

      // Test the version function
      const version = db.prepare("SELECT test_extension_version()").get();
      expect(version).toEqual({
        "test_extension_version()": "test-extension-1.0.0",
      });

      // Test the add function
      const sum = db.prepare("SELECT test_extension_add(?, ?)").get(5, 3);
      expect(sum).toEqual({ "test_extension_add(?, ?)": 8 });

      // Test the reverse function
      const reversed = db
        .prepare("SELECT test_extension_reverse(?)")
        .get("hello");
      expect(reversed).toEqual({ "test_extension_reverse(?)": "olleh" });

      db.close();
    });

    test("can load extension with explicit entry point", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      // Load with explicit entry point
      expect(() => {
        db.loadExtension(testExtensionPath, "sqlite3_testextension_init");
      }).not.toThrow();

      // Verify it loaded
      const version = db.prepare("SELECT test_extension_version()").get();
      expect(version).toEqual({
        "test_extension_version()": "test-extension-1.0.0",
      });

      db.close();
    });

    test("extension functions persist after disabling extension loading", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);

      // Load extension
      db.loadExtension(testExtensionPath);

      // Disable extension loading
      db.enableLoadExtension(false);

      // Functions should still work
      const result = db.prepare("SELECT test_extension_add(10, 20)").get();
      expect(result).toEqual({ "test_extension_add(10, 20)": 30 });

      // But can't load new extensions
      expect(() => {
        db.loadExtension(testExtensionPath);
      }).toThrow(/Extension loading is not enabled/);

      db.close();
    });

    test("extension functions work with various data types", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(testExtensionPath);

      // Test with integers
      const intResult = db.prepare("SELECT test_extension_add(42, 8)").get();
      expect(intResult).toEqual({ "test_extension_add(42, 8)": 50 });

      // Test with floats
      const floatResult = db
        .prepare("SELECT test_extension_add(3.14, 2.86)")
        .get();
      expect(floatResult).toEqual({ "test_extension_add(3.14, 2.86)": 6 });

      // Test with null
      const nullResult = db
        .prepare("SELECT test_extension_reverse(NULL)")
        .get();
      expect(nullResult).toEqual({ "test_extension_reverse(NULL)": null });

      // Test with empty string
      const emptyResult = db.prepare("SELECT test_extension_reverse('')").get();
      expect(emptyResult).toEqual({ "test_extension_reverse('')": "" });

      // Test with ASCII string (Unicode reversal is complex)
      const asciiResult = db
        .prepare("SELECT test_extension_reverse(?)")
        .get("abc123");
      expect(asciiResult).toEqual({ "test_extension_reverse(?)": "321cba" });

      db.close();
    });

    test("extension function errors are properly handled", () => {
      const db = new DatabaseSync(":memory:", { allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(testExtensionPath);

      // Wrong number of arguments for add
      expect(() => {
        db.prepare("SELECT test_extension_add(1)").get();
      }).toThrow(/wrong number of arguments/);

      // Wrong number of arguments for reverse
      expect(() => {
        db.prepare("SELECT test_extension_reverse()").get();
      }).toThrow(/wrong number of arguments/);

      db.close();
    });

    test("can load extension in file-based database", async () => {
      const dbPath = path.join(getDirname(), "test-extension.db");

      // Clean up any existing file
      await rm(dbPath);

      const db = new DatabaseSync(dbPath, { allowExtension: true });
      db.enableLoadExtension(true);

      // Load extension
      db.loadExtension(testExtensionPath);

      // Create a table and use extension function
      db.exec("CREATE TABLE test (input TEXT, output TEXT)");
      db.exec(
        "INSERT INTO test VALUES ('world', test_extension_reverse('world'))",
      );

      const result = db.prepare("SELECT * FROM test").get();
      expect(result).toEqual({ input: "world", output: "dlrow" });

      db.close();

      // Clean up
      await rm(dbPath);
    });
  });
});
