# TPP: Explain and isolate better-sqlite3's N-API SELECT advantage

**Status:** Completed 2026-08-07; documentation retained, all native spikes reverted.

> **Correction (2026-08-09):** P06 did not reproduce the row-factory gains below when the
> preserved native and compatible factory addons ran through the same current harness. Keep
> the page-cache result, but treat the factory attribution as a historical hypothesis rather
> than a demonstrated cause. See the
> [P06 closeout](20260809-P06-production-select-materialization.md).

## Goal definition

- **What success looks like**: `doc/library-comparison.md` accurately describes
  better-sqlite3 13's Node-API packaging and SELECT tradeoffs, and every plausible
  hot-path difference has a recorded one-variable A/B result or a documented reason
  that an earlier controlled measurement remains conclusive.
- **Core problem**: better-sqlite3 retained a large SELECT advantage after moving from
  direct V8 APIs to Node-API, so "stable Node-API versus V8" no longer explains the
  comparison; we need to measure call granularity, result construction, semantics, and
  build choices separately.
- **Key constraints**: production behavior must remain exactly compatible with
  `node:sqlite`; temporary behavior-breaking spikes are allowed only when clearly
  isolated, immediately reverted, and never mixed with the user's unrelated dirty
  working-tree changes.
- **Success validation**: paired pinned-core benchmark medians exceed combined 95%
  margins before an optimization is retained; `npm test`, `npm run lint`, and
  `cd benchmark && npx tsc --noEmit` pass for retained code/documentation.

## Current phase

Completed: all spikes were measured and reverted, the comparison was corrected, the
baseline addon was restored, and the retained documentation passed validation.

- [x] Prior research and current hot paths read
- [x] Experiment matrix reviewed against better-sqlite3 13.0.3
- [x] Current baseline recorded and preserved
- [x] One-variable twiddles measured and reverted/retained
- [x] Library comparison corrected
- [x] Retained changes validated
- [x] Reviewed

## Required reading

YOU MUST study these before continuing:

- `CLAUDE.md`
- `doc/reference/TPP-GUIDE.md`
- `doc/reference/TDD.md`
- `doc/reference/SIMPLE-DESIGN.md`
- `doc/done/20260710-P05-select-materialization-perf.md`
- `benchmark/{index,scenarios,drivers}.ts`
- `src/sqlite_impl.{h,cpp}` (`StatementSync::{Get,All,BuildRow,GetColumnValue}` and
  `StatementSyncIterator::Next`)
- `../better-sqlite3/lib/database.js`
- `../better-sqlite3/src/{objects/statement.cpp,objects/statement-iterator.hpp,util/row-builder.cpp,util/data.cpp}`

## Context research

### What changed upstream

better-sqlite3 commit `84245d3` moved to node-addon-api and explicitly includes several
performance-regression mitigations. Its replacement for direct V8 bulk construction is
not our per-property Node-API path:

- `rowFactory()` compiles an ordinary-prototype object-literal builder for each stable
  statement column shape; `RowBuilder` caches the resulting function until SQLite
  reports a reprepare.
- Each row's native values cross into that function in one call instead of being assigned
  through one `napi_set_property` per column.
- `all()` collects native row handles and calls `arrayFactory(...rows)` in batches; it does
  not call `napi_set_element` once per result row.
- Iteration calls a JS `recordFactory(value)` for `{ value, done: false }`.

The benchmark adapters wrap both drivers symmetrically. The current SELECT scenarios use
the same deterministic data; `select-range` and `select-iterate` each materialize about
1,000 rows, while `select-join` returns only 10 rows after substantially more SQLite work.

### Existing evidence that must not be forgotten

The archived P05 plan already measured these claims on this machine:

- Removing a per-column exception-pending query was flat for `all()`, about +2% for
  iteration, and retained in `69fe78b`.
- Hoisting the existing `Object.create(null)` function lookup regressed range throughput
  about 1.3%; the per-row call remained, so do not repeat that experiment.
- Switching ASCII text creation to Latin-1 did not change the ratio and was reverted.
- `napi_define_properties` for iterator records regressed and was reverted.
- Array mode retained most of the gap to node:sqlite, proving null-prototype allocation is
  not the sole cost.
- Linux `-fno-plt` produced a small reproducible win and is already retained.

The new question is narrower: better-sqlite3 now demonstrates that stable Node-API plus
JS factories can outperform our stable Node-API construction strategy. Re-test only the
differences that its migration makes newly actionable.

