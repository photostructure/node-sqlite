---
name: prep-release
description: Prepare a new release of @photostructure/sqlite. Syncs upstream Node.js + SQLite sources, updates npm deps, reviews commits since last release, decides semver bump (patch/minor/major), writes a CHANGELOG.md entry, and runs the full test+lint suite. Use when the user asks to "prep a release", "cut a release", "update everything and release", "sync upstream and release", or similar.
---

# Prep Release

Prepare @photostructure/sqlite for a new release. This skill does NOT publish — it leaves the repo in a state where a human can trigger the GitHub Actions `Build & Release` workflow with the chosen version bump.

## Critical constraints

- **NEVER bump the `version` field in `package.json`** — the release GitHub Action (`.github/workflows/build.yml`) handles `npm version` based on the workflow_dispatch input (`patch` | `minor` | `major`). Manual bumps break the workflow.
- **NEVER modify files under `src/upstream/`** — they are overwritten by sync scripts.
- **Branch depends on where the session runs** (check `echo $USER`):
  - **Local hardware** (`$USER` is `mrm`): committing on `main` is fine — that's how the maintainer drives releases. No feature branch required.
  - **Anthropic-owned cloud VM** (`$USER` is anything else — a generated/bot user): work on the branch the session was started with (e.g. `claude/release-prep-automation-*`), NOT on `main`.
- **Do NOT create a git tag, run `npm publish`, or create a GitHub release.** Those steps are the release workflow's job.

## Workflow

Create a todo list with TodoWrite for the steps below and work through them sequentially. Many steps run long (`npm run test:all`, `npm run preflight`) — surface failures immediately rather than pressing on.

### 1. Repo state checks

- Determine the environment with `echo $USER` (see Critical constraints). On local hardware (`$USER` is `mrm`), `main` is the expected branch — no action needed. On an Anthropic cloud VM, confirm the current branch (`git branch --show-current`) matches the `claude/*` development branch the session was started on.
- `git status` must be clean (or have only intentional in-progress work). Stash/commit anything unexpected before proceeding.
- `git fetch --tags origin` so the latest release tag is visible.
- Identify the last release:
  - Latest `vX.Y.Z` tag: `git ls-remote --tags origin | awk '/refs\/tags\/v[0-9]/ {print $2}' | sort -V | tail -1`
  - Cross-check with the top entry in `CHANGELOG.md` and the `version` field in `package.json` (they should already agree).
- Capture baseline values from `package.json` BEFORE syncing, for later diffing:
  - `.versions.nodejs` (e.g. `v25.x-staging@ca2d6ea`) — the Node.js upstream commit we last synced from.
  - `.versions.sqlite` (e.g. `3.52.0`).
  - Current `.version` (last released version).
- Note the README's current `Synced with Node.js vX.Y.Z` / `compatible with Node.js vX.Y.Z` strings — you'll need to bump these manually if the upstream sync advances past the referenced release (see §6).

### 2. Update deps, sync upstream, run full checks

Run the existing `preflight` orchestrator — it already does ~90% of release prep:

```bash
npm run preflight
```

This runs (see `scripts/preflight.ts`):

- `npm install` + `npm run update:actions` (pinact)
- `npm-check-updates --upgrade` (respects `.ncurc.js` — pins eslint 9, cools down non-@photostructure deps 7 days)
- `npm install` to re-sync the lockfile
- `npm audit fix`, `npx snyk test --dev`
- `npm run clean`
- `npm run sync:node` — pulls `lib/sqlite.js`, `src/node_sqlite.{h,cc}` from `nodejs/node` (default branch `v25.x-staging`)
- `npm run sync:tests` — pulls Node.js test files
- `npm run sync:sqlite` — pulls the latest SQLite amalgamation from sqlite.org
- `npm run fmt`, `npm run docs`, `npm run lint`, `npm run security`
- `npm run build:dist`, `npm run build:native[:linux]`
- `npm run test:all` (CJS + ESM)
- On Node 22+: `lint:api`, `test:api`, `test:node`
- On Linux/macOS: `lint:native` (clang-tidy)
- `npm run memory:check`

