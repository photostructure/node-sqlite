import { adaptTest } from "../scripts/adapt-node-test";

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
});
