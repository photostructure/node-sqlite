/**
 * Text transforms that turn a Node.js SQLite test into one that exercises this
 * package.
 *
 * Kept apart from `sync-node-tests.ts` so the transforms can be unit tested:
 * that module resolves its paths from `import.meta.url`, which ts-jest cannot
 * compile under the CommonJS test config.
 */

// Files that cannot be adapted for our package
const skipFiles = new Set([
  // Uses Node.js --permission flag which is a runtime security feature.
  // As a userland package, we cannot integrate with Node.js's internal
  // permission model. See doc/migrating-from-node-sqlite.md for details.
  "test-permission-sqlite-load-extension.js",

  // Tests webstorage behavior when sqlite is unavailable - not relevant for us
  "test-webstorage-without-sqlite.js",
]);

// Individual tests within files that cannot pass in our standalone package.
// These get transformed to test.skip() with the reason as a comment.
// Keys are original Node.js filenames (without .test. suffix).
const skipTests: Record<string, Array<{ name: string; reason: string }>> = {
  "test-sqlite.js": [
    {
      name: "accessing the node:sqlite module",
      reason: "Tests Node.js built-in module loading",
    },
    {
      name: "can be disabled with --no-experimental-sqlite flag",
      reason: "Tests Node.js CLI flag",
    },
  ],
  "test-sqlite-statement-sync.js": [
    {
      name: "iterator keeps the prepared statement from being collected",
      reason: "Requires --expose-gc flag",
    },
  ],
  "test-sqlite-session.js": [
    {
      name: "concurrent applyChangeset with workers",
      reason: "Worker thread changeset serialization issue",
    },
    {
      name: "session - keeps its database alive after the db handle is dropped",
      reason:
        "Intentional divergence: upstream keeps the database alive via a " +
        "strong reference from Session. We cannot -- commit 4da0638 removed " +
        "Session::database_ref_ because Napi::Reference teardown during GC " +
        "finalization corrupts V8 JIT pages on Alpine/musl (SIGSEGV). We " +
        "detach instead, so an orphaned session reports 'database is not " +
        "open'. Also needs Node's internal ../common/gc helper.",
    },
  ],
  "test-sqlite-template-tag.js": [
    {
      name: "a tag store keeps the database alive by itself",
      reason: "Requires --expose-gc flag",
    },
    {
      name: "tag store prevents circular reference leaks",
      reason:
        "Requires --expose-gc flag and Node.js internal GC test utilities",
    },
  ],
};

/**
 * Transform Node.js test to use our package instead of node:sqlite
 */