### 2.5. When the `preflight` orchestrator can't run end-to-end

The `preflight` orchestrator depends on a set of tools that aren't always installed in ephemeral environments (osv-scanner, snyk, pinact, docker, valgrind, clang-tidy). It also hits the GitHub API unauthenticated, which rate-limits to 60/hour and will fail sync:tests if you've already burned the budget.

If it can't complete, do NOT skip steps blindly. Run its sub-steps individually in this order and surface each failure:

```bash
npm install
npx --no-install npm-check-updates -u          # respects .ncurc.js
npm install                                    # re-resolve lockfile
npm run sync:node                              # may require GITHUB_TOKEN
npm run sync:sqlite
npm run sync:tests                             # see §3.5 for common failures here
npx prettier --cache --write test/node-compat/ # upstream tests use single quotes; normalize
npm run build:native
npm run build:dist
npm run lint
node --expose-gc node_modules/jest/bin/jest.js --no-coverage
npm run test:node
npm run test:api                               # pre-existing Node-22 failures are not regressions
```

Notes:
- The sync scripts cache the last-seen upstream SHA in `.sync-cache.json`. If you edited a sync script (skip list, a new text transform, etc.) but the upstream SHA hasn't moved, re-run with `--force` (e.g. `npx tsx scripts/sync-node-tests.ts --force`) or the cached SHA will short-circuit the download.
- If `ncu` proposes a major bump on `typescript`, `typedoc`, `eslint`, `jest`, or `typescript-eslint`, check peer-dep compatibility before accepting. These are tightly coupled. Recent real-world examples:
  - `eslint` 10 — pinned in `.ncurc.js` because `typescript-eslint` 8 doesn't support it.
  - `typescript` 6 — pin because `typedoc` 0.28 doesn't support it.
  When you pin, add a comment in `.ncurc.js` citing the blocker so the next engineer doesn't un-pin it prematurely.

### 3. Review upstream changes

Now the repo has the latest upstream code. Summarize what changed since last release:

**Node.js upstream**: Diff from the old commit (captured in step 1) to the newly-synced commit. The sync script updates `package.json`'s `versions.nodejs` to the new commit. Run:

```bash
# Use the OLD and NEW short SHAs from package.json versions.nodejs
git -C ../node log --oneline <OLD_SHA>..<NEW_SHA> -- lib/sqlite.js src/node_sqlite.cc src/node_sqlite.h
```

If `../node` isn't cloned locally, use GitHub's compare URL: `https://github.com/nodejs/node/compare/<OLD_SHA>...<NEW_SHA>` (view via WebFetch) and filter for the three files above.

Also diff `git diff src/upstream/` directly after the sync — the actual delta landing in our tree is usually smaller than the full compare range, and that's what you actually need to reason about.

Classify each upstream commit:
- **API addition** (new method/option exposed) → MINOR
- **API change or removal** (signature, defaults, error shape) → MAJOR
- **Bug fix, internal refactor, test-only change** → PATCH

For non-trivial upstream code deltas, also check whether `src/sqlite_impl.cpp` — our port of `node_sqlite.cc` — needs the same change. Node.js fixes that touch callback lifetimes, error propagation, or memory management usually DO need a port. Pure stylistic refactors usually don't.

**SQLite**: Compare `versions.sqlite` before/after. SQLite's own release notes (https://www.sqlite.org/changes.html) classify changes.
- **Any vendored SQLite version bump is at least MINOR for us** — including patch-level ones (`3.53.3 → 3.53.4`). We statically compile the amalgamation into the shipped binary, so a SQLite bump changes what every consumer runs whether or not we expose a new API. Even a pure bug-fix release changes query results, error paths, and corruption handling reachable through `db.exec()` / `db.prepare()`. Users decide whether to take that on their own schedule, and a PATCH bump denies them the choice. Bump to MAJOR only if the SQLite release carries a documented breaking change we pass through.

**Our local commits**: `git log <last-tag>..HEAD --oneline` — categorize feat/fix/chore/breaking per Conventional Commits.

**Dep updates** alone are PATCH unless they bubble up a behavior change we care about.

### 3.5. When upstream tests fail after sync

