/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 12,
  peer: true,

  // Jest is held at 30.4.2: 30.5.1 is broken, and 30.5.2 is addressed. See
  // https://github.com/jestjs/jest/issues/16438 for details. This can be
  // removed in 13 days.
  reject: ["jest"],

  // TypeScript is held on the 6.x line: TypeScript 7 is not yet supported by
  // our toolchain.
  //   - typedoc 0.28.20 (latest stable) peers typescript "5.0.x || ... || 6.0.x"
  //   - typescript-eslint 8.63.0 peers typescript ">=4.8.4 <6.1.0"
  // Re-check both peerDependencies ranges before removing this pin.
  target: (name) => (name === "typescript" ? "minor" : "latest"),
};
