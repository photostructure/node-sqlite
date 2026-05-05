---
name: review
description: Review code for potential issues and improvements. Use when asked to review specific files, functions, or code sections.
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, WebSearch, Skill, Task
---

# Code Review

Review the mentioned code for potential issues and improvements.

Review critically — don't assume correctness. Question every design choice and flag anything that would fail a production code review.

Always assume any prior git state and file contents you gathered is stale, especially if the user re-runs this skill, or asks to re-read.

## Before you start

Study these project standards and design docs:

- @CLAUDE.md — project conventions, N-API gotchas, anti-patterns, commit guidelines
- @doc/internal/architecture.md — shim layer design and Node.js compatibility approach
- @doc/internal/development.md — build, test, and contribution workflow
- @doc/internal/testing-philosophy.md — exact `node:sqlite` compatibility requirements
- @doc/internal/threading.md and @doc/internal/async-design.md — async/threading patterns
- @doc/internal/worker-implementation.md — worker thread support details

For N-API questions, consult `../node-addon-api/` and `../node-addon-examples/` (cloned siblings) before web search.

**Only report verified bugs — things that are actually wrong.** Do NOT report:

- Style, organization, or naming preferences
- Speculative future risks ("if someone later removes this guard...")
- Feature requests or suggestions disguised as issues
- Things you haven't proven with concrete evidence from the codebase
- Anything in `src/upstream/` — those files are auto-synced from Node.js and must not be modified

For EVERY potential issue, you MUST complete these steps before reporting:

1. **Read the actual code** (not just the diff) — follow the full call chain through C++ shims, native binding, and TypeScript layer
2. **Search for all callers/usages** to understand context — both in `src/`, `test/`, and `test/node-compat/`
3. **Cross-check against `src/upstream/node_sqlite.cc`** for behavior and error messages — we are a drop-in replacement and must match exactly
4. **Construct a concrete failing scenario** — if you can't describe exactly how the bug manifests (including which platform, if platform-specific), it's not an issue
5. **Discard it** if your research shows it's intentional, already handled, or a known cross-platform compromise

**Use subagents when the user has explicitly authorized delegated agent work:**

- **Exploration**: When more than three files need review, or the code spans both C++ and TypeScript layers, spawn explorer subagents (one per file/area) to gather findings
- **Validation**: Before reporting ANY issue, spawn a subagent to verify it — have it trace the full call chain (TS → N-API → C++ → SQLite C API), search for guards/handlers you might have missed, and check upstream Node.js behavior. If the subagent can't confirm the bug, discard it.
- **Iteration**: After your initial analysis, launch a second round of subagents to dig deeper into the most promising findings — check edge cases, race conditions, memory ownership, platform-specific behavior (Alpine/musl, Windows, ARM64 emulation)
- **Refinement**: Are all the diffs a single coherent "story" or "theme"? If not, recommend to the user how the diffs should be split up before committing.

If you find zero real issues after thorough research, say "No issues found" — do not pad the list.

## What to look for

**Drop-in compatibility with `node:sqlite`** (HIGHEST PRIORITY)

- Error messages must match Node.js exactly (including punctuation, casing, argument names) — verify against `src/upstream/node_sqlite.cc`
- Error properties (`code`, `errcode`, `errstr`, `sqliteCode`, `sqliteExtendedCode`, `sqliteCodeName`, `sqliteErrorString`) must all be present where Node.js sets them
- Public API surface (DatabaseSync, StatementSync, Session, options objects) must match Node.js — no extra required parameters, no missing methods
- Behavior in the adapted Node.js test suite (`test/node-compat/`) must continue to pass

**Native code correctness** (C++ / N-API)

- **Type-checking order**: `IsDataView()` must be checked BEFORE `IsBuffer()` (CLAUDE.md documents this — `IsBuffer` matches all ArrayBufferView types)
- **C++ exceptions across C boundaries**: any JavaScript callback invoked from C (SQLite hooks, libuv) must be wrapped in try-catch that catches `Napi::Error` first, then `std::exception`, then `...`. Letting an exception propagate through a C function pointer SIGSEGVs on Alpine/musl. See `src/sqlite_impl.cpp` ApplyChangeset (~lines 1648–1750) for the canonical pattern.
- **Memory ownership**: every `sqlite3_*` allocation has a matching free; every `Napi::Reference` is released; finalizers don't dereference freed pointers
- **Aggregate function context**: only POD types stored in `sqlite3_aggregate_context`; complex state via JSON serialization
- **Permission/authorizer callbacks**: still respect the Node.js permission model where applicable
- **Reads of `src/upstream/`**: ensure no edits there — that directory is auto-synced and must not be modified

**TypeScript layer**

- Types in `src/index.ts` match the Node.js `node:sqlite` type signatures
- No accidental coupling to Node.js internals that aren't shimmed
- JSDoc comments that have drifted from the implementation, or that merely restate the function name without adding value (suggest removing these)
- Dead code — suggest deleting it

