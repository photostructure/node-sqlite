/**
 * Stand-in for Node.js's test/common/fixtures.js, used by tests synced from the
 * Node.js repository. Fixtures live in test/fixtures/; the sqlite ones are
 * synced into test/fixtures/sqlite/ by `npm run sync:tests`.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

export function path(...segments) {
  return join(fixturesDir, ...segments);
}

export default { fixturesDir, path };
