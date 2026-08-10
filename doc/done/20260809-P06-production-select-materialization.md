# TPP: Production-compatible SELECT materialization

**Status:** Completed 2026-08-09 with no production materialization change.

## Outcome

- Task 0 added controlled and packaged cache profiles without changing the package's 2 MiB
  default.
- Task 1 added compatibility and environment tests for every row path considered by the
  optimization.
- Task 2 rejected the row factory because same-harness A/B improved range throughput by about
  2% and did not improve iteration. The production materializer remains unchanged.
- The public benchmark documents now identify the published table as a packaged-default run
  and no longer claim that row factories explain the remaining binding gap.
- No controlled result table was published. A future performance project must first establish
  a lifecycle-neutral A/B baseline and flat native/native self-control.

## Current phase

Closed. This plan reached its accepted negative outcome and has no remaining implementation
work. Start a new TPP if new evidence justifies another performance candidate.

- [x] Task 0: Normalize and expose benchmark cache profiles
- [x] Task 1: Freeze materialization compatibility and lifetime behavior
- [x] Task 2: Screen compatible row-factory candidates — no candidate retained
- [x] Task 3 disposition: skipped because Task 2 found no winning factory
- [x] Task 4 disposition: skipped after Task 2 invalidated the factory attribution
- [x] Task 5 disposition: deferred as an independent project if demand warrants it
- [x] Task 6 disposition: corrected public attribution; did not publish a controlled table
- [x] Task 7 disposition: not applicable because no production candidate was retained

## Decisions already made

### Keep the package's SQLite cache default

Do **not** enable `SQLITE_DEFAULT_CACHE_SIZE=-16000` in `binding.gyp`. Keep SQLite's
`-2000` default, which requests roughly 2 MiB per connection/database cache and matches
`node:sqlite`. An eight-times-larger implicit cache is an application memory-policy change,
not a binding optimization. Callers can already select another target for a connection with,
for example, `PRAGMA cache_size = -16000`.

Negative `cache_size` values are kibibyte targets, not page counts or eager allocations. The
setting is connection/schema-local and lasts for that open database unless the application
changes it again. Do not describe it as a process-wide 16 MiB allocation.

### Use equal cache settings for the main comparison

The controlled performance profile executes
`PRAGMA cache_size = -16000` for **every** driver, after opening each fresh benchmark
database and before setup/timing. This matches better-sqlite3's packaged target and keeps the
current range fixture from turning primarily into a comparison of unequal page-cache policy.

Also retain a separately named **packaged-cache sensitivity** profile that leaves
`cache_size` untouched while continuing to normalize write durability. Its results show the
effect a user gets from each package's compiled cache default, but they must not be labeled a
pure binding comparison. Never mix rows from the two profiles in one table or chart.

### Preserve the current ABI and behavior

- Keep `NAPI_VERSION=8`; changing the declaration to 10 was flat.
- Do not enable `NAPI_EXPERIMENTAL` or call
  `node_api_create_object_with_properties`. Its Node-26-only spike was promising, but the
  symbol is absent on older supported runtimes and has no stable ABI guarantee.
- Preserve null-prototype rows and iterator records, own `__proto__` properties,
  duplicate-column last-wins behavior, exact unsafe-integer errors, `Uint8Array` BLOBs,
  array-return mode, statement state checks, and worker cleanup behavior.
- Never edit `src/upstream/*` for this work.

## Required reading

YOU MUST study these before implementation:

- `CLAUDE.md`
- `doc/reference/TPP-GUIDE.md`
- `doc/reference/TDD.md`
- `doc/reference/SIMPLE-DESIGN.md`
- `doc/done/20260807-P05-better-sqlite3-napi-select-perf.md`
- `doc/done/20260710-P05-select-materialization-perf.md`
- `benchmark/{index,scenarios,drivers}.ts` and `benchmark/README.md`
- `src/binding.cpp`
- `src/sqlite_impl.h` (`AddonData`, `StatementSync`, and
  `StatementSyncIterator`)
- `src/sqlite_impl.cpp` (`StatementSync::{Get,All,CreateResult,BuildColumnKeys,
BuildRow,GetColumnValue}`, `StatementSyncIterator::{Next,Return,ToArray}`, and
  `CreateObjectWithNullPrototype`)
