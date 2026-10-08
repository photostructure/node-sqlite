# TPP: Remove `--forceExit` from the memory scripts

Placeholder: not yet researched.

## Goal definition

- **What success looks like**: `npm run memory:check` and `npm run memory:asan` run Jest without `--forceExit`, and Jest exits on its own.
- **Core problem**: `scripts/check-memory.ts:74` and `scripts/sanitizers-test.sh:221` pass `--forceExit`, which the Tests section of `AGENTS.md` says is not a fix. The comment at `scripts/check-memory.ts:70` blames "a Jest issue with native modules", and nobody has checked that claim.
- **Key constraints**: find and close whatever keeps the process alive; don't replace `--forceExit` with sleeps, `global.gc()`, or `setImmediate` in `afterAll`.
- **Success validation**: `TEST_MEMORY=1 node --expose-gc --no-sparkplug node_modules/jest/bin/jest.js --no-coverage --runInBand --detectOpenHandles test/memory.test.ts` exits with no open-handle report.

## Tasks

### Task 1: Find out whether a handle stays open

1. Run the validation command above and record whether Jest exits and what `--detectOpenHandles` reports.
2. If a handle stays open, fix the test or code that leaves it, following `AGENTS.md` and `doc/internal/testing-philosophy.md`.
3. Remove `--forceExit` and its comment from `scripts/check-memory.ts`, and `--forceExit` from `scripts/sanitizers-test.sh`.
4. Run `npm run memory:check` on macOS and Linux, and `npm run memory:asan` on Linux.
