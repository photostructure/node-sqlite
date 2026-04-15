---
name: prep-release
description: Prepare a new release of @photostructure/sqlite. Syncs upstream Node.js + SQLite sources, updates npm deps, reviews commits since last release, decides semver bump (patch/minor/major), writes a CHANGELOG.md entry, and runs the full test+lint suite. Use when the user asks to "prep a release", "cut a release", "update everything and release", "sync upstream and release", or similar.
---

# Prep Release

Prepare @photostructure/sqlite for a new release. This skill does NOT publish — it leaves the repo in a state where a human can trigger the GitHub Actions `Build & Release` workflow with the chosen version bump.

## Critical constraints

- **NEVER bump the `version` field in `package.json`** — the release GitHub Action (`.github/workflows/build.yml`) handles `npm version` based on the workflow_dispatch input (`patch` | `minor` | `major`). Manual bumps break the workflow.
- **NEVER modify files under `src/upstream/`** — they are overwritten by sync scripts.
- **Work on the designated branch** the session was started with (e.g. `claude/release-prep-automation-*`), NOT on `main`.
- **Do NOT create a git tag, run `npm publish`, or create a GitHub release.** Those steps are the release workflow's job.

## Workflow

Create a todo list with TodoWrite for the steps below and work through them sequentially. Many steps run long (`npm run test:all`, `npm run precommit`) — surface failures immediately rather than pressing on.

### 1. Preflight

- Confirm current branch (`git branch --show-current`) matches the development branch specified for this session.
- `git status` must be clean (or have only intentional in-progress work). Stash/commit anything unexpected before proceeding.
- `git fetch --tags origin` so the latest release tag is visible.
- Identify the last release:
  - Latest `vX.Y.Z` tag: `git ls-remote --tags origin | awk '/refs\/tags\/v[0-9]/ {print $2}' | sort -V | tail -1`
  - Cross-check with the top entry in `CHANGELOG.md` and the `version` field in `package.json` (they should already agree).
- Capture baseline values from `package.json` BEFORE syncing, for later diffing:
  - `.versions.nodejs` (e.g. `v25.x-staging@ca2d6ea`) — the Node.js upstream commit we last synced from.
  - `.versions.sqlite` (e.g. `3.52.0`).
  - Current `.version` (last released version).

### 2. Update deps, sync upstream, run full checks

Run the existing precommit orchestrator — it already does ~90% of release prep:

```bash
npm run precommit
```

This runs (see `scripts/precommit.ts`):

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