- `src/index.ts`, especially native binding initialization and the stable export surface
- `test/{iterator,safe-integer-limits,statement-config,null-text-blob,
close-from-user-function,statement-close,worker-threads-initialization}.test.ts`
- local better-sqlite3 13 sources in `../better-sqlite3`, especially its row builder,
  statement iterator, reprepare invalidation, and addon initializer

Use official local Node/node-addon-api headers and examples as the source of truth for
Node-API behavior. Do not infer API stability from better-sqlite3's usage.

## Evidence inherited from P05

The handoff agent should not repeat the completed ceiling experiments.

| Change                                        |       By-id |           Range | Iterator | Decision                              |
| --------------------------------------------- | ----------: | --------------: | -------: | ------------------------------------- |
| Remove safe-integer bounds comparisons        |        flat |            flat |     flat | Keep exact throw                      |
| Allocate ordinary rows but keep property sets |        flat |            flat |     flat | Keep null prototype                   |
| Omit row property insertion                   |        +13% |            +38% |     +73% | Incompatible ceiling                  |
| Cached outer result-array factory             |           — | flat normalized |        — | Do not repeat                         |
| Ordinary shape-specialized row factory        |        +13% |            +40% |     +74% | Historical spike; not reproduced      |
| Ordinary iterator-record factory              |           — |               — |     +17% | Historical lead; not rescreened       |
| Experimental bulk null-prototype API          |         +2% |            +20% |     +10% | Stability policy blocks shipping      |
| C++ LTO                                       |        flat |            flat |     flat | Do not repeat                         |
| Declare N-API 10                              |        flat |            flat |        — | Do not repeat                         |
| Remove entry/state checks                     |        flat |               — |     flat | Keep checks                           |
| `SQLITE_THREADSAFE=2`                         |        flat |     small/noisy |      +7% | Separate safety decision only         |
| 16 MiB SQLite cache for this package          | small/noisy |            +60% |     flat | Benchmark policy, not library default |

On Node 26.6 with CPU 2 pinned, the P05 baseline was roughly 97,936 by-id,
401 range, and 522 iterator ops/s. With all drivers temporarily pinned to 2 MiB, range
throughput was ours 413, better-sqlite3 658, and `node:sqlite` 583 ops/s. The published
better-sqlite3 range result fell from about 1,500 to 658, proving that most of that unusually
large score came from the cache default. Treat P05's attribution of the remaining row-heavy
gap to property insertion as a hypothesis: the Task 2 reproduction below did not validate the
claimed factory gain.

## Compatibility and lifetime landmines

- Never place a persistent `Napi::Reference` or raw `napi_ref` on `StatementSync` or
  `StatementSyncIterator`. Earlier Alpine/musl teardown work traced JIT corruption to
  reference finalization on these wrappers. Module/worker-lifetime references belong in
  `AddonData`, whose cleanup behavior is already deliberate.
- A compiled object literal must emit every SQL column name as a **computed** property.
  Bare or quoted `__proto__:` object-literal syntax can mutate the prototype instead of
  creating an own property. Duplicate computed properties must remain in SQL column order so
  the final duplicate wins.
- `{ __proto__: null, ... }` did not retain the fast hidden-class benefit in the archived
  experiments. Do not assume that adding a null-prototype literal to the ordinary factory
  preserves its measured speed.
- SQLite can auto-reprepare a statement during `sqlite3_step()`. Column names and counts used
  to choose a factory must describe the post-reprepare row. Use
  `SQLITE_STMTSTATUS_REPREPARE` or equally strong evidence; do not cache a constructor forever
  from prepare-time metadata.
- A shape cache must be per N-API environment/worker, bounded, collision-safe, and safe to
  miss after eviction. Its exact key is the ordered vector of column-name bytes, including
  duplicates. A delimiter-joined string without length framing is not collision-safe.
- Dynamic `Function` construction may be unavailable under Electron CSP or
  `--disallow-code-generation-from-strings`. Any generated fast path needs a tested,
  semantics-identical, eval-free fallback. Importing the module must never fail merely because
  string code generation is disabled.
- The worktree may contain unrelated edits. Capture pre-spike hashes and explicit patches;
  reverse only the spike. Do not use reset, checkout, restore, or stash as cleanup.
