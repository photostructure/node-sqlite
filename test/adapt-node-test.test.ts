import { adaptFixture, adaptTest } from "../scripts/adapt-node-test";

/** Strips the generated header so assertions read against the body alone. */
function body(adapted: string): string {
  return adapted.replace(/^\/\*\*[\s\S]*?\*\/\n\n/, "");
}

describe("adaptTest", () => {
  it("drops a destructured ../common require and its skip call", () => {
    const adapted = body(
      adaptTest(
        [
          "'use strict';",
          "const { skipIfSQLiteMissing } = require('../common');",
          "skipIfSQLiteMissing();",
          "",
          "const assert = require('node:assert');",
          "",
        ].join("\n"),
        "test-sqlite-example.js",
      ),
    );

    expect(adapted).toBe(
      "'use strict';\nconst assert = require('node:assert');\n",
    );
  });

  it("drops a namespaced ../common require and its skip call", () => {
    // test-sqlite-authz.js binds the whole helper module rather than
    // destructuring it. Removing only `require('../common');` there leaves the
    // dangling `const common =` to swallow the next statement.
    const adapted = body(
      adaptTest(
        [
          "'use strict';",
          "",
          "const common = require('../common');",
          "common.skipIfSQLiteMissing();",
          "",
          "const assert = require('node:assert');",
          "",
        ].join("\n"),
        "test-sqlite-authz.js",
      ),
    );

    expect(adapted).toBe(
      "'use strict';\n\nconst assert = require('node:assert');\n",
    );
  });

  it("drops a bare ../common require", () => {
    const adapted = body(
      adaptTest(
        ["'use strict';", "require('../common');", "const x = 1;", ""].join(
          "\n",
        ),
        "test-sqlite-example.js",
      ),
    );

    expect(adapted).toBe("'use strict';\nconst x = 1;\n");
  });

  it("rejects a ../common helper it cannot adapt", () => {
    // A surviving `common.` reference is a ReferenceError at test time, and
    // only in the generated file -- fail here instead, naming the source.
    expect(() =>
      adaptTest(
        [
          "'use strict';",
          "const common = require('../common');",
          "common.platformTimeout(100);",
          "",
        ].join("\n"),
        "test-sqlite-example.js",
      ),
    ).toThrow(/test-sqlite-example\.js.*common\.platformTimeout/s);
  });

  it("points node:sqlite imports at this package", () => {
    const adapted = body(
      adaptTest(
        "const { DatabaseSync } = require('node:sqlite');\n",
        "test-sqlite-example.js",
      ),
    );

    expect(adapted).toBe(
      'const { DatabaseSync } = require("@photostructure/sqlite");\n',
    );
  });

  it("drops an index.mjs import that only asked for skipIfSQLiteMissing", () => {
    const adapted = body(
      adaptTest(
        [
          "import { skipIfSQLiteMissing } from '../common/index.mjs';",
          "skipIfSQLiteMissing();",
          "const x = 1;",
          "",
        ].join("\n"),
        "test-sqlite-example.mjs",
      ),
    );

    expect(adapted).toBe("const x = 1;\n");
  });

  it("re-imports index.mjs helpers from test-utils.mjs, once each", () => {
    // test-sqlite-backup.mjs imports isWindows from index.mjs and also has a
    // tmpdir import; the tmpdir rewrite already binds isWindows, and binding
    // it twice is a SyntaxError in ESM.
    const adapted = body(
      adaptTest(
        [
          "import {",
          "  isWindows,",
          "  skipIfSQLiteMissing,",
          "  spawnPromisified,",
          "} from '../common/index.mjs';",
          "import tmpdir from '../common/tmpdir.js';",
          "skipIfSQLiteMissing();",
          "",
        ].join("\n"),
        "test-sqlite-example.mjs",
      ),
    );

    expect(adapted).toBe(
      [
        'import { spawnPromisified } from "../common/test-utils.mjs";',
        'import { tmpdir, isWindows } from "../common/test-utils.mjs";',
        "",
      ].join("\n"),
    );
  });

  it("rejects an index.mjs helper test-utils.mjs does not provide", () => {
    expect(() =>
      adaptTest(
        "import { platformTimeout } from '../common/index.mjs';\n",
        "test-sqlite-example.mjs",
      ),
    ).toThrow(/test-sqlite-example\.mjs.*platformTimeout/s);
  });

  it("points a fixtures import at the stand-in", () => {
    const adapted = body(
      adaptTest(
        "import fixtures from '../common/fixtures.js';\n",
        "test-sqlite-example.mjs",
      ),
    );

    expect(adapted).toBe('import fixtures from "../common/fixtures.mjs";\n');
  });

  it("leaves a require of the index.mjs stand-in alone", () => {
    // test-sqlite-config.js loads the ESM helper module from CJS; our
    // test/common/index.mjs serves that path.
    const source =
      "const { skipIfSQLiteMissing } = require('../common/index.mjs');\n";

    expect(body(adaptTest(source, "test-sqlite-config.js"))).toBe(source);
  });

  it("leaves a ../common/gc require inside a skipped test alone", () => {
    // test-sqlite-session.js requires { gcUntil, onGC } inside a test that
    // skipTests disables; the body is parsed but never runs.
    const source = "const { gcUntil, onGC } = require('../common/gc');\n";

    expect(body(adaptTest(source, "test-sqlite-session.js"))).toBe(source);
  });

  it("rejects a ../common module it has no stand-in for", () => {
    // Left alone this is ERR_MODULE_NOT_FOUND from the generated file.
    expect(() =>
      adaptTest(
        "import { platformTimeout } from '../common/platform.mjs';\n",
        "test-sqlite-example.mjs",
      ),
    ).toThrow(/test-sqlite-example\.mjs.*\.\.\/common\/platform\.mjs/s);
  });
});

describe("adaptFixture", () => {
  it("points a fixture's node:sqlite import at this package", () => {
    const adapted = adaptFixture(
      "import { backup, DatabaseSync } from 'node:sqlite';\n",
      "backup-last-request.mjs",
    );

    expect(adapted).toMatch(/^\/\/ Node\.js SQLite test fixture, adapted from/);
    expect(adapted).toMatch(/AUTO-GENERATED/);
    expect(
      adapted.endsWith(
        'import { backup, DatabaseSync } from "@photostructure/sqlite";\n',
      ),
    ).toBe(true);
  });
});
