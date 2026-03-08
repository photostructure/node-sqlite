# TPP: Sync upstream Node.js SQLite changes (v25.6.1 → v25.8.1)

## ✅ COMPLETED

## Goal Definition

- **What Success Looks Like**: Two upstream features are ported and all tests pass: (1) statement iterator invalidation, (2) DatabaseSync `limits` property
- **Core Problem**: The project's native implementation was missing two features from v25.x-staging. SQLTagStore was already implemented in TypeScript
- **Key Constraints**: API compatibility with `node:sqlite` is non-negotiable. Never modify `src/upstream/*` manually — use the sync script
- **Success Validation**: `npm test` (839 pass), `npm run test:node` (295 pass), `npm run lint` (clean)

## Changes Made

### 1. Statement iterator invalidation

Added `reset_generation_` counter to `StatementSync` that increments on every statement reset. `StatementSyncIterator` captures the generation at creation and checks it in `Next()` — throws `ERR_INVALID_STATE` if the statement was reset by another call (run/get/all/iterate).

**Files**: `src/sqlite_impl.h`, `src/sqlite_impl.cpp`

Key details:

- `ResetStatement()` replaces direct `sqlite3_reset()` calls in Run/Get/All/Iterate/Reset
- Iterator's own `sqlite3_reset(stmt_->statement_)` calls (in Next/Return/ToArray for end-of-iteration) are NOT changed — they bypass `ResetStatement()` intentionally
- Generation is captured in `SetStatement()`, checked in `Next()`

### 2. DatabaseSync `limits` property

Added `getLimit(id)` and `setLimit(id, value)` native methods. TypeScript layer creates a lazily-cached object with `Object.defineProperty` getters/setters for all 11 SQLite limits.

**Files**: `src/sqlite_impl.h`, `src/sqlite_impl.cpp`, `src/index.ts`, `src/types/database-sync-instance.ts`, `src/types/database-sync-options.ts`

Key details:

- Constructor parses `options.limits` (integer-only, no Infinity, non-negative)
- Runtime setter accepts `Infinity` to reset to compile-time max (`INT_MAX`)
- `Object.keys(db.limits)` returns all 11 property names
- Throws `ERR_INVALID_STATE` when database is closed (handled by native `getLimit`/`setLimit`)
- Used `defineProperty` over `Proxy` — simpler, zero overhead, 11 fixed properties

### 3. Upstream files

Already synced via `npm run sync:node` — matches v25.x-staging (v25.8.1). Iterator invalidation hasn't landed on v25.x-staging yet, so we're ahead of upstream on that feature.

### 4. Test updates

- `test/invalid-operations.test.ts`: Updated iterator tests to match new invalidation behavior
- All node-compat test files were already pre-written

## Validation Results

```bash
$ npm test
# 55 suites pass, 839 tests pass, 44 skipped

$ npm run test:node
# 295 pass, 0 fail, 4 skipped

$ npm run lint
# clean (0 errors)
```

## Tribal Knowledge

### N-API has no NamedPropertyHandlerConfiguration

V8's `NamedPropertyHandlerConfiguration` (used by upstream for limits) intercepts arbitrary named property access. N-API deliberately omits this. We use `Object.defineProperty` getters/setters in TypeScript instead.

### SQLTagStore pattern: TypeScript over C++

Both SQLTagStore and limits use the same pattern: minimal native primitives (`getLimit`/`setLimit`, `prepare`/`run`/`get`/`all`) with TypeScript orchestration on top. This avoids complex V8-specific C++ (NamedPropertyHandlerConfiguration, DictionaryTemplate, etc.) while maintaining API compatibility.

### Iterator reset*generation* scope

Only `StatementSync::ResetStatement()` increments the generation counter. The iterator's own `sqlite3_reset()` calls for end-of-iteration cleanup do NOT go through `ResetStatement()`. This prevents self-invalidation when iteration completes naturally.