- Performance workloads run serially on the pinned core. Subagents may audit source or tests,
  but must not benchmark concurrently.

## Benchmark and acceptance protocol

For every native candidate:

1. Build a clean A/B artifact from the exact current dirty-source baseline without replacing
   the user's existing `build/` output. Use the verified
   `@PHOTOSTRUCTURE/SQLITE_PREBUILD=<artifact-root>` override from a fresh process to select
   each copied addon.
2. Use the controlled 16 MiB cache profile for both A and B. Print and verify each driver's
   effective `PRAGMA cache_size` before trials.
3. Pin one physical CPU and keep its SMT sibling idle. Interleave A/B and the
   `node:sqlite` drift control. Do not run other performance jobs at the same time.
4. Calibrate once after the cache-profile change, choose the largest shared iteration count,
   then freeze it for the entire candidate comparison. The old `5333/28/54` counts are
   historical inputs, not mandatory after setup changes.
5. Screen with 15 measured trials and at least 5 warmups. Decision runs use
   `BENCH_TRIALS=30 BENCH_WARMUP=8`; repeat three independent processes for a small,
   borderline, or sign-changing effect.
6. Accept a result only when the median improvement exceeds the combined reported 95%
   confidence intervals. Record absolute results, A/B ratios, the node control, source/addon
   hashes, commands, and any system drift in this TPP.
7. better-sqlite3 is a design reference, not the acceptance denominator. Compare the
   candidate to this package's same-source baseline.

### Performance gates

A production row factory must:

- improve both `select-range` and `select-iterate` by at least 20% in the controlled profile;
- cause no regression greater than 3% in `select-by-id` or `select-join` outside combined
  confidence intervals;
- cause no material regression in a focused prepare/one-get shape-churn benchmark; and
- preserve or improve memory behavior with the bounded cache under churn.

An iterator-record factory is measured after the retained row path and must add at least 8%
to `select-iterate`, outside combined intervals, without affecting range/by-id results or
record semantics.

`SQLITE_THREADSAFE=2`, if it reaches a performance decision at all, must reproduce at least a
5% gain in three independent runs against the final retained build and pass its separate
concurrency gate. It must never be combined with a materialization patch during attribution.

## Tasks

### Don't blindly follow this section

These are planning-time instructions. Update this TPP when measurements invalidate an
assumption. Prefer the smallest candidate that satisfies the tests and gates; do not complete
later implementation tasks merely because they are listed.

### Task 0: Normalize and expose benchmark cache profiles

**Success**: the default benchmark command compares bindings with an identical explicit
16 MiB cache target, while a separate command can reproduce packaged cache defaults and labels
that policy difference accurately.

1. Add a failing benchmark-focused test for profile parsing and driver initialization. It
   must prove that the controlled profile returns `PRAGMA cache_size = -16000` for every
   available driver and that the packaged-cache profile does not overwrite the value observed
   immediately after open.
2. Generalize `pinDurabilityPragmas()` in `benchmark/drivers.ts` into explicit benchmark
   configuration. Keep `journal_mode=DELETE` and `synchronous=FULL`; add the controlled cache
   PRAGMA only under the controlled profile.
3. Add one CLI option with two unambiguous values, such as
   `--cache-profile controlled|packaged`. Default to `controlled`. Reject unknown values rather
   than silently falling back.
4. Query the effective cache value after initialization. Fail before timing if a controlled
   driver does not report `-16000`; print each packaged value for sensitivity runs.
5. Include the active profile and effective settings in benchmark output and chart metadata so
   copied tables cannot lose their configuration context.
6. Run quick range checks under both profiles. This task validates controls, not a new library
   default; do not update the published table until Task 6.

**Proof**:

- [x] Focused benchmark configuration test fails before implementation and passes after it
- [x] `cd benchmark && npx tsc --noEmit`
- [x] Controlled startup reports `-16000` for all three drivers
- [x] Packaged startup reports this package and `node:sqlite` at `-2000` and
      better-sqlite3 at `-16000`, unless a dependency update is explicitly recorded
- [x] `binding.gyp` still does not define `SQLITE_DEFAULT_CACHE_SIZE`

**Implementation record — 2026-08-07**:

- Added typed `controlled|packaged` parsing in `benchmark/cache-profile.ts`. The CLI defaults
  to `controlled` and rejects missing or unknown values.
- Replaced durability-only initialization with one explicit benchmark configuration path in
  `benchmark/drivers.ts`. It records the cache value immediately after open, always normalizes
  `journal_mode=DELETE` and `synchronous=FULL`, changes `cache_size` only for the controlled
  profile, queries the effective settings, and throws before timing if controlled mode is not
  `-16000`.
- Benchmark startup prints the profile, initial/packaged cache value, effective cache value,
  journal mode, and synchronous value for every driver. The copyable Markdown summary repeats
  those settings beside its table. SVGs include the profile visibly and the complete per-driver
  settings in a `benchmark-configuration` metadata element.
- The performance runner passes its controlled-by-default choice explicitly. Two-argument
  `createDriver()` calls retain packaged-cache behavior for the memory and stress tools, which
  do not expose the performance runner's cache-profile option.
- Red proof: `npx jest --runInBand --no-coverage benchmark/cache-profile.test.ts` failed before
  implementation because the profile module, configuration argument, and settings did not
  exist. Green proof: the focused CJS and ESM runs pass; the assertions cover both shared-driver
  defaults and SVG metadata retention.
- Quick fixed-iteration `select-range` control runs completed under both profiles with
  `BENCH_TRIALS=6 BENCH_WARMUP=1`. Controlled startup reported `-16000` for all three drivers.
  Packaged startup reported `-2000`, `-16000`, and `-2000` for this package,
  better-sqlite3 13.0.3, and `node:sqlite`, respectively. These runs validate configuration
  only; their throughput is deliberately not published.
- Regression proof: `npm test`, `npm run lint`, the benchmark TypeScript check, Prettier, and
  `git diff --check` passed.
- The existing published table/charts were not regenerated. The package README labels them as
  packaged-default measurements. The package build still has only the commented example for
  `SQLITE_DEFAULT_CACHE_SIZE`, so its SQLite default remains `-2000`.

Landed in `682bd1d` (`bench(perf): normalize SQLite page-cache policy`).

### Task 1: Freeze materialization compatibility and lifetime behavior

**Success**: focused characterization tests cover every observable behavior that a factory or
cache could accidentally change. Because this is an optimization, most tests should pass on
the baseline; they become the red/green guard while candidates are introduced.

Add or consolidate focused tests for:

- null prototypes from `get()`, `all()`, `iterate().next()`, and `iterate().toArray()`;
- null-prototype iterator records for row, terminal, repeated terminal, and `return()` results;
- an own `__proto__` column and duplicate aliases whose last value wins;
- property order for distinct and duplicate names;
- empty results and zero-column/edge behavior allowed by SQLite;
- `setReturnArrays(true)` and toggling it only where current stepping guards allow;
- `setReadBigInts(true)`, unsafe integer `ERR_OUT_OF_RANGE`, `null`, text, float, and BLOB
  `Uint8Array` values through every row path;
- an auto-reprepare that changes the result column shape, such as preparing `SELECT *`,
  changing the schema, and executing again;
- authorizer/user-function reentrancy, reset/invalidation, statement/database close, explicit
  disposal, and iterator invalidation;
- independent worker imports and abrupt worker termination; and
- successful import and SELECT execution in a child process started with
  `--disallow-code-generation-from-strings`.

Prefer existing files named in Required reading. Add one narrowly named materialization test
file only when the cases do not fit coherently. Do not use arbitrary timeouts or forced GC as
a substitute for traced ownership.

**Proof**:

- [x] Focused CJS and ESM row-materialization tests pass on the untouched native baseline
- [x] Worker termination test exits normally under repeated execution

**Task 1A implementation record (2026-08-08)**:

- Added `test/statement-materialization.test.ts` as the one focused cross-path suite. Its 22
  baseline characterization cases exercise `get()`, `all()`, `iterate().next()`, and
  `iterate().toArray()` without changing production code.
- The suite pins null-prototype rows and records, own `__proto__`, duplicate last-wins and key
  order, empty and non-row results, idle return-array toggles, all SQLite value kinds,
  `readBigInts`, the exact unsafe-integer error, and post-auto-reprepare shapes.
