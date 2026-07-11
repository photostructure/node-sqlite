# TPP: Close the SELECT row-materialization gap to node:sqlite

**Status: COMPLETE (archived).** Stability-first implementation, documentation, benchmark
corrections, and final validation completed 2026-07-10.

## Goal definition

- **What success looks like**: SELECT Range / SELECT with Iterator / SELECT by PK benchmark
  medians improve measurably (accept criterion below) with zero behavior change; benchmark
  output reports per-scenario ratios so SELECT differences cannot be diluted by fsync-bound ties.
- **Core problem**: Row materialization (SQLite row → JS value) dominates SELECT cost. We pay
  ~21 napi calls/row in `all()` (~28 in the iterator, incl. 2 JS `Object.create(null)` calls)
  where upstream node:sqlite pays one V8 bulk call — but ~5-9 of those calls per row are
  removable, and a JS-side materialization experiment may close the rest.
- **Key constraints**: exact `node:sqlite` API compatibility (null-prototype rows; a column
  named `__proto__` must become an OWN property; out-of-range integer throws); stable N-API 10
  only (Node 22 baseline); never persist `Napi::Reference`/`napi_ref` members on
  ObjectWrap classes (Alpine/musl GC-finalizer JIT corruption — see `src/sqlite_impl.h:366-369`).
- **Success validation**: `npm test` green + per-item A/B protocol (below) shows median gains
  exceeding combined 95% margins on `select-range` / `select-iterate`.

## Outcome

- **Implementation is complete under the stability-first decision.** The safe row-building
  refactors are committed; the experimental bulk-object path, JS materializer, and ASCII
  fast path were rejected after measurement. The final accepted work is the Linux `-fno-plt`
  build flag, benchmark/reporting corrections, regression coverage, and public documentation.
- Investigation is complete (4-agent fan-out + plan review, 2026-07-08). Findings are
  distilled here; the full plan is at
  `~/.claude/plans/review-our-benchmark-performance-greedy-crescent.md`.
- User decisions already made: (1) fix benchmark reporting AND the SELECT Range scenario;
  (2) the JS-materialization spike (Task 6) is approved AND pre-approved for productionization
  if it beats the optimized native path by ≥25%.
- ASK BEFORE ANY `git commit` (house rule). Use the `stage` skill to stage only
  session-touched hunks.

## Context research

### Why we're slower (verified, don't re-derive)

- Current benchmark (working tree): SELECT Range 8,800 vs node:sqlite 12,000 ops/s;
  Iterator 670 vs 1,100; SELECT by PK 110k vs 120k. Mutation scenarios are fsync-bound ties.
- The "overall score" is an unweighted mean over 9 scenarios (`benchmark/index.ts:379-401`);
  5 fsync-bound ties dilute SELECT gains ~3x (a +6% SELECT Range win reads as "+1% overall").
  CPU-bound-only score is ~66.5%, not the headline 82%.
- Upstream `node_sqlite.cc` wins mainly via V8-only APIs unavailable through the supported
  stable N-API 10 surface:
  bulk `v8::Object::New(isolate, Null, keys, values, count)` (node_sqlite.cc:2983, 3110, 3873);
  `DictionaryTemplate` iterator wrappers (:152-160); internalized column-name strings
  (:2862-2864); per-statement `Global<Name>` column-name cache invalidated by
  `sqlite3_stmt_status(SQLITE_STMTSTATUS_REPREPARE)` (:2869-2898); bulk `Array::New` (:2990).
  Reachable equivalents: latin1 ASCII strings (Task 4) and fewer ABI crossings (Tasks 1-3).
- **Build flags are ruled out**: commit 02e4521 measured API_ARMOR on/off as noise (30 trials);
  both sides compile sqlite3.c at -O3. Do not chase build flags.
- better-sqlite3's 2x over node:sqlite rests on plain-prototype rows (incompatible with our
  `__proto__`-own-property requirement) and skipped safe-integer checks (loses precision >2^53
  — semantics we must not copy). Not a target.

### The ceiling — SUPERSEDED 2026-07-10 (was "irreducible", now version-gated)

Original (2026-07-08) finding: the JS `Object.create(null)` round-trip — 1/row in `all()`,
2/row in iterator `next()` — had no stable-napi replacement. Tasks 1-4 shave the napi-call layer
around it; only Task 6 could plausibly close the rest, and Task 6 FAILED the gate (see Tribal).

