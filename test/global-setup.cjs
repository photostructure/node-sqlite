const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = function globalSetup() {
  const extensionDir = path.join(__dirname, "fixtures", "test-extension");
  process.env.TEST_EXTENSION_BUILT = "0";
  try {
    execFileSync(process.execPath, ["build.js"], {
      cwd: extensionDir,
      stdio: "inherit",
    });
    process.env.TEST_EXTENSION_BUILT = "1";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Test extension build failed; extension-dependent tests will be skipped: ${message}`,
    );
  }
};