`npm run sync:tests` copies every `test-sqlite-*.{js,mjs}` file from Node.js and lightly adapts them. Upstream Node.js moves fast; expect at least one failure class per major sync. Diagnose before skipping:

**A. SyntaxError at parse time** (e.g. `Unexpected identifier 'session'` pointing at a `using` declaration): Node.js has started using ERM (`using`/`await using`) and other newish syntax in tests. Our CI runs on Node 22+, which can't parse these in CJS. The fix is a **post-sync text transform** in `scripts/sync-node-tests.ts`, not a skip — adding to `skipTests` only renames `test()` → `test.skip()`; the body is still parsed and still fails.

Pattern to follow (already present in the script for `using` → `const`):

```ts
// Rewrite ERM `using` declarations so the file parses in Node.js < 24 CJS.
// The affected tests are transformed to test.skip() below, so the
// substituted `const` body never actually runs.
adapted = adapted.replace(/\busing\s+(\w+)\s*=/g, "const $1 =");
```

After adding a transform, re-run with `--force` (the SHA cache will otherwise skip the regen) and `npx prettier --cache --write test/node-compat/`.

**B. `TypeError: db.X is not a function`**: upstream added a test file for a node:sqlite API we haven't ported yet (recent example: `test-sqlite-serialize.js` for `serialize()`/`deserialize()`). Options:

1. **Implement the API** — best, but usually out-of-scope for a release-prep session.
2. **Skip the whole file** via `skipFiles` in `scripts/sync-node-tests.ts`. Add a comment with the feature name and a TODO referencing an issue to port it. Example:
   ```ts
   // Tests DatabaseSync.prototype.serialize() / deserialize(), which are
   // Node.js-internal SQLite APIs we have not yet ported. Remove this entry
   // once the APIs are implemented.
   "test-sqlite-serialize.js",
   ```
   Then delete the already-synced `test/node-compat/<name>.test.js` file so it doesn't sit stale in the tree, and re-run `sync:tests --force`.

**C. Per-test skip for behavior we've intentionally diverged on** (e.g. worker-thread races, GC-dependent tests): use the per-file `skipTests` map with an explicit `reason`. This is the only case where the existing skip mechanism is sufficient.

**D. Prettier diff noise**: upstream uses single quotes, our prettier config uses double. After every `sync:tests`, run `npx prettier --cache --write test/node-compat/` so the committed diff reflects only semantic changes.

### 4. Decide semver bump

Pick ONE of `patch | minor | major` based on the highest-severity change from step 3:

- **major** if ANY: breaking API change, removed/renamed exports, default behavior flipped, minimum Node version bumped, TypeScript signature change that breaks callers.
- **minor** if ANY: new exported API, new option/method, **any vendored SQLite version bump** (including patch-level, e.g. 3.53.3 → 3.53.4 — always minor regardless of which specific features we expose), new SQLite feature exposed. No breaking changes.
- **patch** otherwise: bug fixes in our own code, dep updates, internal refactors, doc updates — i.e. releases that ship the same SQLite the previous release did.

Compute the next version by applying the bump to `package.json`'s current version. **Do not write it back to `package.json`** — just use it for the CHANGELOG heading.

If the bump is ambiguous (e.g. a subtle behavior change that could be called a bug fix OR breaking), stop and ask the user with AskUserQuestion. Include the evidence (commit hash, before/after behavior) so they can decide without scrolling.

### 5. Write the CHANGELOG.md entry

Open `CHANGELOG.md`. Follow the existing style exactly:

- New section header, with an inline link to the release and today's date:
  `## [X.Y.Z](https://github.com/PhotoStructure/node-sqlite/releases/tag/vX.Y.Z) (YYYY-MM-DD)`
  Write the date yourself. **The release action does not fill it in** — it only
  runs `npm version` and `gh release create --generate-notes`, and never edits
  `CHANGELOG.md`. Assuming otherwise is how 1.1.0 through 2.1.0 all shipped
  undated.

  Dates in this file are the maintainer's **local (America/Los_Angeles)** date,
  not UTC. Releases often go out late evening Pacific, by which time UTC has
  already rolled to the next day — so `npm view ... time` (which is UTC) will
  read one day later than the correct entry. If you are back-filling a date from
  npm, convert it to Pacific first:

  ```bash
  TZ=America/Los_Angeles date -d "$(npm view @photostructure/sqlite time --json | jq -r '."X.Y.Z"')" +%F
  ```
