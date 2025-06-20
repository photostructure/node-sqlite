import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("stack_path", () => {
  describe("extractCallerPath", () => {
    describe("platform-specific stack parsing", () => {
      const linuxStack = `Error
    at getCallerDirname (/home/user/project/src/stack_path.ts:7:12)
    at Object.<anonymous> (/home/user/project/test/caller.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      const linuxDirectStack = `Error
    at getCallerDirname (/home/user/project/src/stack_path.ts:7:12)
    at /home/user/project/test/caller.js:2:1
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      const windowsStack = `Error
    at getCallerDirname (C:\\Users\\user\\project\\src\\stack_path.ts:7:12)
    at Object.<anonymous> (C:\\Users\\user\\project\\test\\caller.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      const windowsDirectStack = `Error
    at getCallerDirname (C:\\Users\\user\\project\\src\\stack_path.ts:7:12)
    at C:\\Users\\user\\project\\test\\caller.js:2:1
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      const windowsFileUrlStack = `Error
    at getCallerDirname (file:///C:/Users/user/project/src/stack_path.ts:7:12)
    at Object.<anonymous> (file:///C:/Users/user/project/test/caller.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      const windowsUncStack = `Error
    at getCallerDirname (\\\\server\\share\\project\\src\\stack_path.ts:7:12)
    at Object.<anonymous> (\\\\server\\share\\project\\test\\caller.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1126:14)`;

      describe("Linux stack traces", () => {
        let extractCallerPath: (stack: string) => string;
        const originalPlatform = process.platform;

        beforeAll(async () => {
          Object.defineProperty(process, "platform", { value: "linux" });
          jest.resetModules();
          const { extractCallerPath: ecp } = await import("../src/stack_path");
          extractCallerPath = ecp;
        });

        afterAll(() => {
          Object.defineProperty(process, "platform", {
            value: originalPlatform,
          });
        });

        it("extracts path from standard format (with Object.<anonymous>)", () => {
          expect(extractCallerPath(linuxStack)).toBe(
            "/home/user/project/test/caller.js",
          );
        });

        it("extracts path from direct format (without Object.<anonymous>)", () => {
          expect(extractCallerPath(linuxDirectStack)).toBe(
            "/home/user/project/test/caller.js",
          );
        });
      });

      describe("Windows stack traces", () => {
        let extractCallerPath: (stack: string) => string;
        const originalPlatform = process.platform;

        beforeAll(async () => {
          Object.defineProperty(process, "platform", { value: "win32" });
          jest.resetModules();
          const { extractCallerPath: ecp } = await import("../src/stack_path");
          extractCallerPath = ecp;
        });

        afterAll(() => {
          Object.defineProperty(process, "platform", {
            value: originalPlatform,
          });
        });

        it("extracts path from standard format", () => {
          expect(extractCallerPath(windowsStack)).toBe(
            "C:\\Users\\user\\project\\test\\caller.js",
          );
        });

        it("extracts path from direct format", () => {
          expect(extractCallerPath(windowsDirectStack)).toBe(
            "C:\\Users\\user\\project\\test\\caller.js",
          );
        });

        it("extracts and converts file:// URLs", () => {
          expect(extractCallerPath(windowsFileUrlStack)).toBe(
            "/C:/Users/user/project/test/caller.js",
          );
        });

        it("handles UNC paths", () => {
          expect(extractCallerPath(windowsUncStack)).toBe(
            "\\\\server\\share\\project\\test\\caller.js",
          );
        });
      });
    });

    describe("error handling", () => {
      let extractCallerPath: (stack: string) => string;

      beforeAll(async () => {
        jest.resetModules();
        const { extractCallerPath: ecp } = await import("../src/stack_path");
        extractCallerPath = ecp;
      });

      it("throws when getCallerDirname is not in stack", () => {
        const stack = "Error\n    at someOtherFunction (/path/to/file.js:1:1)";
        expect(() => extractCallerPath(stack)).toThrow(
          "Invalid stack trace format: missing caller frame",
        );
      });

      it("throws when no frames after getCallerDirname match patterns", () => {
        const stack = `Error\n    at getCallerDirname (/path/to/file.js:1:1)`;
        expect(() => extractCallerPath(stack)).toThrow(
          "Invalid stack trace format: no parsable frames",
        );
      });

      it("throws when stack contains only internal frames after getCallerDirname", () => {
        const stack = `Error
    at getCallerDirname (/path/to/file.js:1:1)
    at node:internal/modules/cjs/loader:1126:14
    at node:internal/main/run_main_module:17:47`;
        expect(() => extractCallerPath(stack)).toThrow(
          "Invalid stack trace format: no parsable frames",
        );
      });
    });
  });

  describe("getCallerDirname integration", () => {
    const fixturesDir = join(
      __dirname,
      "stack-path-fixtures-" + Math.random().toString(36).slice(2),
    );
    const callerScript = join(fixturesDir, "caller.js");
    const testScript = join(fixturesDir, "test-get-caller.js");

    beforeAll(() => {
      mkdirSync(fixturesDir, { recursive: true });

      // Create a script that calls getCallerDirname from the actual module
      writeFileSync(
        testScript,
        `const { getCallerDirname } = require('${join(__dirname, "../dist/stack_path.js").replace(/\\/g, "\\\\")}')
process.stdout.write(getCallerDirname());`,
      );

      // Create a caller script that requires the test script
      writeFileSync(callerScript, `require('./test-get-caller');`);
    });

    afterAll(() => {
      rmSync(fixturesDir, { recursive: true, force: true });
    });

    it("returns the directory of the calling script", () => {
      const result = execFileSync("node", [callerScript], {
        encoding: "utf8",
        cwd: fixturesDir,
      });
      expect(result).toBe(fixturesDir);
    });
  });
});