### Landmines

- Never edit `src/upstream/*`.
- `src/sqlite_impl.{h,cpp}` already contains unrelated user changes. Capture a hash and
  patch for every touched file before each spike; after reversal, require byte-for-byte
  equality with the pre-spike file, not equality with Git HEAD.
- Never use `git restore`, `git checkout`, reset, or stash to clean a spike; those can erase
  the user's work. Apply explicit forward/reverse patches.
- Never persist `Napi::Reference` members on statement/iterator ObjectWraps; archived P05
  documents an Alpine/musl finalizer corruption. Addon instance data is the permitted home
  for module-lifetime factories.
- Exact compatibility requires null-prototype rows and iterator records, an own property
  named `__proto__`, duplicate-column last-wins behavior, and an out-of-range integer throw.
  better-sqlite3's fastest ordinary objects and default lossy integer conversion are not
  production-compatible.
- Temporary experiments that remove those semantics need benchmark-only validation, then
  immediate reversal. They are evidence, not candidate patches.
- Do not run competing performance workloads concurrently. Subagents may audit source and
  docs while the machine is idle, but benchmark runs are serialized and pinned to one core.

## Experiment protocol

1. Record `sha256sum` for every tracked file a spike will touch and save the current native
   addon as a baseline artifact under a `mktemp -d` directory.
2. Build current source with `npm run build:native:rebuild` and run baseline scenarios with
   `BENCH_TRIALS=30 BENCH_WARMUP=5 taskset -c 2 npx tsx index.ts <scenario>
--drivers "@photostructure/sqlite,node:sqlite"` from `benchmark/`.
3. Apply exactly one explicit patch, rebuild, and run the identical commands. Use three
   independent process runs per condition when a quick run suggests a non-noise result.
4. Accept only when the median improvement exceeds the combined reported 95% margins. Record
   all measured medians, including regressions and null results, below.
5. Reverse the explicit patch and verify file hashes match the pre-spike dirty-worktree
   hashes. Select copied artifacts with the verified
   `@PHOTOSTRUCTURE/SQLITE_PREBUILD=<artifact-root>` override; every benchmark import must run
   in a fresh process because `node-gyp-build` resolves the addon once at module load.
6. For a potentially retainable implementation, run compatibility tests before the full
   suite. A behavior-breaking spike is always reverted regardless of speed.

Use the baseline calibration's fixed iteration counts for every condition (`5333` by-id, `28`
range, `54` iterator) so later processes execute identical work. Keep `node:sqlite` as the
within-process control for drift; better-sqlite3 is the design inspiration, not a moving
denominator. For quick screening run 15 trials in a balanced A/B process order; escalate a
small or sign-changing result to 30 trials and bracket it with another baseline run.

## Experiment matrix

### E1: Safe-integer range check

**Question**: do the two safe-range comparisons materially affect integer-heavy SELECTs?

**Twiddle**: in `StatementSync::GetColumnValue`'s `SQLITE_INTEGER` non-BigInt branch,
temporarily return `Number(int_val)` without comparing against `JS_{MIN,MAX}_SAFE_INTEGER`.
This holds SQLite extraction and number creation constant and removes only the semantic check.

**Measure**: `select-by-id`, `select-range`, `select-iterate`. Regardless of result, revert:
silent precision loss is incompatible with `node:sqlite`.

### E2: Null-prototype allocation

**Question**: how much does `Object.create(null)` itself cost when property assignment remains
unchanged?

**Twiddle**: change only `StatementSync::BuildRow`'s row allocation from
`CreateObjectWithNullPrototype(env)` to `Napi::Object::New(env)`. Do not change the helper:
that would also alter iterator record allocation and conflate this with the record experiment.

**Measure**: all three SELECT scenarios. Revert regardless of result because row prototypes
change.

### E3: Per-column object property-setting ceiling

**Question**: what is the maximum time attributable to `napi_set_property` and the associated
V8 property transitions after values and keys already exist?

**Twiddle**: keep row allocation, every SQLite-to-JS value conversion, and per-operation key
construction unchanged, but temporarily omit only the `result.Set(...)` in the object-mode
`BuildRow` loop. The benchmark does not consume returned fields, so this isolates an upper
bound while still materializing every value.

**Measure**: all three SELECT scenarios. Results are empty row objects and grossly incompatible,
so always revert. Archived P05 never isolated this variable.

### E4: Outer `all()` array assembly

