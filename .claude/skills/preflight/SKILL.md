---
name: preflight
description: Prepare a new release of @photostructure/sqlite. Syncs upstream Node.js + SQLite sources, updates npm deps, reviews commits since last release, decides semver bump (patch/minor/major), writes a CHANGELOG.md entry, and runs the full test+lint suite. Use when the user asks to "prep a release", "cut a release", "update everything and release", "sync upstream and release", or similar.
---

# Preflight

Prepare @photostructure/sqlite for a new release. This skill does not publish: it leaves the repo ready for a maintainer to run the `Build & Release` workflow with the chosen version bump.

**Done means**:

1. Every upstream PR in §3 list 2 has a disposition in `.cache/preflight-tasks.md`: ported, already matched, not applicable, or deferred with the user's agreement (§3).
2. `npm run preflight` (or every §2.5 step) passes on the final tree, after any ports.
3. The CHANGELOG entry and doc version strings are written.
4. The release-prep commit is pushed after the user approved it. On a cloud VM, the PR is open.
5. The §9 hand-off is sent.

**Stop and ask** when the semver call is ambiguous (§4), before deferring an upstream PR, when a step fails for a reason that neither §3.5 nor a baseline re-run explains, and before every commit and push. Otherwise keep going.

## Constraints

- AGENTS.md applies. In particular, never bump `version` in `package.json` (the `Build & Release` workflow runs `npm version` from its `patch` | `minor` | `major` input), and never edit `src/upstream/`.
- Don't create a git tag, run `npm publish`, or create a GitHub release. The release workflows do that.
- The branch depends on `echo $USER`:
  - `mrm` (local hardware): commit on `main`, which is how the maintainer drives releases. Don't open a PR.
  - Anything else (an Anthropic cloud VM): work on the `claude/*` branch the session started on, push to that branch, and open a PR. Never push to `main`.

## Workflow

Keep a checklist of the steps below in `.cache/preflight-tasks.md`, which is gitignored and survives `npm run clean`. Replace a copy left over from an earlier release. Tick each step when it's done, and add anything new you find. After a context summary, read that file to find the current step. Report each failure as soon as it happens instead of pressing on.

### 1. Repo state checks

1. Confirm the branch matches Constraints: `git branch --show-current`.
2. `git status` must be clean, apart from intentional in-progress work. Stash or commit anything unexpected before proceeding.
3. Run `git fetch --tags origin`, then find the last release with `git describe --tags --abbrev=0 --match 'v[0-9]*'`. It should agree with the top entry in `CHANGELOG.md` and with `version` in `package.json`.
4. Before syncing, record `versions.nodejs`, `versions.sqlite`, and `version` from `package.json`, and the README's `Synced with Node.js vX.Y.Z` and `compatible with Node.js vX.Y.Z` strings. §6 and §9 compare against these.

### 2. Update deps, sync upstream, run full checks

```bash
npm run preflight
```

`scripts/preflight.ts` is the list of what this runs: dependency updates, `sync:node`, `sync:tests`, `sync:sqlite`, formatting, lint, builds, every test suite, and `memory:check`.

`test:api` fails on Node < 25: it compares constants against the host's `node:sqlite`, which exposes fewer constants on Node 22 than on Node 25. Before reporting it as pre-existing, `git stash`, re-run, and confirm the baseline fails the same way.

### 2.5. When `npm run preflight` can't finish

The orchestrator needs tools that ephemeral environments may lack (osv-scanner, snyk, pinact, docker, valgrind, clang-tidy), and a GitHub token. `update:pinact` and the `sync:*` scripts each take a token from `gh auth token` in their own process. Without `gh` or `GITHUB_TOKEN`, they share GitHub's 60 requests/hour limit, and pinact's `always: true` re-verifies every pinned action on each run, so `update:pinact` and `sync:tests` fail once that budget is spent. Don't export the token for `npm run preflight`: every step would inherit it, including the freshly synced upstream tests under `test:node`.

If it can't finish, don't skip steps. Run them individually in this order and report each failure:

```bash
npm install
npx --no-install npm-check-updates -u          # respects .ncurc.cjs
npm install                                    # re-resolve lockfile
npm run sync:node
npm run sync:sqlite
npm run sync:tests                             # see §3.5 for common failures here
npx prettier --cache --write test/node-compat/ test/fixtures/sqlite/ # see §3.5 D
npm run build:native
npm run build:dist
npm run lint
node --expose-gc node_modules/jest/bin/jest.js --no-coverage
npm run test:node
npm run test:api                               # fails on Node < 25; see §2
```

- `sync:node` caches the last-synced upstream SHA in `.sync-cache.json`, and `sync:tests` in `.sync-tests-cache.json`. After you change a sync script's skip list or transforms, re-run it with `--force` (e.g. `npx tsx scripts/sync-node-tests.ts --force`), or the unchanged SHA skips the download.
- If `ncu` proposes a major bump on `typescript`, `typedoc`, `eslint`, `jest`, or `typescript-eslint`, check peer-dependency ranges before accepting; these packages constrain each other. Current pins and their reasons are comments in `.ncurc.cjs`. When you add a pin, add a comment citing the blocker so the next engineer doesn't remove it early.

### 3. Review upstream changes

Now the repo has the latest upstream code. Summarize what changed since last release:

**Node.js upstream**: `versions.nodejs` names a commit on a `vNN.x-staging` branch, and Node.js rebases those branches while preparing releases, so the SHA captured in step 1 is often gone within days (`bc26176`, synced 2026-09-28, was no longer on `v26.x-staging` two days later). Don't diff SHA ranges or GitHub compare URLs. Work from file contents, which a rebase doesn't change:

1. **The delta in our tree**: `git diff <last-tag> -- src/upstream/`. This is what you reason about when porting.
2. **The upstream PRs behind it**: the script below finds the newest staging commit at which every synced file matches the last release, then lists the commits after it with their `PR-URL:` trailers. Commits that touch only tests can appear in both this release's list and the previous one's.
3. **PRs on `main` that aren't on staging**: PRs that landed on `main` since the last release's sync and haven't reached the staging branch. Most arrive with a later sync. PRs labeled `semver-major` or `dont-land-on-vNN.x` never reach this staging branch; list them in the hand-off (§9). In October 2026, `deps: update V8 to 15.2` ([#65161](https://github.com/nodejs/node/pull/65161), semver-major) edited `node_sqlite.cc` on `main` only.