**This is no longer fully true.** A 2026-07-10 web-search for N-API prior art (verified against the
Node 26.5.0 headers on disk, `js_native_api.h`) found TWO relevant additions that postdate the
original investigation. They are the substance of **Task 7** below:

1. **`node_api_create_object_with_properties`** (`js_native_api.h:53-62`, **experimental** — needs
   `#define NAPI_EXPERIMENTAL`; feature macro `NODE_API_EXPERIMENTAL_HAS_CREATE_OBJECT_WITH_PROPERTIES`;
   added **v25.2.0 / v24.12.0**). Builds a **null-proto object with all keys+values in ONE native
   call**, "atomically, avoiding V8 map transitions" — the portable twin of upstream's
   `v8::Object::New(isolate, Null, keys, values, count)` this doc called unreachable. Not the
   reverted factory (that hoisted the _same_ round-trip) and not Task 6 (that failed because
   `__proto__:null` JS _literals_ can't fast-map — this builds in C++/V8, a different mechanism).
2. **`node_api_create_property_key_utf8/latin1/utf16`** (`js_native_api.h:108-113`, **STABLE** under
   `#if NAPI_VERSION >= 10`, backported to **Node 22.9.0**). Internalized property keys → cheaper
   `napi_set_property`; the portable analog of upstream's internalized column-name strings. Lower
   ceiling than #1 but works on our whole floor and needs no experimental opt-in.

This project's floor is `engines: node >=22` (N-API 10), with CI on 22/24/26. That matters:
the property-key APIs (#2) are available everywhere we ship; the bulk API (#1) is absent on Node 22
and 24.0-24.11, so it needs compile-time feature-macro gating + runtime fallback.

### Existing patterns

- Hot-path functions (all in `src/sqlite_impl.cpp`, working tree):
  `GetColumnValue` :3013-3066, `BuildColumnKeys` :3075-3087, `BuildRow` :3095-3125,
  `CreateResult` :3127-3145, `All` :2420-2480, `StatementSyncIterator::Next` :3229-3294,
  `ToArray` :3324-3395, `CreateObjectWithNullPrototype` :297-307.
- Module-lifetime function ref pattern: `AddonData::objectCreateFn` in addon instance data —
  `src/sqlite_impl.h:52`, populated `src/binding.cpp:82-87`, fetched via `GetAddonData(env)`
  (`napi_get_instance_data`). This is the ALLOWED place for persistent refs.
- Napi mappings (node-addon-api `napi-inl.h`): `Object::Set(napi_value, v)` → `napi_set_property`;
  `Set(const char*, v)` → `napi_set_named_property` (creates the V8 string each call);
  `String::New(const char*, size_t)` → `napi_create_string_utf8` — **no latin1 overload exists**.

### Landmines (learned the hard way — do not re-explore)

1. **"Check exception once per row" is UNSAFE.** `NAPI_CPP_EXCEPTIONS` is enabled
   (`binding.gyp:24`, `-fexceptions` :71): napi calls made while an exception is pending throw
   C++ `Napi::Error` — a semantics change vs today's stop-at-first-bad-column. Use the
   per-column C++ bool out-param design (Task 1).
2. **A compiled JS row builder must emit ALL keys as computed properties.** A bare
   `__proto__: r[0]` in an object literal sets the prototype, not an own property. Emit
   `{__proto__: null, [<JSON.stringify(key)>]: r[i], ...}` — the leading non-computed
   `__proto__: null` sets the null proto; computed keys (even `["__proto__"]`) create own
   properties, last-wins for duplicates (matches native `napi_set_property`).
3. **Never persist napi handles in `Napi::Reference` members on StatementSync /
   StatementSyncIterator** (`napi_delete_reference` during GC finalization corrupts V8 JIT
   pages on Alpine/musl; commit 4da0638, nodejs/node-addon-api#660). This is why upstream's
   cross-call column-name cache is NOT portable. Locals within one native call are fine.
4. `CreateObjectWithNullPrototype` has a silent fallback to a plain-prototype object
   (:305-306) — a Rule-5 violation (bogus guardrail): it would silently break the null-proto
   contract. Fold its removal into Task 2 (fail visibly instead).
5. Benchmark drivers call the RAW native statement (`benchmark/drivers.ts:83-96`) — enhance()
   is NOT in the benchmark path; don't optimize it expecting benchmark movement.
6. **The baseline key-cache had a P1 memory-safety crash (FIXED, folded into Task 0).** The
   `keys` vector is built once, lazily, on the first row and ONLY when `return_arrays_` was
   false then. `setReturnArrays()` had no `stepping_` guard, so a user-defined SQL function
   could flip a statement that started in array mode (empty `keys`) to object mode mid-`all()`;
   the next `BuildRow` took the object branch and indexed the empty vector → SIGSEGV (repro:
   flip on row 2+, deterministic; exit 139). Fix: added the same `stepping_` re-entrancy guard
   that `All`/`Get`/`Run`/`Next`/`ToArray` use to ALL four statement config setters
   (`SetReturnArrays`, `SetReadBigInts`, `SetAllowBareNamedParameters`,
   `SetAllowUnknownNamedParameters` — `src/sqlite_impl.cpp:2584-2676`), completing the
   "no re-entry during a step" contract the `All` comment at `:2440` already declared. Test:
   `test/close-from-user-function.test.ts` ("setReturnArrays() on the in-flight statement
   throws; no crash"). Do NOT "fix" this by falling back to column names when `keys` is empty —
   that silently emits mixed array/object rows (Rule-5 bogus guardrail).

## Tasks

### Don't blindly follow this section!

These tasks reflect planning-time knowledge. If implementation reveals a simpler path per
SIMPLE-DESIGN.md, propose a revision with pros/cons. Run the A/B protocol after each task;
an item that doesn't beat noise gets reverted, not kept.

### Task 0: Land the baseline (the uncommitted working-tree diff) — ✅ DONE

**Success**: `npm test` and `npm run lint` green; diff committed (ASK FIRST).

**Status (2026-07-08 session)**: ✅ COMMITTED. A P1 SIGSEGV in the baseline key-cache was
found by an intern review and fixed BEFORE landing (see Landmine #6). Landed as three commits
(fix first, so the crash never exists in committed history; each built + full-suite tested
green at 875 tests, crash repro clean at each):

- `2197620` `fix(sqlite_impl): guard config setters against mid-step mutation`
  (the 4 setter `stepping_` guards + `test/close-from-user-function.test.ts` regression test)
- `e97f6a9` `perf(sqlite_impl): cache column keys and pass string lengths in row build`
  (the baseline refactor + `sqlite_impl.h` + `benchmark/README.md`)
- `2514b94` `perf(enhance): return native iterator directly for flat/raw modes`

Split was verified lossless (recombined 3-commit diff byte-identical to the original working
tree). Baseline A/B medians were recorded immediately afterward; see the table below.

### Task 1: Drop per-column `env.IsExceptionPending()` in BuildRow

**Success**: `npm t -- safe-integer-limits` passes; A/B on `select-range` improves.

1. Change `GetColumnValue` (:3013, decl `src/sqlite_impl.h:361`) to
   `bool GetColumnValue(Napi::Env env, int i, int column_type, napi_value *out)` —
   returns false iff it set a pending exception (the out-of-range integer branch
   :3023-3032 does `THROW_ERR_OUT_OF_RANGE(...); return false;`); all other branches write
   `*out`, return true.
2. Both `BuildRow` loops (:3102 array, :3115 object): replace the
   `env.IsExceptionPending()` call with the bool check; on false return `env.Undefined()`.
3. Callers (`All` :2458, `ToArray` :3383, `Next` via `CreateResult` :3286) keep their
   existing `IsExceptionPending` checks — error paths (stop stepping, `ResetStatement`,
   propagate) unchanged.

**What the tests validate**: out-of-range throw (`test/safe-integer-limits.test.ts:57-77`),
type round-trips (`test/node-compat/test-sqlite-data-types.test.js`). Theoretical OOM inside
`String/ArrayBuffer::New` still unwinds via C++ exception to `All`'s catch (:2477) — validated
by code review only.

### Task 2 (NullProtoFactory) + Task 3 (same factory in iterator `Next`) — ❌ REVERTED, DO NOT RE-ATTEMPT

Built and A/B-tested 2026-07-08; **reverted**. The factory only hoisted the _same_ JS
`Object.create(null)` handle lookups (already cheap) out of the loop — it did not remove the
per-row round-trip — and the extra indirection _regressed_ `select-range` ~1.3% with no iterate
win. Full measurements in Tribal knowledge. The correct way to actually remove the round-trip is
**Task 7** (native bulk construction), not hoisting. Do not resurrect the factory.

Two still-valid scraps salvaged from these tasks, fold into whatever lands:

- Rule-5 cleanup: `CreateObjectWithNullPrototype` (`:297`) has a silent plain-object fallback
  (`:305-306`) that would break the null-proto contract — replace with a visible throw.
- The iterator `{done,value}` wrapper keys ("done"/"value") are module-global ⇒ their `napi_value`
  handles can be cached in `AddonData` (`sqlite_impl.h:46-52`, the allowed persistent-ref home).

### Task 4: ASCII fast path for TEXT columns

**Success**: `npm t -- test-sqlite-data-types` (8KB ASCII :114-131 fast path; `☃`×2048
fallback) and `npm t -- parameter-binding` (`"Unicode: 你好世界 🌍"` :121) pass; A/B on
`select-range` improves (2 of 5 columns are TEXT, ~120B ASCII JSON).

1. In `GetColumnValue` TEXT branch (:3038-3049): plain byte loop over `byte_len`; if every
   byte < 0x80 call `napi_create_string_latin1` (stable N-API v1; **must use the C API —
   `Napi::String` has no latin1 overload**), else `napi_create_string_utf8`. Latin-1 and
   UTF-8 agree on 0x00-0x7F, so ASCII output is byte-identical; mirrors upstream's
   `validate_ascii → NewFromOneByte` (node_sqlite.cc:68-80). No simdutf; a byte loop is enough.
2. On `napi_status != napi_ok`, set an exception and return false (Task 1's contract).

### Task 5: Benchmark reporting + real SELECT Range — ✅ DONE

**Success**: `cd benchmark && npx tsc --noEmit` passes; output shows per-scenario throughput
relative to `node:sqlite` instead of a blended ranking; SELECT Range actually returns ~1000
rows/query. All met: select-range now ~1000 rows/query; `category`, durability tags, and
`BENCH_TRIALS`/`BENCH_WARMUP` env overrides added. README tables regenerated.

1. Add `category: "cpu" | "fsync"` to `Scenario` (`benchmark/scenarios.ts:7-14`).
   cpu: select-by-id, select-range, select-iterate, select-join;
   fsync: insert-simple, insert-transaction, insert-blob, update-indexed, delete-bulk.
2. In `benchmark/index.ts`: remove the blended cross-scenario ranking, report this package's
   per-scenario ratio to `node:sqlite`, and tag durability-bound/batched rows in the summary.
3. Fix SELECT Range: shrink the user_id insert domain from
   `Math.random()*1000` to `*50` (`scenarios.ts:80`) → 50 users × 50k rows ≈ 1000 rows/query
   (LIMIT 1000 finally binds); update the description (:61) to "Fetch ~1000 rows by indexed key".
4. `benchmark/README.md`: explain the unweighted mean dilutes SELECT differences ~3x, that
   fsync scenarios measure the SSD, and regenerate the results tables.
5. Skip hoisting `Math.random()` out of `run()` — nanoseconds vs 9µs-100µs ops.

### Task 6 (gated): JS-side row materialization spike → productionize if ≥25%

**Success (spike)**: a throwaway script proves/disproves: raw arrays + JS builder ≥25% over
the post-Task-4 native `all()` on the SELECT Range shape (1000 rows × 5 cols, 3 INT + 2 TEXT),
median outside combined 95% margins. **Pre-approved**: if the gate clears, productionize.

Spike (`benchmark/spike-js-materialize.ts`, not committed): compare
(1) native object `all()`;
(2) `stmt.setReturnArrays(true)` + native array `all()` + per-statement compiled builder
`new Function("r", "return ({__proto__:null," + keys.map((k,i) =>
    `[${JSON.stringify(k)}]:r[${i}]`).join(",") + "});")` — see Landmine #2;
(3) same arrays + generic `const o = Object.create(null); for (...) o[keys[i]] = r[i];`
(CSP-safe, eval-free fallback).

Productionization outline (only after the gate):

- `src/index.ts`: patch `DatabaseSync.prototype.prepare` to install fast-path `all`/`iterate`
  as own properties on the native statement (identity/instanceof preserved). Resolve column
  names per call via native `columns()`; toggle `setReturnArrays` around the native call;
  re-resolve keys if the column set changes (auto-reprepare).
- `try/catch` around `new Function` → permanent generic-loop fallback under CSP (PhotoStructure
  embeds Electron). Add a test forcing the non-eval branch.
- `iterate()`: custom iterator object whose `next()` returns null-proto
  `{__proto__: null, done, value}` LITERALS (generator result objects have Object.prototype and
  fail `deepStrictEqual` compat tests); `[Symbol.iterator]() { return this; }`; `return()`
  delegates to native so guard/reset/finalize semantics are unchanged.
- Parity checklist: null-proto rows; `__proto__` own property; duplicate-column last-wins
  (`SELECT 1 AS a, 2 AS a`); BigInt/Uint8Array passthrough; out-of-range integer throw (native
  array path still throws during array construction); all enhance() modes unaffected.
- Commit: `perf(index): materialize rows in JS via raw-array builder`.

### Task 7 (NEW 2026-07-10, gated): native bulk null-proto object via `node_api_create_object_with_properties` — ❌ NOT PRODUCTIONIZED

**Status (2026-07-10)**: The user explicitly prioritized stability over incremental
performance. Do not enable this experimental API in the production addon. Defining
`NAPI_EXPERIMENTAL` without also pinning `NAPI_VERSION` changes the addon's declared API
version to `NAPI_VERSION_EXPERIMENTAL`; directly linking the new symbol also prevents the
addon from loading on older supported Node releases where the symbol is absent. Runtime
symbol lookup could contain that compatibility risk, but is not justified for this package's
stability policy. Preserve the stable Node-API implementation as the production path.

**Historical proposal (superseded by the status above)**: this appeared to be the most promising
lever because it exposes the bulk operation used by node:sqlite, but its experimental ABI and
runtime availability do not meet the project's current stability bar.

**Success (spike)**: a throwaway proves/disproves ≥ noise-floor improvement on THIS machine's
Node 26 (which has the API) for `select-range` (`all()`) and `select-iterate` (iterator), median
outside combined 95% margins, using the P05 A/B protocol below.

**Why it's un-measured territory**: it removes BOTH the JS `Object.create(null)` round-trip AND the
per-column `napi_set_property`s AND the V8 map transitions, in one call — none of the prior attempts
(NullProtoFactory, Task 6 JS builders) did that. It also collapses the iterator `{done,value}`
wrapper (the 2nd round-trip = the iterator-specific tax that keeps it at 0.47× vs `all()`'s 0.71×).

**Spike steps** (`benchmark/spike-bulk-object.*`, not committed):

1. Add `#define NAPI_EXPERIMENTAL` before the napi includes in a throwaway build (or in
   `binding.gyp` defines temporarily). Confirm the symbol compiles:
   `grep -n NODE_API_EXPERIMENTAL_HAS_CREATE_OBJECT_WITH_PROPERTIES ~/.cache/node-gyp/*/include/node/js_native_api.h`
2. New object-mode path in `BuildRow` (`src/sqlite_impl.cpp:3185`): collect column values into a
   `std::vector<napi_value>` (already do this shape), reuse the cached `keys` vector as
   `property_names`, and call once:
   `node_api_create_object_with_properties(env, /*prototype_or_null*/ nullptr, keys.data(), values.data(), n, &out)`.
   `nullptr` prototype ⇒ null-proto — satisfies the `__proto__`-own-property + null-proto contract
   (VERIFY: `__proto__` as a KEY must still become an own property, not set the proto —
   test-sqlite-statement-sync.test.js:75-79; and duplicate columns last-wins :148-178).
3. Iterator (`Next` `src/sqlite_impl.cpp:3322`): build the row via the same path, and build the
   `{done,value}` wrapper with ONE `node_api_create_object_with_properties` call (null proto,
   cached module-lifetime `napi_value` keys for "done"/"value" in `AddonData` — allowed there,
   `sqlite_impl.h:46-52`). Kills both round-trips.
4. A/B `select-range` + `select-iterate` vs `node:sqlite`. Record medians here.

**Productionization (only if the spike clears)**:

- Gate at COMPILE time on the feature macro:
  `#ifdef NODE_API_EXPERIMENTAL_HAS_CREATE_OBJECT_WITH_PROPERTIES` … `#else` (current path) `#endif`.
- Gate at RUNTIME: the macro means the _headers_ have it, not that the running Node implements it
  (we ship one prebuild that runs on Node 22/24/26). Detect once at addon init — call it against a
  tiny probe and check `napi_status`; cache a `bool` in `AddonData`; branch `BuildRow`/`Next` on it.
  On Node 22 / 24.0-24.11 the probe fails ⇒ permanent fallback to today's `CreateObjectWithNullPrototype`
  path. Add a test that forces the fallback branch.
- **Experimental-API risk (call it out in the PR)**: `NAPI_EXPERIMENTAL` symbols can change
  signature/behavior or be removed across Node versions; we ship prebuilds to many. The runtime
  probe + fallback contains the blast radius, but the maintainer must accept the opt-in.
- Consider Task-7b (independent, lower-risk, stable everywhere): swap `BuildColumnKeys`
  (`:3075`-ish) to build keys with `node_api_create_property_key_utf8` instead of
  `napi_create_string_utf8`, gated `#if NAPI_VERSION >= 10`. Needs `NAPI_VERSION=10` in
  `binding.gyp` (we pin nothing today; would require `engines: node >=22.9`). A/B independently.

**If architecture changed**: find the object build with `grep -n "CreateObjectWithNullPrototype" src/sqlite_impl.cpp`;
the bulk API replaces the `Object.create + per-column Set` pair everywhere it appears in a hot loop.

## A/B measurement protocol (acceptance test for every perf claim)

1. Rebuild: `npm run build:native:rebuild` (benchmark loads `../src/index` → fresh `.node`).
2. Single-scenario, two-driver runs (filter verified at `benchmark/index.ts:100`,
   `scenarios.ts:442-455`):
   `cd benchmark && npx tsx index.ts select-range --drivers "@photostructure/sqlite,node:sqlite"`
   — repeat for `select-iterate`, `select-by-id`.
3. Noise control: quiescent machine; pin with `taskset -c 2`; for accept/reject raise
   `MEASURED_TRIALS` (index.ts:29) to 30 (the API_ARMOR-study rigor); 3 independent process
   runs per condition.
4. Accept only if median improvement exceeds combined 95% margins
   (improvement% > ~2× the larger reported rme). Record before/after median ± rme per item.
5. Keep the intern's baseline constant; vary ONE item at a time.

## Historical commit plan

1. Task 0 baseline (see above)
2. `perf(sqlite_impl): drop per-column exception check in BuildRow` (Task 1)
3. `perf(sqlite_impl): reuse null-prototype object factory across rows` (Tasks 2+3)
4. `perf(sqlite_impl): add ASCII fast path for TEXT columns` (Task 4)
5. `fix(benchmark): report per-scenario ratios and fix SELECT Range shape` (Task 5)
6. (gated) `perf(index): materialize rows in JS via raw-array builder` (Task 6)

## Validation

- [x] All tests pass: `npm t` (859+ tests; watch `test/safe-integer-limits.test.ts`,
      `test/node-compat/test-sqlite-statement-sync.test.js`,
      `test/node-compat/test-sqlite-data-types.test.js`, `test/iterator.test.ts`,
      `test/statement-modes.test.ts`, `test/enhance.test.ts`)
- [x] Lint passes: `npm run lint` (2 pre-existing detect-object-injection warnings in
      enhance.ts are expected); `cd benchmark && npx tsc --noEmit`
- [x] Per-item A/B numbers recorded in this TPP (Tribal knowledge below)
- [x] Final pinned benchmark run; README table and SVG charts regenerated
- [x] API matches node:sqlite (19/19 synced compatibility files green)
- [x] Memory benchmark: 5/5 scenarios report no leak for all three drivers

## Planning expectations (superseded by the measurements below)

Tasks 1+2+4 on SELECT Range: ~+10-15% (≈9,700-10,100 ops/s) — closes maybe half the gap to
node:sqlite's 12,000. Task 3 on Iterator: ~+8-15% (≈720-770). The remainder is the
JS-`Object.create`-per-row ceiling; only Task 6 can plausibly close or flip it. If a task
doesn't beat the noise floor, revert it and record why here.

## Baseline A/B — the "before" reference for Tasks 1-4

Recorded 2026-07-08 at commit `2514b94` (Task 0 tip), quiescent machine, `taskset -c 2`,
`BENCH_TRIALS=30` (env override added to `benchmark/index.ts`), single process run:

| scenario       | @photostructure/sqlite |         node:sqlite |
| -------------- | ---------------------: | ------------------: |
| select-range   |      8,425 ops/s ±1.2% |  11,331 ops/s ±2.0% |
| select-iterate |        565 ops/s ±0.9% |   1,209 ops/s ±2.2% |
| select-by-id   |    104,970 ops/s ±0.7% | 117,899 ops/s ±1.3% |

Accept a later task ONLY if OUR median rises beyond the combined 95% margins vs these numbers
(improvement% > ~2× the larger rme). NOTE: absolute values differ from `benchmark/README.md`
(pinned single-core 30-trial run here vs the README's unpinned run) — use THESE for A/B, not
the README. Command: `BENCH_TRIALS=30 taskset -c 2 npx tsx index.ts <scenario> --drivers
"@photostructure/sqlite,node:sqlite"`.

## Tribal knowledge (append discoveries here)

- 2026-07-08 (planning session): all findings above; investigation by 4-agent fan-out over
  benchmark/, ../node, ../better-sqlite3, and our hot paths. Full plan:
  `~/.claude/plans/review-our-benchmark-performance-greedy-crescent.md`.
- 2026-07-08 (impl session): baseline verified green (874 tests, lint clean). Intern review
  caught a P1 SIGSEGV in the baseline key-cache (Landmine #6): `setReturnArrays()` lacked the
  `stepping_` re-entrancy guard, so a UDF flipping array→object mode mid-`all()` indexed the
  empty cached-key vector. Reproduced deterministically (standalone script, exit 139), fixed by
  guarding all four config setters, added a regression test. Suite now 875 tests. Guard fix
  folded into the Task 0 commit. Key insight: the cache introduces a NEW invariant
  ("non-null keys ⟺ object mode at both meta-init and build time") that only holds because
  `return_arrays_` can no longer change mid-loop — any future config that BuildRow/BuildColumnKeys
  reads must be equally frozen during a step.
- 2026-07-08 (impl session, cont.) — MEASURED RESULTS & DECISIONS (the native path is capped):
  - **Task 1** (drop per-column exception check): select-range FLAT (within noise); select-iterate
    consistent **+2%** (577-587 vs 565 over 5 runs); select-by-id ~flat. KEPT & committed
    (`69fe78b`) — small iterator win + cleaner error handling.
  - **Task 2 (NullProtoFactory) + Task 3 (iterator factory): REVERTED.** A clean same-session
    paired A/B (stash baseline, rebuild, 5+ samples each) showed the factory _regressed_
    select-range ~1.3% (baseline mean 8,381 vs 8,268) and added nothing to iterate/by-id.
    Hoisting the Object.create handle lookups doesn't help (they're already cheap) and the extra
    indirection costs slightly. Do NOT re-attempt the factory.
  - **Task 4 (latin1 ASCII): NOT DONE** — deprioritized; with Tasks 1-3 all landing in the noise,
    a latin1 fast path on 2 short-ASCII TEXT cols would also be sub-noise on select-range.
  - **Task 6 spike (throwaway, `~/.claude/jobs/.../spike-js-materialize.mjs`): gate FAILED, NOT
    productionized.** At the TRUE 1000-row shape (calls/sec, 3 runs): native object all() = 1.0×;
    compiled `new Function` builder with COMPUTED keys = **0.90× (SLOWER)**; compiled builder with
    STATIC keys = 1.12×; generic `Object.create(null)` loop = **1.24×**; node:sqlite = **2.2×**.
    KEY LESSON: `__proto__:null` forces V8 off the fast-hidden-class path, so a null-proto object
    _literal_ can never be fast-map — the compiled-builder approach (TPP's primary Task 6 plan) is
    a dead end. The generic loop (~+24%) is the only JS win and only borderline clears the ≥25%
    gate; it does NOT close the 2.2× node:sqlite gap, which is architectural (their
    `v8::Object::New(isolate,null,keys,vals,n)` bulk-null-proto-fast-map had no equivalent in
    the stable Node-API surface evaluated by that spike). User decided: do not productionize.
  - **Task 5 (benchmark) DONE**: added per-scenario ratios, write-durability row tags,
    `BENCH_TRIALS`/`BENCH_WARMUP` env overrides, and fixed select-range from a ~50-row query
    (`random()*1000` domain vs `LIMIT 1000`) to a real ~1000-row query (`*50` domain). The
    benchmark had been MEASURING THE WRONG SHAPE — at the real shape node:sqlite is 2.2×, and the
    CPU-bound subscore is **69%** (vs the diluted 82% overall), confirming the planning estimate.
- 2026-07-10 (research session): re-confirmed the gap is live (not "stale two-day-old numbers":
  same machine + commit `69fe78b` + deterministic bench). Fresh `select-iterate` A/B:
  **610 vs 1,294 ops/s (0.47×)**; `select-range` `all()`: **508 vs 711 (0.71×)**. The iterator's
  extra loss vs `all()` is its 2nd `Object.create(null)` (the `{done,value}` wrapper) + the fact
  that `Next`→`CreateResult`→`BuildRow(nullptr)` throws away the per-op column-key cache that
  `All`/`ToArray` use (single row per `next()` call ⇒ nothing to amortize; caching keys ON the
  iterator was already measured −20%, see [[napi-reference-gc-hazard]] / perf memory notes).
- 2026-07-10 (research session) — **THE CEILING IS NO LONGER IRREDUCIBLE**: web-search for N-API
  prior art surfaced `node_api_create_object_with_properties` (experimental, Node ≥24.12/25.2) and
  `node_api_create_property_key_*` (stable, napi 10 / Node 22.9+). Both header-verified on disk. See
  the rewritten "The ceiling" section and **Task 7**. This reopens the "native path is capped"
  conclusion from the 2026-07-08 session — capped on _stable napi as it existed then_, not now.
  Sources: nodejs/node commit 166c72ec02; docs/api/n-api.md (`added: v25.2.0, v24.12.0`,
  Stability 1); `~/.cache/node-gyp/26.5.0/include/node/js_native_api.h:53-62,108-113`.
- 2026-07-10: NOTE an UNRELATED completed fix shares this working tree — the
  serialize/deserialize authorizer-reentry UAF fix (`src/sqlite_impl.cpp`,
  `test/close-from-user-function.test.ts`), tracked in the archived P01 plan beside this file.
  When staging P05 work, do NOT sweep those two files in. The `benchmark/*` changes are P05.
- 2026-07-10 (independent validation; stability-first): source inspection and controlled A/B
  testing corrected several planning assumptions:
  - Array-mode results retain almost the entire gap, so null-prototype object creation is not
    the dominant ceiling. On a fixed 1,000-row / 5-column query: our/node medians were
    1,082/2,681 for object `all()`, 1,573/4,134 for array `all()`, 618/1,412 for object
    iteration, and 865/1,953 for array iteration. Ratios remain 0.38-0.44x in both modes.
    The dominant cost is per-value stable Node-API crossings; Node core creates values and
    arrays directly through V8 and bulk-constructs rows.
  - The ASCII/Latin-1 text path matched Node's source but did not change the benchmark ratio
    (ours 471→482 while node:sqlite 670→686 in the paired process runs). Reverted.
  - `napi_define_properties` for the iterator `{done,value}` wrapper regressed 577→568 ops/s.
    Reverted.
  - Persistent references cannot directly hold primitive string keys: Node rejected the
    addon at initialization with `Invalid argument`. A container reference would add lookups
    and lifecycle complexity on every row, so the spike was reverted.
  - **Kept**: Linux C++ `-fno-plt`, which preserves stable Node-API semantics and only changes
    ELF call code generation. Alternating baseline/optimized addon binaries in the same pinned
    process measured +2.31% for `all()` and +2.84% for iteration. The project benchmark moved
    from 471→483 ops/s for SELECT Range and 577→586 ops/s for iteration; standalone process
    variance is larger, so the same-process A/B is the stronger evidence.
  - Validation: 891 Jest tests pass (22 skipped), all 19 synced Node compatibility files pass,
    `npm run lint` passes, and `cd benchmark && npx tsc --noEmit` passes.
  - Larger stable gains require a separately packaged, Node-module-ABI-specific V8 fast path
    with the current Node-API addon retained as fallback. That is a new architecture/maintenance
    commitment and should not be inferred from this optimization task.
- 2026-07-10 (documentation): rewrote the public performance story around the question readers
  actually have: "is it fast enough?" The root README no longer claims blanket performance
  parity with better-sqlite3. It now says that common operations are fast, names large-result
  materialization as the exception, and links to the evidence. `benchmark/README.md` leads with
  the verdict and absolute throughput, explains the stable Node-API tradeoff in plain language,
  and moves the full table and methodology into collapsed details. Keep the write claim scoped:
  durable single-operation writes tie because storage sync dominates; batched writes do not.
  `doc/library-comparison.md` now uses the same performance explanation, reflects the package's
  Node.js 22 minimum, and includes Node.js 26 in the `node:sqlite` availability table.
- 2026-07-10 (final validation): benchmark review found that per-driver calibration executed
  different random-query prefixes and different within-trial database sizes. The runner now
  calibrates every driver but uses the largest result as one shared per-scenario iteration count.
  It reports a median with an exact distribution-free 95% order-statistic interval (minimum six
  trials), rather than combining a median with a mean-based normal interval. A pinned 30-trial,
  single-core run produced: SELECT by PK 108,693/134,201/122,443; SELECT Range
  490/1,658/666; iterator 593/1,230/1,270 ops/s for this package/better-sqlite3/node:sqlite.
  The full CJS suite passed 903 tests (22 skipped), focused ESM passed 102, Node compatibility
  passed 19/19, lint and benchmark TypeScript passed, and all memory scenarios reported no leak.