**Question**: how much does one `results.Set(index, row)` Node-API call per row cost?

**Twiddle**: collect row handles in a native vector and construct/append the result through a
cached JS array factory in batches, following better-sqlite3's `ArrayFactory`/`ArrayAppender`
pattern. Keep row creation unchanged.

**Measure**: `select-range` primarily; `select-by-id` and iterator are controls. This is
semantics-compatible if ordering, empty/single result behavior, exceptions, and huge-result
batching match.

### E5: Row array assembly

**Question**: in `setReturnArrays(true)` mode, how much do per-column `Array::Set` calls cost?

**Twiddle**: pass collected values to a cached `(...values) => values` factory once per row.
Keep the outer `all()` construction unchanged so E4 and E5 remain separable.

**Measure**: a focused 1,000-row/5-column array-mode diagnostic plus compatibility tests for
array mode. Retain only if it also improves a public/native path without wrapper changes.

### E6: Shape-specialized row factory

**Question**: does better-sqlite3's cached compiled object-literal factory account for the
remaining ordinary-object advantage?

**Twiddle**: benchmark-only port of its `rowFactory` and statement-shape cache. First use
ordinary objects to reproduce better's mechanism; if it wins, separately use a compatible
null-prototype/computed-key builder. Never combine these conditions.

**Measure**: all three SELECT scenarios plus direct prototype/`__proto__` checks. The ordinary
version is evidence only. Archived P05's JS-side null-prototype builder was slower or at most
borderline; repeat only if this native-to-cached-factory placement differs materially from that
spike.

### E7: Iterator record factory

**Question**: how much do null-prototype creation plus two property sets cost for every
`next()` result?

**Twiddle**: keep row creation unchanged and replace only iterator record construction with a
cached JS factory. Measure ordinary `{value,done:false}` first as evidence; then evaluate a
compatible null-prototype factory only if the ceiling is meaningful.

**Measure**: `select-iterate`; `select-range` is the negative control. Ordinary records are
incompatible and always reverted. Do not repeat the already-negative `napi_define_properties`
variant.

### E8: Native bulk property construction

**Question**: what is the ceiling if object creation and all property definitions collapse into
one engine call while retaining null-prototype semantics?

**Twiddle**: use `node_api_create_object_with_properties` in a Node-26-only throwaway build,
after verifying its current signature in the local official Node/node-addon-api sources.

**Measure**: `select-range` and `select-iterate`, plus `__proto__`, duplicate-column, and
prototype behavior. Experimental ABI/runtime availability means this remains a spike unless
the user separately revisits the stability decision recorded in P05.

### E9: Build-only differences

Run separately after source-path experiments:

- Add LTO to C++ compile/link flags, without changing exception mode.
- Bump the declared N-API version from 8 to 10 without using new APIs; this should be a null
  result and guards against attributing speed to the version number itself.
- Do not simply disable C++ exceptions: this code intentionally relies on them and changing
  the macro without converting error paths is not a one-variable, build-only experiment.

**Measure**: all three SELECT scenarios for LTO; `select-by-id` and `select-range` are enough for
the N-API version control. Retain build changes only after all platforms/settings are reviewed.

### E10: Repeated state-check ceilings

**Question**: does our compatibility/safety validation materially affect the hot path,
especially the checks repeated by every iterator `next()` call?

**Twiddle**: three independent behavior-breaking upper-bound conditions: remove only the
fast-path precondition block from `Get`, from `All`, and from `StatementSyncIterator::Next`.
Never combine them. better-sqlite3 performs its own unwrap/open/busy/locked checks, so any win
is only our maximum removable cost, not proof that its implementation performs no checks.

**Measure**: by-id for `Get`, range for `All`, iterator for `Next`. Always revert: these checks
protect finalized/closed databases, authorizer callbacks, iterator invalidation, reentrancy,
and thread ownership.

## Documentation task

Update `doc/library-comparison.md` from local better-sqlite3 13.0.3 evidence:

- remove the V8-specific/no-Node-API claim;
- describe bundled platform prebuilds and remove the postinstall-download claim;
- update its Node.js minimum and prebuild-strategy/Node-API matrix cells;
- explain that its bulk-read advantage now comes from fewer Node-API property/element calls,
  cached JS factories, and looser result semantics—not from remaining on direct V8 APIs;
- avoid unverified package-size, maintenance, or ecosystem claims.

The benchmark README's `node:sqlite` explanation may also need one sentence distinguishing
better-sqlite3; edit it only if the final measurements support concise durable wording.