- Focused CJS and ESM runs each passed all 22 cases. A clean reconstruction of this commit later
  passed 930 of 952 CJS tests (22 skipped). The original full-suite and lint runs included
  unrelated in-progress native and test changes. The generated Node-compat statement suite also
  passed locally on Node 26.6.0; the supported-version matrix remains a CI proof item.
- At this point, Task 1B remained: consolidate lifetime/reentrancy/invalidation coverage, add
  repeated abrupt worker termination, and prove import/SELECT with string code generation
  disabled.

**Task 1B implementation record (2026-08-09)**:

- Audited the existing lifetime suites rather than duplicating them. Together,
  `close-from-user-function.test.ts`, `statement-close.test.ts`, the Node-compat statement
  suite, and `invalid-operations.test.ts` already pin authorizer/user-function reentrancy,
  reset and iterator invalidation, statement/database close, and explicit close/disposal.
- Added `test/statement-environment.test.ts` for the two remaining environment boundaries.
  Its worker case independently imports the CommonJS build, opens an in-memory database,
  advances a live statement iterator, waits for an explicit readiness handshake, and then
  abruptly terminates the worker with the database, statement, and iterator still reachable.
  All 25 sequential teardown repetitions completed without crashing the parent process.
- Child processes started with `--disallow-code-generation-from-strings` successfully import
  both published CommonJS and ESM builds and execute `SELECT 42`. This freezes the required
  eval-free import and execution baseline before any generated factory candidate exists.
- Focused CJS and ESM Jest runs each passed all three environment cases. The full default CJS
  suite passed 954 tests, and lint passed. No production code changed. The supported
  Node-version matrix remains an integration/CI proof item in Task 7.

### Task 2: Screen compatible row-factory candidates

**Success**: at least one semantics-compatible one-call-per-row candidate clears the row
factory gate, or all candidates are reverted with conclusive results recorded here.

Evaluate candidates independently in this order; do not build the final cache first:

1. **Specialized ordinary literal, then null the prototype.** Compile a factory whose body
   creates an ordinary object with computed JSON-escaped property names in SQL column order,
   then calls a captured intrinsic `Object.setPrototypeOf(row, null)` before returning it.
   Verify `__proto__`, duplicates, property order, and prototype before benchmarking.
2. **Eval-free closure.** A fixed JavaScript helper closes over the exact ordered key array,
   creates `Object.create(null)`, and copies native call arguments in a loop. This avoids
   string code generation while still crossing from native to JavaScript once per row.
3. **Specialized null-prototype literal.** Re-screen only if placement in the direct native
   row path materially differs from the archived JS rematerialization attempt. The prior
   compatible compiled builder was slower, so one conclusive screening run is enough.

The generated-source path must use `JSON.stringify` (or an equivalently proven JS string
encoder) and computed properties; do not hand-roll JavaScript escaping in C++. Its factory
creator must catch string-codegen failure and return the eval-free implementation. Prefer one
non-enumerable internal initializer from `src/index.ts` into the addon so the helper can capture
unmodified JS intrinsics. Prove that the stable named and enumerable export surfaces do not
change.

For the screening spike, a single known shape may be used only to isolate per-row cost. Mark
that build benchmark-only, test it with the exact fixture shape, and reverse it immediately.
Do not mistake a global one-shape cache for a retainable implementation.

Record a table here with candidate, semantic-test result, controlled by-id/range/iterator
medians, confidence intervals, fallback result, and decision. Stop this TPP after documenting
the negative result if no candidate clears the row gate; Tasks 3 and 4 would add unjustified
complexity.

#### Corrected screening record — 2026-08-09

No row factory was retained. The original Task 2/3 result claimed large gains, but those gains
were not reproducible when the preserved native and eval-free addons were run through the same
current benchmark harness. The full comparison table is a cross-driver snapshot, not a
before/after measurement of this optimization.

The rejection screen used Node 26.6, controlled cache settings, CPU 2, fixed iteration counts
of 62 for range and 56 for iterator, and 15 measured trials after 5 warmups. Each artifact ran
in a fresh process selected through the verified prebuild override.

| Path     | Preserved native baseline | Eval-free row factory | Decision                             |
| -------- | ------------------------: | --------------------: | ------------------------------------ |
| Range    |           906 ops/s ±3.0% |       925 ops/s ±4.4% | Reject: about +2%; intervals overlap |
| Iterator |           793 ops/s ±0.7% |       786 ops/s ±0.9% | Reject: no gain                      |