**If `precommit` fails partway through**, fix the root cause (don't retry blindly) and re-run only the remaining steps individually. Common failures:
- Sync pulls an upstream change that breaks `sqlite_impl.cpp` — port the change.
- A dep major bump breaks a lint — pin it back in `.ncurc.js` reject list or write a codemod.
- Memory/stress tests flake on slow environments — see CLAUDE.md §"Robust Testing Guidelines" before assuming a real regression.

### 3. Review upstream changes

Now the repo has the latest upstream code. Summarize what changed since last release:

**Node.js upstream**: Diff from the old commit (captured in step 1) to the newly-synced commit. The sync script updates `package.json`'s `versions.nodejs` to the new commit. Run:

```bash
# Use the OLD and NEW short SHAs from package.json versions.nodejs
git -C ../node log --oneline <OLD_SHA>..<NEW_SHA> -- lib/sqlite.js src/node_sqlite.cc src/node_sqlite.h
```

If `../node` isn't cloned locally, use GitHub's compare URL: `https://github.com/nodejs/node/compare/<OLD_SHA>...<NEW_SHA>` (view via WebFetch) and filter for the three files above.

Classify each upstream commit:
- **API addition** (new method/option exposed) → MINOR
- **API change or removal** (signature, defaults, error shape) → MAJOR
- **Bug fix, internal refactor, test-only change** → PATCH

**SQLite**: Compare `versions.sqlite` before/after. SQLite's own release notes (https://www.sqlite.org/changes.html) classify changes. SQLite patch releases (3.52.0 → 3.52.1) are always PATCH. Minor bumps (3.51 → 3.52) are usually PATCH for us too unless they add a feature we newly expose.

**Our local commits**: `git log <last-tag>..HEAD --oneline` — categorize feat/fix/chore/breaking per Conventional Commits.

**Dep updates** alone are PATCH unless they bubble up a behavior change we care about.

### 4. Decide semver bump

Pick ONE of `patch | minor | major` based on the highest-severity change from step 3:

- **major** if ANY: breaking API change, removed/renamed exports, default behavior flipped, minimum Node version bumped, TypeScript signature change that breaks callers.
- **minor** if ANY: new exported API, new option/method, new SQLite feature exposed. No breaking changes.
- **patch** otherwise: bug fixes, dep updates, SQLite patch-level bumps, internal refactors, doc updates.

Compute the next version by applying the bump to `package.json`'s current version. **Do not write it back to `package.json`** — just use it for the CHANGELOG heading.

If the bump is ambiguous (e.g. a subtle behavior change that could be called a bug fix OR breaking), stop and ask the user with AskUserQuestion. Include the evidence (commit hash, before/after behavior) so they can decide without scrolling.

### 5. Write the CHANGELOG.md entry

Open `CHANGELOG.md`. Follow the existing style exactly:

- New section header: `## [X.Y.Z]` (no date yet — the release action commits on the release date, and prior entries show the release action leaves the date off until tagged; match whatever the most recent entries do).
- Use these subsections in this order, only including ones that apply: `### Added`, `### Changed`, `### Fixed`, `### Removed`.
- Mark breaking changes with `**BREAKING**:` prefix.
- Lead each bullet with a bold feature name / area: e.g. `- **SQLite 3.52.1**: patch release, no API impact`.
- Keep it terse. Users skim changelogs. One line per change. Link to upstream PRs (`[Node.js PR #12345](...)`) when the change traces back to upstream.
- Add a reference link at the bottom: `[X.Y.Z]: https://github.com/PhotoStructure/node-sqlite/releases/tag/vX.Y.Z`
- If `node:sqlite` API parity changed, mention the Node.js version we're now compatible with (e.g. "API compatible with `node:sqlite` from Node.js v25.10.0").

### 6. Update other docs if needed

- `README.md`: update only if user-visible behavior or install instructions changed.
- `doc/features.md`, `doc/api-reference.md`: update if new features were added (point to CHANGELOG for detail — don't duplicate).
- Do NOT commit `build/docs/` (gitignored).
- Do NOT update `package.json` version.

### 7. Final verification

After CHANGELOG edits:

```bash
npm run lint      # cheap sanity check after doc edits
git diff --stat   # confirm only expected files changed
git status        # no stray untracked files
```

The heavy tests (`test:all`, `memory:check`) already ran in step 2 — no need to re-run unless you touched code after.

### 8. Commit and push

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
git add package.json package-lock.json CHANGELOG.md src/upstream/ src/sqlite_impl.* src/shims/ doc/
git diff --cached    # review before committing
git commit -m "..."
git push -u origin <branch>    # retry up to 4x with 2s/4s/8s/16s backoff on network errors
```

**Do NOT push to `main` directly.** Push to the session's development branch.

### 9. Hand off to user

In your final message, report:

1. **Version bump chosen**: `patch` | `minor` | `major` → next version `X.Y.Z`, with the 1–2 line justification.
2. **Upstream sync summary**:
   - Node.js: `<old-sha>` → `<new-sha>` (N commits to sqlite files)
   - SQLite: `<old>` → `<new>`
3. **Dep updates**: list of major/minor bumps (skip patch bumps unless notable).
4. **CHANGELOG entry**: quote the new section verbatim for the user to review.
5. **Test results**: pass/fail summary from `precommit`.
6. **How to release**: Tell the user to merge this branch to `main`, then trigger the `Build & Release` workflow with input `version = <patch|minor|major>`. The workflow runs `npm version`, tags, publishes to npm with provenance, and creates the GitHub release. Link: https://github.com/photostructure/node-sqlite/actions/workflows/build.yml

## Things worth doing but not required

Mention these to the user if relevant; don't block on them:

- **Benchmarks**: `npm run bench` if perf-sensitive code changed — catches regressions vs. better-sqlite3.
- **Stress tests**: `npm run stress:validate` — worth running if memory/threading code changed.
- **Docker cross-platform**: `npm run test:docker:debian` and `test:docker:alpine` — catches glibc/musl divergence before CI does.
- **Check open Dependabot/Snyk alerts** are closed or intentionally dismissed.
- **Check open issues/PRs** for anything the user might want to land in this release.