## Results and decisions

Record each condition as: source hash, build command, benchmark command, median ± interval,
decision, and why. Do not paste raw trial logs.

| Condition                        | By-id impact |               Range impact | Iterator impact | Decision                                                       |
| -------------------------------- | -----------: | -------------------------: | --------------: | -------------------------------------------------------------- |
| E1 remove safe-integer bounds    |         flat |                       flat |            flat | Keep exact throw                                               |
| E2 ordinary row prototype        |         flat |                       flat |            flat | Keep null prototype                                            |
| E3 omit row property sets        |         +13% |                       +38% |            +73% | Incompatible ceiling                                           |
| E4 batch outer result array      |            — |            flat normalized |               — | Revert complexity                                              |
| E5 array-mode builder            |          N/A |                        N/A |             N/A | Not on published object-row path; prior P05 remains conclusive |
| E6/E6b shape-specialized factory |         +13% |                       +40% |            +74% | Explains row construction; spike incompatible/incomplete       |
| E7 iterator-record factory       |            — |                          — |            +17% | Explains secondary iterator tax; ordinary record incompatible  |
| E8 experimental bulk row object  |          +2% |                       +20% |            +10% | Stable-runtime policy blocks shipping                          |
| E9 C++ LTO                       |         flat |                       flat |            flat | Revert                                                         |
| E9b declare N-API 10             |         flat |                       flat |               — | Version number is not the mechanism                            |
| E10 omit state checks            |         flat | N/A after tighter ceilings |            flat | Keep checks                                                    |
| E11 SQLite multi-thread mode     |         flat |                small/noisy |             +7% | Secondary build effect; revert                                 |
| E12 16 MiB SQLite page cache     |        small |                       +60% |            flat | Major range-fixture policy effect; revert                      |

### Current dirty-worktree baseline — 2026-08-07

- Environment: Node 26.6.0, CPU 2 pinned (SMT sibling CPU 18), governor `powersave`;
  `better-sqlite3` 13.0.3. Setup/build activity is held constant and `node:sqlite` remains an
  interleaved control.
- Source hash: `src/sqlite_impl.cpp`
  `2366937e4ff46bcd8b1f130eed62300868bc93dae5edd9b3d13014897697c24e`.
- Addon hash: `31baa63630d138155583707635a7b7b869b4ce9404baf597448d193ed9d1f1f5`;
  copied to `/tmp/node-sqlite-napi-select.cAT4aa/baseline.node`.
- Build: `npm run build:native:rebuild`.
- 30 trials / 5 warmups:
  - by-id: ours `97,936 ±0.7%`; node `110,142 ±0.6%`; fixed `5333` iterations/trial.
  - range: ours `401 ±1.8%`; node `561 ±1.6%`; fixed `28` iterations/trial.
  - iterator: ours `522 ±0.4%`; node `1,135 ±1.4%`; fixed `54` iterations/trial.

### E1 safe-integer range check — no detectable benefit; reverted

- Variant addon hash:
  `db0223181f4d21c11d13137c3561c7a3862ceb853a999953d1a7a85e9e9834ce`.
- by-id: variant `95,305 ±1.3%` / node `107,161 ±0.9%`; normalized ratio
  `0.889`, identical to baseline `0.889` despite system drift.
- range bracketing runs:
  baseline `401/561` (`0.715`), variant `397/562` (`0.706`), baseline `408/574`
  (`0.711`), variant `412/577` (`0.714`). No stable positive sign; every difference is
  within run-to-run drift/combined intervals.
- iterator: variant `511 ±1.7%` versus baseline `522 ±0.4%`; the node control in the
  variant process was noisy (`±11.8%`), but our own throughput still provides no evidence
  of a win.
- Decision: keep the exact `node:sqlite` out-of-range throw. Two predictable native comparisons
  are below this benchmark's detectable cost and do not explain better-sqlite3's advantage.
- Reversal proof: `src/sqlite_impl.cpp` returned to baseline SHA-256
  `2366937e4ff46bcd8b1f130eed62300868bc93dae5edd9b3d13014897697c24e`.

### E2 ordinary-prototype row allocation — no detectable benefit; reverted

- Variant addon hash:
  `5b8486da97141b476044b9c9cdae101562c36c4ea207017e38809602d980114d`.
- The spike changed only object-mode row allocation from the cached
  `Object.create(null)` call to `Napi::Object::New`; value conversion and every property
  set were unchanged.