The preserved native addon was
`790a4298f2315a626e7d8e68c8470d42fd0ad3646b6a3a0599ff317fb6a426b0`; the eval-free
candidate was `cc5a0fc1cc989e6ef66a906a3bffe5ac4401dc63ad6ecd3210eafe9847520d98`.
These were separate-process screening runs rather than the protocol's interleaved decision
runs, so they do not establish a small effect. They are sufficient to reject the required
20% gain: neither path approached the gate, and iterator moved in the wrong direction.

A benchmark lifecycle change also invalidated the earlier attribution. Commit `59b8b62`
changed only this package's adapter from a no-op `finalize()` to `StatementSync.close()`;
the other two adapters still could not release statements. In a diagnostic run, the same
native addon moved from 770 ops/s ±0.8% with the no-op harness to 906 ops/s ±3.0% with the
closing harness. This is not a formal estimate of the lifecycle effect, but it proves the
harness state materially changes the result. The asymmetric change was therefore withdrawn.

Per the simple-design rule, the row creator, bounded JavaScript cache, native lookup state,
diagnostic scenarios, and their tests were all reverted. Retaining their roughly 300 lines of
shipping code is not justified by a statistically indistinguishable result. Correctness
review also found prototype-sensitive shape serialization, iterator hot-entry thrash, and
avoidable JavaScript cache growth risks; do not replace the rejected design with a simpler
unsafe cache.

Before another performance candidate:

1. Give setup and timed statements an equivalent lifecycle across all compared drivers, or
   structure the fixture so every driver holds an equivalent pre-prepared pool outside the
   timed loop.
2. Add an A/B runner that alternates fresh baseline and candidate processes and records the
   resolved addon path and hash.
3. Run a native/native self-control through both arms and require it to be flat before
   attributing a candidate effect.
4. Treat an iterator-record candidate as a new project rather than reopening this completed
   plan.

### Tasks 3 and 4: Factory productionization — skipped

Task 2 found no winning row factory, so bounded shape caching, reprepare invalidation, and an
iterator-record factory would add complexity without a measured benefit. A future factory
candidate needs a new TPP and must carry forward the compatibility landmines and benchmark
prerequisites above.

### Task 5: `SQLITE_THREADSAFE=2` — deferred

This global build-mode decision is independent of SELECT materialization. The package retains
`SQLITE_THREADSAFE=1`. Open a separate TPP only if a concrete performance or concurrency need
justifies tracing synchronous statements, sessions, backup workers, extensions, callbacks,
worker environments, and teardown paths.

### Task 6: Publish results — closed without a new table

The existing table remains an explicitly labeled packaged-default result.
`benchmark/README.md` and `doc/library-comparison.md` preserve the measured cache-policy result
but describe the remaining binding gap as unisolated. A new performance table requires the
lifecycle-neutral baseline and native/native self-control recorded in Task 2.

### Task 7: Full integration gate — not applicable

Tasks 0 and 1 were verified when they landed. Task 2 retained no production code, native
reference, cache, or ABI change, so the proposed production integration gate did not apply.

## Rejected repeats and future watch list

Do not reopen these without new evidence or a changed requirement:

- safe-integer comparison removal;
- ordinary allocation without changing property insertion;
- outer result-array batching;
- cached `Object.create(null)` lookup alone;
- Latin-1 text construction;
- `napi_define_properties` iterator records;
- C++ LTO for SELECT throughput;
- a declaration-only N-API 10 bump;
- removal of statement/iterator state checks; or
- an unbounded or statement-owned function-reference cache.

`node_api_create_object_with_properties` remains a standards watch item. Reconsider it only
after it is part of a stable Node-API version supported by the package's runtime/prebuild
matrix; do not add runtime symbol probing, `dlsym`, or Node-version forks under this TPP.

## Definition of complete

This TPP is complete with the accepted negative outcome: the package retains its explicit
2 MiB cache default and native materializer, the rejected candidates and benchmark confounder
are recorded, and the public comparison no longer presents an unverified factory attribution
as a measured cause. Controlled cache support remains available for a future project, but this
plan does not publish a new controlled result table.
