/**
 * Text transforms that turn a Node.js SQLite test into one that exercises this
 * package.
 *
 * Kept apart from `sync-node-tests.ts` so the transforms can be unit tested:
 * that module resolves its paths from `import.meta.url`, which ts-jest cannot
 * compile under the CommonJS test config.
 */

// Named exports of test/common/test-utils.{cjs,mjs} that stand in for Node's
// ../common helpers. A test importing anything else from '../common' or
// '../common/index.mjs' fails at sync time (see adaptTest) rather than with a
// ReferenceError from a generated file.
const testUtilsExports = new Set([
  "tmpdir",
  "nextDb",
  "isWindows",
  "spawnPromisified",
  "mustCall",
  "mustCallAtLeast",
  "enoughTestMem",
  "gcUntil",
]);

// Names the tmpdir rewrite in adaptTest() imports on its own. A file that has
// a tmpdir import must not import them a second time from the index.mjs
// rewrite: a duplicate import binding is a SyntaxError in ESM.
const tmpdirRewriteNames = new Set(["tmpdir", "isWindows"]);

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
};

/**
 * The names in a destructured ../common import that the generated file must
 * import from `utilsFile`. skipIfSQLiteMissing goes away (its call is removed
 * in adaptTest), mustCall is shimmed there, and `boundElsewhere` names are
 * bound by another rewrite. Throws on a name test-utils does not provide.
 */
function helpersToImport(
  names: string,
  fileName: string,
  source: string,
  utilsFile: string,
  boundElsewhere: ReadonlySet<string> = new Set(),
): string[] {
  const kept = names
    .split(",")
    .map((name) => name.trim())
    .filter(
      (name) =>
        name !== "" &&
        name !== "skipIfSQLiteMissing" &&
        name !== "mustCall" &&
        !boundElsewhere.has(name),
    );
  const unknown = kept.filter((name) => !testUtilsExports.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `${fileName}: cannot adapt \`${unknown.join(", ")}\` from ` +
        `${source} -- add it to test/common/${utilsFile}.`,
    );
  }
  return kept;
}

/**
 * Transform Node.js test to use our package instead of node:sqlite
 */