function adaptTest(content: string, fileName: string): string {
  let adapted = content;

  // Remove CJS require('../common') with any destructured imports
  // Handles: const { skipIfSQLiteMissing, mustCall, ... } = require('../common');
  adapted = adapted.replace(
    /const\s*\{[^}]+\}\s*=\s*require\(['"]\.\.\/common['"]\);\s*/g,
    "",
  );

  // Remove the namespace binding: const common = require('../common');
  // This has to precede the bare-require rule below: that rule matches the
  // require() alone, leaving `const common =` to swallow the next statement.
  adapted = adapted.replace(
    /const\s+[\w$]+\s*=\s*require\(['"]\.\.\/common['"]\);\s*/g,
    "",
  );

  // Remove bare require('../common'); (no assignment)
  adapted = adapted.replace(/require\(['"]\.\.\/common['"]\);\s*/g, "");

  // Tests reach the helpers either destructured or off the namespace binding
  // removed above. Normalize the two we shim to their bare call so the rules
  // below only have one shape to match.
  adapted = adapted.replace(
    /\bcommon\.(skipIfSQLiteMissing|mustCall)\b/g,
    "$1",
  );

  // Remove ESM import from '../common/index.mjs' with any imports
  // Handles: import { skipIfSQLiteMissing, isWindows, ... } from '../common/index.mjs';
  adapted = adapted.replace(
    /import\s*\{[^}]+\}\s*from\s*['"]\.\.\/common\/index\.mjs['"]\s*;?\s*/g,
    "",
  );

  // Replace tmpdir import with our test utilities
  // Note: Only import tmpdir and isWindows - tests that use tmpdir have their own nextDb
  // Handles ESM: import tmpdir from '../common/tmpdir.js';
  adapted = adapted.replace(
    /import\s+tmpdir\s+from\s*['"]\.\.\/common\/tmpdir\.js['"]\s*;?\s*/g,
    `import { tmpdir, isWindows } from "../common/test-utils.mjs";\n`,
  );

  // Handles CJS: const tmpdir = require('../common/tmpdir');
  adapted = adapted.replace(
    /const\s+tmpdir\s*=\s*require\(['"]\.\.\/common\/tmpdir['"]\);\s*/g,
    `const { tmpdir, isWindows } = require("../common/test-utils.cjs");\n`,
  );

  // Replace require('../sqlite/next-db.js') with our shim
  adapted = adapted.replace(
    /const\s*\{\s*nextDb\s*\}\s*=\s*require\(['"]\.\.\/sqlite\/next-db\.js['"]\);\s*/g,
    `const { nextDb } = require("../common/test-utils.cjs");\n`,
  );

  // Remove skipIfSQLiteMissing() call
  adapted = adapted.replace(/skipIfSQLiteMissing\(\);\s*/g, "");

  // Add mustCall shim if the test uses it - it's a Node.js test helper
  // that verifies a callback is called; we just use an identity function
  if (content.includes("mustCall")) {
    adapted =
      "// Shim for Node.js test helper\nconst mustCall = (fn) => fn;\n\n" +
      adapted;
  }

  // Transform node:sqlite imports to our package
  // Handle CJS: const { DatabaseSync, ... } = require('node:sqlite');
  adapted = adapted.replace(
    /require\(['"]node:sqlite['"]\)/g,
    `require("@photostructure/sqlite")`,
  );

  // Handle ESM: const { DatabaseSync } = await import('node:sqlite');
  adapted = adapted.replace(
    /await import\(['"]node:sqlite['"]\)/g,
    `await import("@photostructure/sqlite")`,
  );

  // Handle ESM: import { DatabaseSync, ... } from 'node:sqlite';
  adapted = adapted.replace(
    /from ['"]node:sqlite['"]/g,
    `from "@photostructure/sqlite"`,
  );

  // Note: We no longer strip __proto__: null since our implementation now
  // correctly returns row objects with null prototype (matching Node.js)

  // Skip known-failing tests for this file by transforming test()/suite() to test.skip()/suite.skip()
  const testsToSkip = skipTests[fileName] ?? [];
  for (const { name, reason } of testsToSkip) {
    // Escape special regex characters in test name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match test('name', ...) or suite('name', ...) with any quote style
    // and transform to test.skip('name', /* reason */ ...) or suite.skip(...)
    adapted = adapted.replace(
      // eslint-disable-next-line security/detect-non-literal-regexp -- `escaped` is sanitized above
      new RegExp(`(test|suite)\\((['"\`])${escaped}\\2`, "g"),
      `$1.skip($2${name}$2 /* ${reason} */`,
    );
  }

  // Every ../common binding has been removed or rewritten by now, so a
  // surviving reference is a helper we have no shim for. Fail here, naming the
  // source file -- left in place it becomes a ReferenceError raised by a
  // generated file that tells the reader not to edit it.
  const unadapted =
    /(?<![\w./])common\.[\w$]+/.exec(adapted) ??
    /require\(['"]\.\.\/common['"]\)/.exec(adapted);
  if (unadapted) {
    throw new Error(
      `${fileName}: cannot adapt \`${unadapted[0]}\` -- Node's ../common test ` +
        `helpers are not available here. Shim it in adaptTest(), or add the ` +
        `file to skipFiles.`,
    );
  }

  // Clean up multiple blank lines
  adapted = adapted.replace(/\n{3,}/g, "\n\n");

  // Add header comment
  const header = `/**
 * Node.js SQLite compatibility test
 * Adapted from: ${fileName}
 * Source: https://github.com/nodejs/node
 *
 * Run with: node --test ${fileName.replace(/\.(m?js)$/, ".test.$1")}
 *
 * AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.
 */

`;

  return header + adapted;
}

/**
 * Convert Node.js test filename
 */
function toTestFileName(nodeFileName: string): string {
  // test-sqlite-foo.js -> test-sqlite-foo.test.js
  // test-sqlite-foo.mjs -> test-sqlite-foo.test.mjs
  return nodeFileName.replace(/\.(m?js)$/, ".test.$1");
}

export { adaptTest, skipFiles, skipTests, toTestFileName };
