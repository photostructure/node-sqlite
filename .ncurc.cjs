/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 12,
  peer: true,

  // Jest is held at 30.4.2: 30.5.1 prepends the checkout directory to absolute
  // source paths in mapped stack traces on Windows, so every mapped frame
  // reads C:\repro\C:\repro\foo.test.js and the Windows CI job fails.
  // See https://github.com/jestjs/jest/issues/16438 — re-check before removing.
  reject: ["jest"],

  // TypeScript is held on the 6.x line: TypeScript 7 is not yet supported by
  // our toolchain.
  //   - typedoc 0.28.20 (latest stable) peers typescript "5.0.x || ... || 6.0.x"
  //   - typescript-eslint 8.63.0 peers typescript ">=4.8.4 <6.1.0"
  // Re-check both peerDependencies ranges before removing this pin.
  target: (name) => (name === "typescript" ? "minor" : "latest"),
};