function adaptTest(content: string, fileName: string): string {
  let adapted = content;

  // Rewrite a CJS destructured require('../common') to require the helpers
  // test-utils.cjs provides.
  // Handles: const { skipIfSQLiteMissing, enoughTestMem, ... } = require('../common');
  adapted = adapted.replace(
    /const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\.\/common['"]\);\s*/g,
    (_match: string, names: string) => {
      const kept = helpersToImport(
        names,
        fileName,
        "../common",
        "test-utils.cjs",
      );
      return kept.length === 0
        ? ""
        : `const { ${kept.join(", ")} } = require("../common/test-utils.cjs");\n`;
    },
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

  // Rewrite the ESM import from '../common/index.mjs' to import the helpers
  // test-utils.mjs provides. tmpdir and isWindows are left to the tmpdir
  // rewrite when the file has one.
  // Handles: import { skipIfSQLiteMissing, isWindows, ... } from '../common/index.mjs';
  const hasTmpdirImport =
    /import\s+tmpdir\s+from\s*['"]\.\.\/common\/tmpdir\.js['"]/.test(adapted);
  adapted = adapted.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/common\/index\.mjs['"]\s*;?\s*/g,
    (_match: string, names: string) => {
      const kept = helpersToImport(
        names,
        fileName,
        "../common/index.mjs",
        "test-utils.mjs",
        hasTmpdirImport ? tmpdirRewriteNames : undefined,
      );
      return kept.length === 0
        ? ""
        : `import { ${kept.join(", ")} } from "../common/test-utils.mjs";\n`;
    },
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

  // Replace the fixtures helper with our stand-in, which provides path().
  // Handles ESM: import fixtures from '../common/fixtures.js';
  adapted = adapted.replace(
    /import\s+fixtures\s+from\s*['"]\.\.\/common\/fixtures\.js['"]\s*;?\s*/g,
    `import fixtures from "../common/fixtures.mjs";\n`,
  );

  // Replace the GC helper import when gcUntil is the only requested helper.
  // Other exports, such as onGC, need their own compatibility implementation.
  // Handles ESM: import { gcUntil } from '../common/gc.mjs';
  adapted = adapted.replace(
    /import\s*\{\s*gcUntil\s*\}\s*from\s*['"]\.\.\/common\/gc\.mjs['"]\s*;?\s*/g,
    `import { gcUntil } from "../common/test-utils.mjs";\n`,
  );

  // Handles CJS: const { gcUntil } = require('../common/gc');
  adapted = adapted.replace(
    /const\s*\{\s*gcUntil\s*\}\s*=\s*require\(['"]\.\.\/common\/gc['"]\);\s*/g,
    `const { gcUntil } = require("../common/test-utils.cjs");\n`,
  );

  // Replace require('../sqlite/next-db.js') with our shim
  adapted = adapted.replace(
    /const\s*\{\s*nextDb\s*\}\s*=\s*require\(['"]\.\.\/sqlite\/next-db\.js['"]\);\s*/g,
    `const { nextDb } = require("../common/test-utils.cjs");\n`,
  );

  // Remove skipIfSQLiteMissing() call
  adapted = adapted.replace(/skipIfSQLiteMissing\(\);\s*/g, "");

  // Add mustCall shim if the test uses it - it's a Node.js test helper
  // that verifies a callback is called; we just use an identity function.
  // A 'use strict' directive only applies while it precedes every other
  // statement, so the shim goes after it.
  if (content.includes("mustCall")) {
    const shim =
      "// Shim for Node.js test helper\nconst mustCall = (fn) => fn;\n\n";
    const directive = /^(?:\/\/[^\n]*\n)*(['"])use strict\1;\n/.exec(adapted);
    adapted =
      directive === null
        ? shim + adapted
        : directive[0] + shim + adapted.slice(directive[0].length);
  }

  adapted = pointAtThisPackage(adapted);

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
  // source file -- left in place it becomes a ReferenceError (or, for a module
  // path, ERR_MODULE_NOT_FOUND) raised by a generated file that tells the
  // reader not to edit it. Our own stand-ins under test/common/ are the only
  // ../common/ paths allowed through; test-sqlite-config.js reaches
  // skipIfSQLiteMissing via require('../common/index.mjs'), which index.mjs
  // serves. ../common/gc is also let through: the gcUntil rewrites above cover
  // the shapes we can serve, and the remaining references sit inside tests
  // that skipTests disables for needing Node's GC helpers, so the require
  // never runs.
  const unadapted =
    /(?<![\w./])common\.[\w$]+/.exec(adapted) ??
    /require\(['"]\.\.\/common['"]\)/.exec(adapted) ??
    /(?:from|require\()\s*['"]\.\.\/common\/(?!(?:test-utils|index)\.[cm]js['"]|fixtures\.mjs['"]|gc(?:\.mjs)?['"])[^'"]*['"]/.exec(
      adapted,
    );
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
 * Point node:sqlite imports at this package.
 */
function pointAtThisPackage(content: string): string {
  return (
    content
      // CJS: const { DatabaseSync, ... } = require('node:sqlite');
      .replace(
        /require\(['"]node:sqlite['"]\)/g,
        `require("@photostructure/sqlite")`,
      )
      // ESM: const { DatabaseSync } = await import('node:sqlite');
      .replace(
        /await import\(['"]node:sqlite['"]\)/g,
        `await import("@photostructure/sqlite")`,
      )
      // ESM: import { DatabaseSync, ... } from 'node:sqlite';
      .replace(/from ['"]node:sqlite['"]/g, `from "@photostructure/sqlite"`)
  );
}

/**
 * Adapt a script from Node's test/fixtures/sqlite/. The tests spawn these as
 * standalone processes, so only the module specifier has to change.
 */
function adaptFixture(content: string, fileName: string): string {
  const header = `// Node.js SQLite test fixture, adapted from test/fixtures/sqlite/${fileName}
// Source: https://github.com/nodejs/node
//
// AUTO-GENERATED - Do not edit. Run 'npm run sync:tests' to regenerate.

`;
  return header + pointAtThisPackage(content);
}

/**
 * Convert Node.js test filename
 */
function toTestFileName(nodeFileName: string): string {
  // test-sqlite-foo.js -> test-sqlite-foo.test.js
  // test-sqlite-foo.mjs -> test-sqlite-foo.test.mjs
  return nodeFileName.replace(/\.(m?js)$/, ".test.$1");
}

/**
 * Adapted tests among `present` (the names in test/node-compat/) that a sync
 * of `syncedTests` does not write: upstream deleted or renamed their test, or
 * skipFiles now excludes it. The sync only writes files, so these would stay
 * behind and keep running.
 */
function staleTestFiles(
  present: readonly string[],
  syncedTests: readonly string[],
): string[] {
  const written = new Set(syncedTests.map(toTestFileName));
  return present.filter(
    (name) => /\.test\.m?js$/.test(name) && !written.has(name),
  );
}

export {
  adaptFixture,
  adaptTest,
  skipFiles,
  skipTests,
  staleTestFiles,
  toTestFileName,
};