- Use these subsections in this order, only including ones that apply: `### Added`, `### Changed`, `### Fixed`, `### Removed`.
- Mark breaking changes with `**BREAKING**:` prefix.
- Lead each bullet with a bold feature name / area: e.g. `- **SQLite 3.52.1**: patch release, no API impact`.
- Keep it terse. Users skim changelogs. One line per change. Link to upstream PRs (`[Node.js PR #12345](...)`) when the change traces back to upstream.
- Do **not** add a reference-style link definition at the bottom of the file —
  the version heading above is a plain inline link. Reference-style links were a
  second place to keep in sync, and it drifted: five releases rendered as dead
  literal `[2.1.0]` text with no definition, while a `[1.3.0]` definition pointed
  at a release that never existed.
- If `node:sqlite` API parity changed, mention the Node.js version we're now compatible with (e.g. "API compatible with `node:sqlite` from Node.js v25.10.0").

### 6. Update other docs

- **`README.md` (`Synced with` / `compatible with` strings)**: **manual bump required when syncing from a staging branch**. `scripts/sync-from-node.ts` only auto-updates the README when the sync source is a release tag (`v25.9.0`), not a staging branch (`v25.x-staging`). After a staging sync, determine the latest released Node.js tag whose `src/node_sqlite.cc` and `lib/sqlite.js` contents are fully contained in the synced commit. The simplest check: read `src/node_version.h` at the synced SHA — if it says `MAJOR.MINOR.PATCH` and `NODE_VERSION_IS_RELEASE=0`, then every prior released `vMAJOR.MINOR.(PATCH-1)` is fully contained. Use that as the README reference. Bump both the lead paragraph and the "Features" bullet.
- **`doc/features.md`**: if SQLite bumped, update the SQLite version string. Check for other version-specific callouts that might need refreshing.
- **`doc/api-reference.md`**: update if new APIs were added. Point to CHANGELOG for detail — don't duplicate.
- Do NOT commit `build/docs/` (gitignored).
- Do NOT update `package.json` version.

Cross-check with a single grep after edits:

```bash
# No old Node-version or SQLite-version strings should linger in user-facing docs.
grep -rn --include='*.md' "v25\.[0-9]\|SQLite 3\.[0-9]" README.md doc/ CHANGELOG.md
```

### 7. Final verification

After CHANGELOG and README edits:

```bash
npm run lint      # cheap sanity check after doc edits
git diff --stat   # confirm only expected files changed
git status        # no stray untracked files
```

The heavy tests (`test:all`, `memory:check`) already ran in step 2 — no need to re-run unless you touched code after.

### 8. Commit, push, and open PR

Use Conventional Commits (see CLAUDE.md §"Git Commit Messages"). Typical release-prep commits:

```
chore(release): prep vX.Y.Z

- Sync Node.js upstream to <new-sha> (lib/sqlite.js, node_sqlite.{h,cc})
- Sync SQLite to <new-version>
- Update npm deps (<brief summary>)
- Add CHANGELOG entry for vX.Y.Z
```

If the sync produced meaningful changes to `src/sqlite_impl.cpp` or shims, split into separate commits (`chore(upstream): sync ...`, `chore(deps): ...`, `docs(changelog): ...`) for reviewability.

Stage explicitly — don't `git add -A`:

```bash
git add package.json package-lock.json CHANGELOG.md README.md src/upstream/ src/sqlite_impl.* src/shims/ doc/ scripts/ test/node-compat/ .ncurc.js
git diff --cached    # review before committing
git commit -m "..."
git push -u origin <branch>    # retry up to 4x with 2s/4s/8s/16s backoff on network errors
```

Where and how you land the commit depends on the environment (`echo $USER`, per Critical constraints):