**ESM vs CJS dual-build hazards** (always check)

- New exports are reachable from BOTH `import` and `require` consumers — verify in `dist/cjs/` and `dist/esm/` (or `npm run test:all`)
- No top-level `await` in code that ships to CJS
- No `import.meta.url` or `__dirname` assumptions that break in the other module system — use the existing dual-safe helpers
- Dynamic `require()` of project files; prefer static imports so both bundles resolve correctly
- `.cjs` / `.mjs` extension mixing in test files is intentional — flag accidental changes
- `package.json` `exports` map still routes `import` and `require` correctly for any new entry points

**Worker thread safety** (always check)

- No shared mutable C++ state across worker threads without explicit synchronization (mutex, atomic)
- Every JS callback invoked from a non-main thread goes through a `Napi::ThreadSafeFunction` (TSFN); the TSFN is acquired/released correctly and not leaked
- Native handles (DatabaseSync, StatementSync) are not assumed to be transferable across workers — each worker owns its own
- No assumption that `napi_env` from one thread is valid on another
- See @doc/internal/threading.md and @doc/internal/worker-implementation.md for the canonical patterns

**Cross-platform considerations**

- Windows file-locking: directory cleanup must use `fsp.rm()` with `maxRetries`/`retryDelay` (or `useTempDir`/`useTempDirSuite` test utilities)
- Alpine/musl: anything new touching C callbacks needs the try-catch wrapper described above
- ARM64 emulation on x64 CI: heavy/CPU-bound tests should detect emulation and skip when appropriate
- Path handling and SQLite URI filenames work consistently across platforms

**Testing**

- Critical paths and edge cases have coverage — including error paths, parameter binding edge cases, and resource cleanup
- Tests use adaptive timeouts (`getTestTimeout()` from `test-timeout-config.cjs`) instead of hard-coded values
- Tests use `useTempDir` / `useTempDirSuite` rather than manual `fs.rmSync` cleanup
- **Anti-patterns to flag**: arbitrary `setTimeout` to "fix" async cleanup, forced `global.gc()`, `setImmediate` in `afterAll` to silence Jest hang warnings — all mask real resource leaks
- Multi-process tests use explicit synchronization (e.g., `READY` signaling) instead of timing assumptions
- Memory tests use the `testMemoryBenchmark` harness rather than naked timing assertions
- Adapted Node.js tests in `test/node-compat/` still run with `--test-concurrency=1`

**`test/node-compat/` coverage gaps** (always check)

- Any new or changed public API surface must have a corresponding adapted test in `test/node-compat/`
- If the upstream Node.js test exists in `test/upstream/` (reference-only) but is not yet ported to `test/node-compat/`, flag it — that's missing coverage
- New error messages or codes must be exercised by a node-compat test that also runs against the real `node:sqlite` for parity

**Correctness (general)**

- Logic or implementation errors; if correct but surprising, suggest a clearer equivalent or add a single-line comment explaining the *why*
- Don't trust JSDoc, types, or implementation as authoritative — if they disagree, flag it and propose what you believe is correct (it may be that none of impl/jsdoc/test are right)

**Build and release**

- `package.json` version is managed by the release GitHub Action — flag any manual version bump
- New C++ files must be added to `binding.gyp`
- New TypeScript files must respect ESM/CJS dual-build expectations
- No `--no-verify`, `--no-gpg-sign`, or skipped pre-commit hooks unless the user explicitly asked

## Response format

1. Discard any issues that turned out to be noise after research.
2. Sort remaining issues by severity (Critical → High → Medium → Low).

**Step 1 — write up every issue as text first.** For each issue use a short unique ID (e.g. `#A`, `#B`) and include:

- **Priority**: Critical / High / Medium / Low
- **Problem**: What's wrong and the concrete scenario where it fails (note platform if platform-specific)
- **Proof**: The specific code path, upstream reference, or test that demonstrates the bug
- **Solution**: A concrete fix
- **Location**: File and line reference (e.g. `src/sqlite_impl.cpp:1234`)

**Step 2 — only after all issue blocks are written**, use `ask the user directly` to collect accept/veto decisions. The question text is just the ID (e.g. `Accept #A?`) — it is NOT a substitute for the write-up above. Never jump straight to `ask the user directly` without the text write-up; the user can't evaluate `#A` if they've never seen what `#A` is.

## After all issues are addressed

Ask the user if it would be ok to `git add` just the impacted files and commit:

1. Show a list of files you want to `git add`. If only a partial set of diffs are relevant for a given file, mention the line ranges you want to stage.
2. Compose a Conventional Commits message — `<type>(<scope>): <summary>` (under 50 chars on the first line; body explains the *why*) — and use `ask the user directly` to allow the user to edit it.
3. Never bump `package.json` version manually — the release GitHub Action owns that.

If you only need to stage certain chunks of a file, know that historically using interactive mode with `git add` has been problematic.