- 20 trials / 5 warmups: by-id `96,536 ±3.0%` / node `107,076 ±2.1%`; range
  `401 ±0.7%` / node `562 ±1.3%`; iterator `498 ±6.5%` / node
  `1,094 ±13.8%`.
- Decision: ordinary allocation did not improve the range result at all and provided no
  stable gain elsewhere. Keep null-prototype row compatibility. This also confirms that
  better-sqlite3's ordinary objects alone do not explain its bulk-SELECT lead.
- Reversal proof: `src/sqlite_impl.cpp` returned to baseline SHA-256
  `2366937e4ff46bcd8b1f130eed62300868bc93dae5edd9b3d13014897697c24e`.

### E3 omit row-property insertion — large upper bound; reverted

- Variant source/addon hashes:
  `9d0ccdcff5cc44f9817727b14009bc9c97dbe97a34d18bbfdc6564cc439d068b` /
  `5d20db01f01df5ada09c8e9a635d5ab165e6f3b5785136bf6076e1ef6d5d1f9c`.
- The spike still allocated each null-prototype row, stepped SQLite, inspected every
  column type, and converted every SQLite value to JavaScript; it omitted only the
  property insertions and therefore returned empty rows.
- 20 trials / 5 warmups: by-id `110,972 ±0.9%` / node `107,696 ±3.0%`; range
  `553 ±0.9%` / node `551 ±2.6%`; iterator `903 ±0.3%` / node
  `1,127 ±4.6%`.
- Relative to the baseline, this incompatible ceiling is about +13% for by-id, +38%
  for range, and +73% for iteration. Per-column property insertion can explain a
  material part of the gap and is the first measured mechanism consistent with
  better-sqlite3's cached shape-specialized row factories.
- Decision: revert empty rows; proceed to compatible/factory-based ways to collapse
  the repeated property calls.
- Reversal proof: `src/sqlite_impl.cpp` returned to baseline SHA-256
  `2366937e4ff46bcd8b1f130eed62300868bc93dae5edd9b3d13014897697c24e`.

### E4 cached outer-array factory — no stable normalized gain; reverted

- Variant source hashes: `src/sqlite_impl.cpp`
  `a5f02bd23d3808c9dd981fc32c0ea814d281285493539ab64d79eb8aa190fdbd`,
  `src/sqlite_impl.h`
  `5816e19aa86c7d3dc6fc8fe388f6796902509ffccddf34db29024d4669813d93`,
  and `src/binding.cpp`
  `ca2e934718156636d4f3a021e6bfd11aa1d4288731f2992edcca632caf7617d1`;
  addon `16f12ac202b3ebf806cbe4222eeb761f3e6b58e2379164b39f9da9a00ed9efc1`.
- The spike retained every row allocation/property insertion, collected row handles in
  a native vector, then made one call to a persistent `(...values) => values` factory.
- Range: variant `420 ±2.0%` / node `558 ±4.2%`; adjacent baseline
  `412 ±2.3%` / node `549 ±2.4%`. Both normalized ratios round to `0.75`; the
  apparent raw +1.9% tracks host/control drift and does not clear combined intervals.
- A first artifact used a weak function reference and failed after GC with
  `Invalid argument`; it was discarded and rebuilt with a persistent module-lifetime
  reference before measurement.
- Decision: outer result-array element writes are not a demonstrated material bottleneck
  here. Do not add factory/batching complexity on this evidence.
- Reversal proof: all three files returned byte-for-byte to their dirty-worktree baseline
  hashes (`236693…`, `f15083…`, `8e5bfa…`).

### E6 shape-specialized ordinary row factory — +33% range; reverted

- Variant source hashes: `src/sqlite_impl.cpp`
  `72736a684e17df04b19098353f8ca1e67c43b066ba2d44f9250655874aa06e99`,
  `src/sqlite_impl.h`
  `76fc7876a1d892c227062b45da8569359e18912798bd99d2d26531ef57320865`,
  and `src/binding.cpp`
  `29ea07dfb0683540c23b087e5655ecf3d31cdb07c4b5fcc2a17cc64ae56c04a7`;
  addon `bb45172024218df6fc5229064377ed13f405d266e0e39e5eb9f3b49c4637ea55`.
- This benchmark-only port compiled one ordinary-object literal factory for the first
  observed `all()` column shape. Each row still performed the same SQLite type inspection
  and value conversion, but crossed into JavaScript once with all values instead of making
  one Node-API property-set call per column.
