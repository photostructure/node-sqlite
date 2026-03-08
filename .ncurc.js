/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  cooldown: (packageName) => {
    return packageName.startsWith("@photostructure/") ? 0 : 7;
  },
  reject: [
    "@eslint/js", // eslint 10 not yet supported by typescript-eslint
    "eslint", // eslint 10 not yet supported by typescript-eslint
  ],
};
