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
        // Import extractCallerPath directly without platform switching
        // since it already handles platform detection internally
        it("extracts path from standard format (with Object.<anonymous>)", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Linux
          if (process.platform === "linux") {
            expect(extractCallerPath(linuxStack)).toBe(
              "/home/user/project/test/caller.js",
            );
          }
        });

        it("extracts path from direct format (without Object.<anonymous>)", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Linux
          if (process.platform === "linux") {
            expect(extractCallerPath(linuxDirectStack)).toBe(
              "/home/user/project/test/caller.js",
            );
          }
        });
      });

      describe("Windows stack traces", () => {
        it("extracts path from standard format", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Windows
          if (process.platform === "win32") {
            expect(extractCallerPath(windowsStack)).toBe(
              "C:\\Users\\user\\project\\test\\caller.js",
            );
          }
        });

        it("extracts path from direct format", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Windows
          if (process.platform === "win32") {
            expect(extractCallerPath(windowsDirectStack)).toBe(
              "C:\\Users\\user\\project\\test\\caller.js",
            );
          }
        });

        it("extracts and converts file:// URLs", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Windows
          if (process.platform === "win32") {
            expect(extractCallerPath(windowsFileUrlStack)).toBe(
              "/C:/Users/user/project/test/caller.js",
            );
          }
        });

        it("handles UNC paths", async () => {
          const { extractCallerPath } = await import("../src/stack_path");
          // Only test if we're on Windows
          if (process.platform === "win32") {
            expect(extractCallerPath(windowsUncStack)).toBe(
              "\\\\server\\share\\project\\test\\caller.js",
            );
          }
        });
      });
    });

    describe("error handling", () => {
      it("throws when getCallerDirname is not in stack", async () => {
        const { extractCallerPath } = await import("../src/stack_path");
        const stack = "Error\n    at someOtherFunction (/path/to/file.js:1:1)";
        expect(() => extractCallerPath(stack)).toThrow(
          "Invalid stack trace format: missing caller frame",
        );
      });

      it("throws when no frames after getCallerDirname match patterns", async () => {
        const { extractCallerPath } = await import("../src/stack_path");
        const stack = `Error\n    at getCallerDirname (/path/to/file.js:1:1)`;
        expect(() => extractCallerPath(stack)).toThrow(
          "Invalid stack trace format: no parsable frames",
        );
      });

      it("throws when stack contains only internal frames after getCallerDirname", async () => {
        const { extractCallerPath } = await import("../src/stack_path");
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
    it("returns the correct directory when called from a module", async () => {
      // Import and test the actual function
      const { getCallerDirname } = await import("../src/stack_path");
      const result = getCallerDirname();

      // Should return the directory of this test file
      // Use a platform-agnostic way to check that it ends with the test directory
      expect(result).toMatch(/[/\\]test$/);
    });
  });
});