- Range: variant `535 ±3.1%` / node `541 ±5.3%`, a normalized ratio of `0.99`.
  Against the `401 ±1.8%` preserved baseline this is about +33%, closely approaching
  E3's empty-row ceiling (`553`) while returning populated rows.
- Decision: this reproduces better-sqlite3's main bulk-read mechanism and explains most
  of the range gap. Revert because the deliberately minimal spike cached only one global
  shape and returned ordinary-prototype rows; a production design must cache safely per
  statement/shape and preserve null prototypes, `__proto__`, duplicate-column, reprepare,
  worker, and finalizer behavior.
- Reversal proof: all three files returned byte-for-byte to their dirty-worktree baseline
  hashes (`236693…`, `f15083…`, `8e5bfa…`).

### E6b shape-specialized factory on every row path — +13–74%; reverted

- Variant source hashes: `src/sqlite_impl.cpp`
  `39b2d99ebcf106dc4f7a37a3c3ceccf4883ce421168df5369a4fa03ce20947b1`,
  `src/sqlite_impl.h`
  `e526f69ad90dda2523bd0476a71c896ecdbd84cc397a38a43e3eb8a90a9cdeb3`,
  and `src/binding.cpp`
  `29ea07dfb0683540c23b087e5655ecf3d31cdb07c4b5fcc2a17cc64ae56c04a7`;
  addon `1a5ff0b46d4a123e556a21ddc0617c738959eba10c4e4b46227d51567f242fb9`.
- This follow-up routed object-mode `BuildRow` for `get()`, `all()`, and iterator rows
  through the same one-shape ordinary-object factory. It retained all type inspection,
  value conversion, state checks, and the iterator record wrapper.
- 20 trials / 5 warmups: by-id `110,691 ±0.6%` / node `108,957 ±0.6%`;
  range `562 ±1.1%` / node `565 ±1.5%`; iterator `908 ±0.5%` / node
  `1,132 ±3.8%`. Relative to the preserved baseline this is approximately +13%,
  +40%, and +74%, respectively; the normalized range ratio moved from `0.715` to
  `0.995`, and iterator from `0.460` to `0.802`.
- Decision: row property insertion is the dominant iterator tax as well as the range tax.
  E7's separate +17% record-wrapper result explains another independent cost. Revert the
  deliberately unsafe global one-shape cache and ordinary prototypes; any production port
  requires compatible null-prototype builders and shape/reprepare/finalizer design.
- Reversal proof: all three files returned byte-for-byte to their dirty-worktree baseline
  hashes (`236693…`, `f15083…`, `8e5bfa…`).

### E7 ordinary iterator-record factory — +17% iterator; reverted

- Variant source hashes: `src/sqlite_impl.cpp`
  `72987aa9423e79cccbcdaf48425ba2447eb64e5e11f3001809dcc662d0a893bd`,
  `src/sqlite_impl.h`
  `03851636fd4a8538cf99e938dbfeeafe8ad0c48f785bda9a2c99c80c226dd6ed`,
  and `src/binding.cpp`
  `a4b9ad4a4af98e955b84d2a2d9749240d7be54767b318c8cf4d64f208eb839e3`;
  addon `3fbeafcb9d690da6066202f63c2e6c6444428bf4085decf09eb398b4ba953877`.
- The spike replaced only the per-row null-prototype iterator wrapper plus its two
  property sets with one persistent `value => ({ value, done: false })` call. Row
  materialization, SQLite stepping, safety checks, and terminal records were unchanged.
- Iterator: variant `613 ±2.7%` / node `1,109 ±5.1%`; versus the preserved
  baseline `522 ±0.4%`, about +17%.
- Decision: better-sqlite3's record factory explains a meaningful but secondary part
  of the iterator gap. Revert because ordinary iterator records are incompatible;
  a production candidate must preserve null prototypes and terminal-record behavior.
- Reversal proof: all three files returned byte-for-byte to their dirty-worktree baseline
  hashes (`236693…`, `f15083…`, `8e5bfa…`).

### E8 experimental bulk null-prototype rows — +20% range; reverted

- Variant source hashes: `src/sqlite_impl.cpp`
  `5daf441e6f8427b7d3fe96cf57ae2917e8c931b0b0c78e381fb04297c820543f` and
  `binding.gyp`
  `06c6489412837e0e40ef07d98945a61e48ece29bd0acd1df29494f5c9b7fa4f0`;
  addon `de764e873f2b256d571c413084cee9083ba6bec0f2a1a9145b7396fe6d101648`.
