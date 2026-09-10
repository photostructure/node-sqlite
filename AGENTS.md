# AGENTS.md

Shared instructions for every coding agent in this repo. `CLAUDE.md` imports
this file, so Claude Code and Codex read the same rules.

`@photostructure/sqlite` extracts Node.js's built-in SQLite implementation into a standalone addon so every Node.js 22+ release gets the same `DatabaseSync`/`StatementSync` API as `node:sqlite`, plus better-sqlite3 compatibility as a migration path. Upstream `node:sqlite` has been a Release Candidate (Stability 1.2) since Node.js v25.7.0.

## Layout

- `src/index.ts` is the public TypeScript API; `src/binding.cpp` the addon entry; `src/sqlite_impl.{h,cpp}` the port of Node's `node_sqlite.cc`; `src/user_function.{h,cpp}` user-defined functions; `src/shims/` the Node-internals compatibility layer (why it exists: `doc/internal/architecture.md`).
- **`src/upstream/` is synced from Node.js and SQLite by `npm run sync` (`scripts/sync-from-node.ts`, `sync-from-sqlite.ts`, `sync-node-tests.ts`). Never edit those files; the next sync overwrites them.** If upstream behavior looks wrong, check the Node.js source before changing anything.
- `doc/` is hand-written and checked in; `build/docs/` is TypeDoc output (`npm run docs`), gitignored. Plans live in `doc/todo/` and `doc/done/` and follow `doc/reference/TPP-GUIDE.md`. There is no root `TODO.md`.
- Sibling checkouts: `../node-addon-api` and `../node-addon-examples` are required references; `../better-sqlite3` and `../node` are optional.

## N-API

- **For any N-API question, read `../node-addon-api/doc` and `../node-addon-examples` first**, not web search or memory. The Alpine/musl session-callback SIGSEGV was solved by `node-addon-api/doc/error_handling.md` after web results pointed the wrong way.
- **C++ exceptions cannot cross a C callback boundary.** Any JavaScript callback invoked from C (SQLite, libuv) must be wrapped: `try` around the call, catch `Napi::Error` before `std::exception`, then `catch (...)`; store the message, return a safe error code, and rethrow after the C call returns. glibc tolerates the omission; musl segfaults, often later and intermittently. `DatabaseSync::ApplyChangeset` in `src/sqlite_impl.cpp` is the working pattern.
- **Check `IsDataView()` before `IsBuffer()`.** N-API's `IsBuffer()` is `IsArrayBufferView()`, so a DataView passes it and `Buffer::As()` then returns length 0 and a null pointer. The parameter-binding code in `sqlite_impl.cpp` has the comment.
- Aggregate callbacks can't hold a `Napi::Reference` across SQLite calls: convert values immediately, keep only POD in SQLite's aggregate context, and return right after setting an error.
- Async native work uses `Napi::AsyncProgressWorker` (see `BackupJob`), not ad hoc threads.

## Tests

Jest, `test/*.test.ts`, run with `npm test` (builds `dist` first) or `npm run test:all` for CJS plus ESM. Error tests assert behavior and SQLite error codes, not exact message text; see `doc/internal/testing-philosophy.md`.

- Use the helpers in `test/test-utils.ts`: `useTempDir` / `useTempDirSuite` (Windows-safe cleanup; SQLite files stay locked longer there, so a bare `fs.rm` hits `EBUSY`), `getTestTimeout()` for Jest timeouts, `getTimingMultiplier()` for custom waits, `isAlpineLinux()` / `isEmulated()` to skip work that can't finish under ARM64 emulation. Memory tests go through `testMemoryBenchmark` in `test/benchmark-harness.ts`.
- Close every database and cancel every async operation the test started. If Jest reports an open handle or "did not exit", find the handle (`--detectOpenHandles`). Sleeping, `global.gc()`, `setImmediate` in `afterAll`, and `--forceExit` are not fixes.
- Await the condition, never the clock: multi-process tests wait for the child's `READY`/`LOCK_ACQUIRED` output before acting. Timing assertions use ranges with a CI-sized margin.
- Values that change under you (`freelist_count`, free space) get type and structure assertions; stable values (`page_size`) get equality. Test data is seeded, not `Math.random()` or `Date.now()`.
- Error messages differ by platform; match with a regex on the stable part.
- CI runners are not uniform: Windows and macOS are roughly 4x slower than Ubuntu, Alpine ARM64 about 10x (musl plus emulation). Tests share runners, so no fixed ports or global state.

## Build and release

- npm scripts follow `<action>[:<target>[:<variant>]]`: `test`, `test:all`, `lint`, `lint:full` (adds native lint and API checks), `build:native:rebuild`, `preflight` (everything that must pass before a release). No hidden lifecycle hooks; aggregates list what they run.
- **Never bump `package.json` `version`.** The release action does it. Releases are staged, not published: `build.yml` signs and pushes the version commit and tag, `publish.yaml` rebuilds from that tag and stages one tarball, and a maintainer approves it on npm with 2FA. See `RELEASE.md` and the `preflight` skill.
- `package.json` `files` is the tarball allowlist. Everything `binding.gyp` compiles must stay listed, because `node-gyp-build` falls back to a source build wherever no prebuild matches.

## Git

- History is append-only. Commits reachable from any remote ref are immutable; fix forward. Never force-push `main`. If local and upstream diverge, stop and ask; don't rebase, reset, merge, pull, push, or sync.
- Ask before every commit and push. After editing a file that was already staged, `git add` it again and check `git diff --cached` before committing.

### Git Commit Messages

Conventional Commits, `<type>(<scope>): <summary>`: imperative, lowercase, no period, under 50 characters. Scope is the primary file or module (`gyp`, `test`, `ci`, `all`). The body, if any, says why; the diff shows what.

## References

[Node.js SQLite docs](https://nodejs.org/api/sqlite.html), [SQLite docs](https://sqlite.org/docs.html), [Node-API docs](https://nodejs.org/api/n-api.html), upstream [lib/sqlite.js](https://github.com/nodejs/node/blob/main/lib/sqlite.js) and [src/node_sqlite.cc](https://github.com/nodejs/node/blob/main/src/node_sqlite.cc).
