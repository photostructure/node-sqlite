/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 14,

  // TypeScript is held on the 6.x line: TypeScript 7 is not yet supported by
  // our toolchain.
  //   - typedoc 0.28.20 (latest stable) peers typescript "5.0.x || ... || 6.0.x"
  //   - typescript-eslint 8.63.0 peers typescript ">=4.8.4 <6.1.0"
  // Re-check both peerDependencies ranges before removing this pin.
  target: (name) => (name === "typescript" ? "minor" : "latest"),
};