- On Node 26 only, the spike enabled `NAPI_EXPERIMENTAL` and replaced row allocation plus
  per-column sets with one `node_api_create_object_with_properties` call. The iterator
  record wrapper remained unchanged, keeping this result separable from E7.
- A focused smoke check passed null-prototype, duplicate-column last-wins, and own
  `__proto__` behavior: `Object.getPrototypeOf(row) === null`, keys `a,__proto__`, values
  `2,3` for `SELECT 1 AS a, 2 AS a, 3 AS __proto__`.
- 20 trials / 5 warmups: by-id `99,731 ±1.0%` / node `107,118 ±1.1%`; range
  `481 ±2.7%` / node `551 ±5.3%`; iterator `573 ±2.8%` / node
  `1,117 ±3.8%`. Relative to baseline: approximately +2%, +20%, and +10%.
- Decision: the stable API's missing bulk null-prototype constructor has a real cost, but
  the experimental symbol is absent from older supported runtimes and carries no ABI
  stability guarantee. Preserve the project's stable Node-API/prebuild policy; this is
  evidence for a future standardized API, not shippable code.
- Reversal proof: both files returned to baseline hashes `236693…` and `c8d3e1…`.

### E9 Linux C++ LTO — no material SELECT gain; reverted

- Variant `binding.gyp` hash
  `274013a923052b828375480ae6ddc3ad2cdb69b0e0e94c4783a9883e0ffe38c9`;
  addon `c9c5e93d30cc9be3f464684addb976b08a85d1c00ea57995c2f47884c35d88b8`.
  The one-variable build added `-flto` to Linux C++ compilation and linking, matching
  better-sqlite3's relevant flags without changing runtime code or exception policy.
- 20 trials / 5 warmups: by-id `99,002 ±0.5%` / node `109,633 ±0.8%`; range
  `405 ±0.6%` / node `570 ±1.7%`; iterator `504 ±0.8%` / node
  `1,116 ±2.9%`.
- Decision: by-id's small raw movement does not reproduce on the row-heavy paths and the
  normalized ratios remain approximately baseline (`0.90`, `0.71`, `0.45`). LTO is not
  the bulk-read explanation; do not add cross-platform build complexity on this evidence.
- Reversal proof: `binding.gyp` returned to baseline SHA-256
  `c8d3e10daa5e542dfb86eb52cd5ca1c6399468ab24000bbbaadf35d023ab3d0c`.

### E9b declared N-API 10 — null result; reverted

- Variant `binding.gyp`/addon hashes:
  `ff367842a9c3ac7bca06430e0b82f59c72bac61b47faa9e916534216c29db385` /
  `3582c0154b7b0c02f53d16fd1408aebc8db2e08f0261165250c934e12587d5bf`.
- Changing only `NAPI_VERSION=8` to `NAPI_VERSION=10` produced by-id
  `96,025 ±0.8%` / node `106,976 ±1.3%` and range `405 ±1.1%` / node
  `562 ±1.1%`: baseline-equivalent normalized ratios (`0.90`, `0.72`).
- Decision: declaring N-API 10 does not make existing calls faster. better-sqlite3's
  advantage comes from the algorithms/call shapes it built during the migration, not the
  N-API version integer. Reverted to the broad N-API 8 ABI floor (`c8d3e1…`).

### E10 hot-path state-check ceilings — no detectable benefit; reverted

- `Get` variant source/addon hashes:
  `d3297e56b58ad79aaeb787233f79df72fe039456d46776d46d9da32b53245eae` /
  `beb02cb583efb91ff22db50b2b136b63a13b2a9a40db7620af2439ae739ccc7c`.
  Removing every entry precondition produced by-id `95,817 ±0.9%` / node
  `107,350 ±1.0%`, versus baseline `97,936 ±0.7%`: no benefit.
- iterator `Next` variant source/addon hashes:
  `e2d70adafc5142d3557ab91a4a76fb15e809df332d57c8734ed1f6a0c44d128b` /
  `68432c6a6a8fae8a135d3bdd2191d19ee005be32b253426ec67603edc13c425e`.
  Removing finalized/open/authorizer/invalidation/reentrancy checks produced iterator
  `523 ±1.4%` / node `1,125 ±3.3%`, identical to baseline `522 ±0.4%`.