- **Local hardware** (`$USER` is `mrm`): commit on `main` and push `origin main` — that's the maintainer's normal flow. Always ask before committing/pushing (see CLAUDE.md). Do NOT open a PR.
- **Anthropic cloud VM** (`$USER` is anything else): **do NOT push to `main` directly.** Push to the session's `claude/*` development branch, then open a PR with `mcp__github__create_pull_request` (`base: main`, the branch as `head`). Include in the PR body:
  - Version bump chosen + one-line justification
  - Upstream sync deltas (Node SHA old → new, SQLite old → new)
  - Dep bumps
  - Test results summary
  - Any pre-existing test failures you confirmed are NOT regressions (for reviewer context)

### 9. Hand off to user

In your final message, report:

1. **Version bump chosen**: `patch` | `minor` | `major` → next version `X.Y.Z`, with the 1–2 line justification.
2. **Upstream sync summary**:
   - Node.js: `<old-sha>` → `<new-sha>` (N commits to sqlite files). Flag any commits that required a port to `src/sqlite_impl.cpp`.
   - SQLite: `<old>` → `<new>`
3. **Dep updates**: list of major/minor bumps (skip patch bumps unless notable). Flag any that were pinned back in `.ncurc.js` and why.
4. **CHANGELOG entry**: quote the new section verbatim for the user to review.
5. **Test results**: pass/fail summary. Call out pre-existing failures (not regressions) with evidence.
6. **Node-compat test changes**: any new files added to `skipFiles` or new transforms added to `sync-node-tests.ts`. These are likely follow-up work items.
7. **PR link** (if opened) or push destination.
8. **How to release**: Tell the user to merge this branch/PR to `main`, then trigger the `Build & Release` workflow with input `version = <patch|minor|major>`. The workflow runs `npm version`, tags, publishes to npm with provenance, and creates the GitHub release. Link: https://github.com/photostructure/node-sqlite/actions/workflows/build.yml

## Common gotchas

Learned from real release-prep sessions — consult this list when something surprises you:

- **`src/upstream/` is not the source of truth for implementation.** It's the exact Node.js source verbatim. The actual shipped code is `src/sqlite_impl.cpp` (ported). When upstream changes, ask yourself: "Does my port also need this change?" — fix-for-crash-on-musl commits upstream usually do; pure refactors usually don't.
- **Sync scripts honor `.sync-cache.json`.** If you change the script's transform/skip logic, pass `--force` to re-apply against unchanged upstream.
- **Rate limits.** Unauthenticated GitHub API gives you 60 req/hour across `sync:node`, `sync:tests`, and compare URLs. If you're iterating, export `GITHUB_TOKEN`.
- **Prettier after every sync:tests.** Upstream uses single quotes; our prettier rewrites to double. Without the formatter pass, every re-sync shows a massive noise diff.
- **Node 22 CJS can't parse ERM `using`.** Don't assume the tests will parse just because they ran in Node 25. The rewriter at `scripts/sync-node-tests.ts` handles `using` today; extend it for future Node-only syntax (e.g. import attributes) as needed.
- **`test:api` has a pre-existing failure on Node <25.** It compares constants against the host's `node:sqlite`, which exposes far fewer constants on Node 22 than Node 25. If you inherit this failure, confirm via `git stash` + re-run that it exists on the baseline before calling it a regression.
- **The `Build & Release` action bumps `package.json`, tags, and publishes.** You don't. Ever. If the action's input takes `patch|minor|major`, give it that — don't pre-stage a version commit.
- **Use `AskUserQuestion` when the semver call is ambiguous.** Release decisions are cheap to pause on and expensive to get wrong.

## Things worth doing but not required

Mention these to the user if relevant; don't block on them:

- **Benchmarks**: `npm run bench` if perf-sensitive code changed — catches regressions vs. better-sqlite3.
- **Stress tests**: `npm run stress:validate` — worth running if memory/threading code changed.
- **Docker cross-platform**: `npm run test:docker:debian` and `test:docker:alpine` — catches glibc/musl divergence before CI does.
- **Check open Dependabot/Snyk alerts** are closed or intentionally dismissed.
- **Check open issues/PRs** for anything the user might want to land in this release.