Don't build either list from GitHub's `label:sqlite is:merged` search. PRs landed with `git node land` show as Closed rather than Merged (8 of the 57 that touched sqlite files on `main` in August and September 2026), and some sqlite PRs carry no `sqlite` label: [#65988](https://github.com/nodejs/node/pull/65988), which renamed `DatabaseSync` and `StatementSync`, had none.

The script needs `../node` with a remote named `upstream` that points at nodejs/node. If `../node` is missing, run `git clone -o upstream --filter=blob:none https://github.com/nodejs/node.git "$PROJECT_ROOT/../node"`; the script reads only commits and trees, which a blobless clone has.

```bash
set -e
PROJECT_ROOT=$(git rev-parse --show-toplevel)
NODE=$PROJECT_ROOT/../node
BRANCH=$(jq -r '.versions.nodejs | split("@")[0]' "$PROJECT_ROOT/package.json")
LAST_TAG=$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*')
SYNCED=(lib/sqlite.js src/node_sqlite.h src/node_sqlite.cc deps/sqlite/sqlite.gyp)
PATHS=("${SYNCED[@]}" 'test/parallel/test-sqlite*' test/fixtures/sqlite)
git -C "$NODE" fetch upstream "$BRANCH" main

# Newest staging commit at which each synced file matches the last release
ANCHORS=$(for f in "${SYNCED[@]}"; do
  blob=$(git -C "$PROJECT_ROOT" rev-parse "$LAST_TAG:src/upstream/${f##*/}")
  sha=$(git -C "$NODE" log --format=%H --find-object="$blob" "upstream/$BRANCH" -- "$f" |
    while read -r c; do [ "$(git -C "$NODE" rev-parse "$c:$f")" = "$blob" ] && { echo "$c"; break; }; done)
  [ -n "$sha" ] || { echo "no $BRANCH commit has $LAST_TAG's $f" >&2; exit 1; }
  echo "$sha"
done)
ANCHOR=$(git -C "$NODE" rev-list -1 --topo-order $ANCHORS)

# 2. PRs on staging since the last release
git -C "$NODE" log --format='%h %(trailers:key=PR-URL,valueonly,separator=%x20) %s' "$ANCHOR..upstream/$BRANCH" -- "${PATHS[@]}"

# 3. PRs on main since the last release's sync that aren't on staging
prs() { git -C "$NODE" log --format='%(trailers:key=PR-URL,valueonly)' "$@" -- "${PATHS[@]}" | grep . | LC_ALL=C sort -u; }
SINCE=$(git -C "$PROJECT_ROOT" log -1 --format=%cI "$LAST_TAG" -- src/upstream/)
LC_ALL=C comm -23 <(prs --since="$SINCE" upstream/main) <(prs "upstream/$BRANCH") |
  xargs -rn1 gh pr view --json number,title,labels --jq '"#\(.number) \(.title) [\([.labels[].name | select(test("^semver-|^dont-land"))] | join(","))]"'
```

If it stops with `no vNN.x-staging commit has vX.Y.Z's <file>`, the last release synced content that this staging branch never had. That happens when the sync moves to a new major's staging branch. Build list 2 from the README's `Synced with Node.js vX.Y.Z` tag instead: `git -C "$NODE" fetch --no-tags upstream tag vX.Y.Z`, then `git -C "$NODE" log vX.Y.Z..upstream/$BRANCH -- "${PATHS[@]}"`. That lists every commit since the old major branched from `main`, including PRs that reached us through backports, so use the diff from item 1 to tell which are new.

Classify each upstream commit:
- **API addition** (new method/option exposed) → MINOR
- **API change or removal** (signature, defaults, error shape) → MAJOR
- **Bug fix, internal refactor, test-only change** → PATCH

`src/upstream/` is reference only; the shipped code is `src/sqlite_impl.cpp`, our port of `node_sqlite.cc`. Record one disposition per PR in list 2 in `.cache/preflight-tasks.md`:

- **Ported**: you made the same change in our code, with a test that covers it. A synced node-compat test that passes under `test:node` counts.
- **Already matched**: our code already behaves this way. Name the code or test that shows it.
- **Not applicable**: the change can't reach our code, such as a V8 or Node.js build change. Say why.
- **Deferred**: only after the user agrees. Record their answer.

Node.js fixes that touch callback lifetimes, error propagation, or memory management (including musl crash fixes) usually need a port. Pure stylistic refactors usually don't. A test-only PR is covered when its synced test passes under `test:node`, or is skipped per §3.5 C.

**SQLite**: Compare `versions.sqlite` before/after. SQLite's own release notes (https://www.sqlite.org/changes.html) classify changes.
- **Any vendored SQLite version bump is at least MINOR for us** — including patch-level ones (`3.53.3 → 3.53.4`). We statically compile the amalgamation into the shipped binary, so a SQLite bump changes what every consumer runs whether or not we expose a new API. Even a pure bug-fix release changes query results, error paths, and corruption handling reachable through `db.exec()` / `db.prepare()`. Users decide whether to take that on their own schedule, and a PATCH bump denies them the choice. Bump to MAJOR only if the SQLite release carries a documented breaking change we pass through.

**Our local commits**: `git log <last-tag>..HEAD --oneline` — categorize feat/fix/chore/breaking per Conventional Commits.

**Dep updates** alone are PATCH unless they bubble up a behavior change we care about.

### 3.5. When upstream tests fail after sync

`npm run sync:tests` copies every `test-sqlite-*.{js,mjs}` file from Node.js and lightly adapts them. Expect at least one failure class per major sync. Diagnose before skipping:

**A. SyntaxError at parse time** (e.g. `Unexpected identifier 'session'` pointing at a `using` declaration): a synced test uses syntax newer than the Node version the `test:node` job pins (`node-version: [24]` in `build.yml`). The tests only have to parse on that pin, not on every Node the package supports: Node 22 can't parse ERM `using`, and that's fine. The fix is a **post-sync text transform** in `scripts/adapt-node-test.ts`, not a skip — adding to `skipTests` only renames `test()` → `test.skip()`; the body is still parsed and still fails.

The script carries no such transform today: ERM (`using`/`await using`) is all over the synced tests and parses fine on 24. Write one like this when upstream outpaces the pin:

```ts
// Rewrite ERM `using` declarations so the file parses in Node.js < 24 CJS.
// The affected tests are transformed to test.skip() below, so the
// substituted `const` body never actually runs.
adapted = adapted.replace(/\busing\s+(\w+)\s*=/g, "const $1 =");
```

After adding a transform, re-run with `--force` (the SHA cache will otherwise skip the regen), then apply D.

**B. `TypeError: db.X is not a function`**: upstream added a test file for a node:sqlite API we haven't ported yet (recent example: `test-sqlite-serialize.js` for `serialize()`/`deserialize()`). Options:

Ask the user which one applies; skipping the file defers the upstream PR that added the API (§3).

1. **Implement the API**.
2. **Skip the whole file** via `skipFiles` in `scripts/adapt-node-test.ts`. Add a comment with the feature name and a TODO referencing an issue to port it. Example:
   ```ts
   // Tests DatabaseSync.prototype.serialize() / deserialize(), which are
   // Node.js-internal SQLite APIs we have not yet ported. Remove this entry
   // once the APIs are implemented.
   "test-sqlite-serialize.js",
   ```
   Then delete the already-synced `test/node-compat/<name>.test.js` file so it doesn't sit stale in the tree, and re-run `sync:tests --force`.

**C. Per-test skip for behavior we've intentionally diverged on** (e.g. worker-thread races, GC-dependent tests): use the per-file `skipTests` map with an explicit `reason`. This is the only case where the existing skip mechanism is sufficient.

**D. Prettier diff noise**: upstream uses single quotes, our prettier config uses double. After every `sync:tests`, run `npx prettier --cache --write test/node-compat/ test/fixtures/sqlite/` so the committed diff reflects only semantic changes. `sync:tests` also rewrites the fixtures it downloads into `test/fixtures/sqlite/`.

### 4. Decide semver bump

Pick one of `patch | minor | major` based on the highest-severity change from step 3:

- **major** if any: breaking API change, removed/renamed exports, default behavior flipped, minimum Node version bumped, TypeScript signature change that breaks callers.
- **minor** if any: new exported API, new option/method, **any vendored SQLite version bump** (including patch-level, e.g. 3.53.3 → 3.53.4 — always minor regardless of which specific features we expose), new SQLite feature exposed. No breaking changes.
- **patch** otherwise: bug fixes in our own code, dep updates, internal refactors, doc updates — i.e. releases that ship the same SQLite the previous release did.

Compute the next version by applying the bump to `package.json`'s current version. Use it only for the CHANGELOG heading; don't write it to `package.json`.

If the bump is ambiguous (e.g. a subtle behavior change that could be called a bug fix or breaking), stop and ask the user with AskUserQuestion. Include the evidence (commit hash, before/after behavior) so they can decide without scrolling.

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
- If `node:sqlite` API parity changed, mention the Node.js version we're now compatible with (e.g. "API compatible with `node:sqlite` from Node.js v26.10.0").

### 6. Update other docs

- **`README.md` (`Synced with` / `compatible with` strings)**: **manual bump required when syncing from a staging branch**. `scripts/sync-from-node.ts` only auto-updates the README when the sync source is a release tag (`v26.9.0`), not a staging branch (`v26.x-staging`). After a staging sync, determine the latest released Node.js tag whose `src/node_sqlite.cc` and `lib/sqlite.js` contents are fully contained in the synced commit. The simplest check: read `src/node_version.h` at the synced SHA — if it says `MAJOR.MINOR.PATCH` and `NODE_VERSION_IS_RELEASE=0`, then every prior released `vMAJOR.MINOR.(PATCH-1)` is fully contained. Use that as the README reference. Bump both the lead paragraph and the "Features" bullet.
- **`doc/features.md`**: if SQLite bumped, update the SQLite version string. Check for other version-specific callouts that might need refreshing.
- **`doc/api-reference.md`**: update if new APIs were added. Point to CHANGELOG for detail — don't duplicate.

Then list every Node.js and SQLite version string in the user-facing docs, and confirm none still names the versions recorded in step 1 where it should name the new ones:

```bash
grep -rn --include='*.md' "v[0-9][0-9]\.[0-9]\|SQLite 3\.[0-9]" README.md doc/ CHANGELOG.md
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

Use Conventional Commits (see AGENTS.md §"Git Commit Messages"). Typical release-prep commits:

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
git add package.json package-lock.json CHANGELOG.md README.md src/upstream/ src/sqlite_impl.* src/shims/ doc/ scripts/ test/node-compat/ .ncurc.cjs
git diff --cached    # review before committing
git commit -m "..."
git push -u origin <branch>    # retry up to 4x with 2s/4s/8s/16s backoff on network errors
```

On local hardware, push `origin main`. On a cloud VM, push the `claude/*` branch, then open a PR with `mcp__github__create_pull_request` (`base: main`, the branch as `head`). Put in the PR body:

- Version bump chosen + one-line justification
- Upstream sync deltas (Node SHA old → new, SQLite old → new)
- Dep bumps
- Test results summary
- Any pre-existing test failures you confirmed are not regressions (for reviewer context)

### 9. Hand off to user

Start the final message with what the user has to do, then report what changed.

**Needs from you:**

1. **Version bump**: `patch` | `minor` | `major` → next version `X.Y.Z`, with the 1–2 line justification, for the user to confirm.
2. **CHANGELOG entry**: quote the new section verbatim for the user to review.
3. **Commit and push**: on local hardware, the commit you're asking to make and push. On a cloud VM, the PR link.
4. **How to release**: merge this branch/PR to `main`, then follow [RELEASE.md](../../../RELEASE.md): trigger the `Build & Release` workflow with input `version = <patch|minor|major>`, which signs and pushes the version commit and tag, then dispatches `Stage npm Release` at that tag. That second workflow rebuilds the prebuilds, packs one tarball, tests it, and **stages** it on npm — the maintainer must approve the staged package with 2FA before it goes public. Link: https://github.com/photostructure/node-sqlite/actions/workflows/build.yml

**What changed:**

5. **Upstream sync summary**:
   - Node.js: `<old-sha>` → `<new-sha>` (N commits to sqlite files), with each PR's disposition from `.cache/preflight-tasks.md`.
   - Node.js `main` only: the PRs from list 3 in §3, with their labels. Those labeled `semver-major` or `dont-land-on-vNN.x` won't arrive through this staging branch.
   - SQLite: `<old>` → `<new>`
6. **Dep updates**: list of major/minor bumps (skip patch bumps unless notable). Flag any that were pinned back in `.ncurc.cjs` and why.
7. **Test results**: pass/fail summary. Call out pre-existing failures (not regressions) with evidence.
8. **Node-compat test changes**: any new files added to `skipFiles` or new transforms added to `adapt-node-test.ts`. These are likely follow-up work items.

## Things worth doing but not required

Mention these to the user if relevant; don't block on them:

- **Benchmarks**: `npm run bench` if perf-sensitive code changed — catches regressions vs. better-sqlite3.
- **Stress tests**: `npm run stress:validate` — worth running if memory/threading code changed.
- **Docker cross-platform**: `npm run test:docker:debian` and `test:docker:alpine` — catches glibc/musl divergence before CI does.
- **Check open Dependabot/Snyk alerts** are closed or intentionally dismissed.
- **Check open issues/PRs** for anything the user might want to land in this release.