- `All` checks run once per roughly 1,000-row range operation, rather than once per row;
  after the tighter by-id and per-`next()` upper bounds were flat, a third unsafe build
  cannot plausibly explain the range gap and was not run.
- Decision: retain all correctness checks. Both spikes were behavior-breaking ceilings,
  and both files returned to baseline SHA-256 `236693…`.

### E11 `SQLITE_THREADSAFE=2` — modest only; reverted

- better-sqlite3 builds SQLite in multi-thread mode while this package and `node:sqlite`
  use SQLite's serialized default. Variant `binding.gyp`/addon hashes:
  `917251ea8d5e1ca5226c70402566944a55fc9174a15f998a887048a1daeaa2b0` /
  `adf88820a2b414cf8e327d6d3a15111a61368803440a7f4fd99a582ccf48267f`.
- 20 trials / 5 warmups: by-id `97,487 ±1.3%` / node `106,422 ±1.5%`;
  range `421 ±4.2%` / node `549 ±14.6%`; iterator `557 ±0.8%` / node
  `1,126 ±3.7%`.
- Decision: avoiding SQLite's per-connection serialized mutex is flat on by-id, modest/noisy
  on range, and about +7% on iteration. It is a secondary better-sqlite3 build advantage,
  not the 3.5× range explanation. Revert pending a separate concurrency-safety review.
- Reversal proof: `binding.gyp` returned to baseline SHA-256 `c8d3e1…`.

### E12 16 MiB default SQLite page cache — +60% range; reverted

- Runtime `PRAGMA cache_size` is `-2000` (2 MiB) for this package and `node:sqlite`,
  but `-16000` (16 MiB) for better-sqlite3. Its source explicitly defines
  `SQLITE_DEFAULT_CACHE_SIZE=-16000`.
- Variant `binding.gyp`/addon hashes:
  `91bd574c7376da9529b0604ef70a1fcb7ed703ecfb6f23116fdad31bc5b7d840` /
  `138b84e0c2e9b8d515f39e58fa2dfc482b4c852f994d9a98be9d582d77f13a12`.
- Initial 20-trial range results were bimodal (`590 ±24.6%`), so the decision run used
  30 trials / 8 warmups: range `641 ±1.0%` / node `584 ±0.5%`, roughly +60%
  over the preserved `401` baseline. By-id was `101,513 ±2.0%` (small/noisy) and
  iterator `511 ±1.0%` (flat), as expected for their tiny or sequential working sets.
- Direct causal check: with a throwaway `PRAGMA cache_size=-2000` applied to every driver,
  the same 30-trial range run produced ours `413 ±0.6%`, better-sqlite3
  `658 ±0.7%`, and node `583 ±1.7%`. better-sqlite3 fell from the published
  roughly `1,500` ops/s to `658`; most of its extraordinary range score is therefore its
  eight-times-larger out-of-box page cache, not N-API binding overhead.
- Decision: document the policy difference. Do not silently increase every application's
  memory policy from a microbenchmark; callers can choose `PRAGMA cache_size` for their
  workload. The temporary `benchmark/drivers.ts` normalization was hash-reverted to
  `d2b4ca…`, and `binding.gyp` to `c8d3e1…`.

### E5 row-array factory — not applicable to the published comparison

- The published by-id/range/iterator scenarios use object rows. `Array::Set` in
  `setReturnArrays(true)` mode is therefore not on their measured path and cannot explain
  better-sqlite3's numbers in the comparison table.
- The archived P05 already tested the broader raw-array-plus-JS-rematerialization design at
  the true 1,000-row shape: static ordinary keys reached `1.12×`, a compatible generic
  null-prototype loop reached `1.24×`, and the compiled compatible computed-key builder
  regressed to `0.90×`. No array-mode production change cleared that plan's acceptance bar.
- Decision: do not add an array-only diagnostic to the public suite for this investigation;
  E3/E6 directly isolate the object-row calls that the current benchmark actually executes.

## Validation

- [x] Spike patches fully reversed; native sources and restored-addon hashes match the baseline; `binding.gyp` retains only the corrected default-cache comment
- [x] No native change retained; experimental bulk-object smoke check passed before reversal
- [x] `npm test` — 59 suites passed, 923 tests passed, 1 suite/22 tests skipped
- [x] `npm run lint`
- [x] `cd benchmark && npx tsc --noEmit`
- [x] Documentation matches local better-sqlite3 13.0.3 source/package metadata
- [x] `git diff --check`, Prettier check, source hash checks, and spike-token search pass
