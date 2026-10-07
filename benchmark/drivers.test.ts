import { execFileSync } from "node:child_process";
import { getTestTimeout, projectRoot } from "../test/test-utils";

interface DiscoveryResult {
  availableDrivers: string[];
  openedPaths: string[];
  closeCount: number;
}

// Run discovery in a fresh CJS process so optional-dependency mocks work the
// same way under both Jest modes and cannot leak into other benchmark tests.
function discoverDrivers(availability: string): DiscoveryResult {
  const script = `
    const Module = require("node:module");
    const originalLoad = Module._load;
    const availability = process.argv[1];
    const openedPaths = [];
    let closeCount = 0;

    Module._load = function(id, ...args) {
      if (id !== "better-sqlite3") {
        return originalLoad.call(this, id, ...args);
      }
      if (availability === "missing package") {
        throw new Error("Cannot find module 'better-sqlite3'");
      }
      return class Database {
        constructor(filename) {
          openedPaths.push(filename);
          if (availability !== "available") throw new Error(availability);
        }
        close() { closeCount++; }
      };
    };

    const { getAvailableDrivers } = require("./benchmark/drivers.ts");
    process.stdout.write(JSON.stringify({
      availableDrivers: getAvailableDrivers(), openedPaths, closeCount
    }));
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "--eval", script, availability],
      {
        cwd: projectRoot(),
        encoding: "utf8",
        timeout: getTestTimeout(10000),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
}

describe("benchmark driver discovery", () => {
  test("omits better-sqlite3 when the package cannot load", () => {
    const result = discoverDrivers("missing package");
    expect(result.availableDrivers).not.toContain("better-sqlite3");
    expect(result.availableDrivers).toContain("@photostructure/sqlite");
  });

  test.each([
    "Could not locate the bindings file",
    "The native module was compiled against a different NODE_MODULE_VERSION",
  ])("omits better-sqlite3 when opening fails: %s", (message) => {
    const result = discoverDrivers(message);
    expect(result.availableDrivers).not.toContain("better-sqlite3");
    expect(result.availableDrivers).toContain("@photostructure/sqlite");
    expect(result.openedPaths).toEqual([":memory:"]);
  });

  test("registers a usable better-sqlite3 and closes the probe database", () => {
    const result = discoverDrivers("available");
    expect(result.availableDrivers).toContain("better-sqlite3");
    expect(result.openedPaths).toEqual([":memory:"]);
    expect(result.closeCount).toBe(1);
  });
});
