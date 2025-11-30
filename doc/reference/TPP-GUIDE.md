# Technical Project Plan (TPP) Guide

## Purpose

A TPP transfers expertise, not just instructions. A great TPP lets another engineer complete the work without asking questions—even if the code changed since you wrote it.

**The golden rule**: If an implementer fails because context was missing from your TPP, that's your failure, not theirs.

## Required Reading

Before writing any TPP, read and incorporate:

- **[SIMPLE-DESIGN.md](./SIMPLE-DESIGN.md)**: Kent Beck's Four Rules guide all design decisions
- **[TDD.md](./TDD.md)**: Bug fixes MUST start with a failing test

These are not optional. TPPs that ignore them will be rejected.

## TPP Structure

### Part 1: Define Success (5 minutes max)

Write one clear sentence for each:

```markdown
**Problem**: Statement.all() returns undefined for empty result sets
**Why it matters**: Breaks compatibility with node:sqlite which returns []
**Solution**: Match node:sqlite behavior in StatementSync::All()
**Success test**: `npm t -- --grep "empty result"`
**Key constraint**: Must match node:sqlite exactly—test against Node.js built-in
```

This is your North Star. Implementation details may change; the user need stays constant.

**For bug fixes** (per [TDD.md](./TDD.md)):

```markdown
**Bug**: Aggregate functions segfault on NULL accumulator
**Reproducing test**: `npm t -- --grep "aggregate null"` (currently fails)
**Root cause**: Dereferencing uninitialized Napi::Value
**Fix approach**: Add null check matching node_sqlite.cc:892
```

### Part 2: Share Your Expertise

This section prevents surprises. Skip it for straightforward changes—document only what's non-obvious.

#### A. Find the Patterns

Show what already works similarly:

```bash
# Find existing patterns
grep -r "AsyncProgressWorker" src/*.cpp
grep -r "BindValue" src/sqlite_impl.cpp

# Check if this is synced code (don't modify!)
ls src/upstream/
```

Document what you find:

- "Copy pattern from `src/sqlite_impl.cpp:DatabaseSync::Exec` for statement execution"
- "NEVER edit `src/upstream/*`—these files are synced from Node.js"

#### B. Document the Landmines

Share what will break and why:

```bash
# Find dependencies on current implementation
grep -r "StatementSync" src/*.cpp test/*.ts
npm t 2>&1 | grep -i "parameter"  # Tests that catch mistakes
```

Document the dangers:

- "N-API's `IsBuffer()` returns true for ALL ArrayBufferView types—check `IsDataView()` FIRST"
- "Cannot use `Napi::Reference` from SQLite callbacks—store POD types only"
- "Windows requires retry logic for temp file cleanup—use `useTempDir()` utility"

**Apply SIMPLE-DESIGN.md Rule 2 (Reveals Intention)**: Don't just say "this breaks"—explain why it was designed this way.

#### C. Plan for Change

If architecture changes, how should the implementer adapt?

```markdown
If BindValue() was refactored:

1. User need unchanged (bind parameters to statements)
2. Find new binding: `grep -r "bind" src/sqlite_impl.cpp`
3. Core goal: JS values → SQLite-bound parameters
```

### Part 3: Define Clear Tasks

Each task needs:

- **What success looks like** (with proof command)
- **How to implement** (with specific locations)
- **How to adapt** (if architecture changed)

```markdown
### Task: Fix empty result set handling

**Success**: `npm t -- --grep "empty result"` passes

**Implementation**:
1. Find StatementSync::All() in `src/sqlite_impl.cpp`
2. Check node_sqlite.cc behavior for empty results
3. Return empty array instead of undefined

**If architecture changed**:
- No StatementSync? Find statement class: `grep -r "class.*Statement" src/`
- Method renamed? Find result handling: `grep -r "\.all\|All(" src/`

**Proof of completion** (follows [SIMPLE-DESIGN.md](./SIMPLE-DESIGN.md) Rule 1):
- [ ] Test passes: `npm t -- --grep "empty result"`
- [ ] Behavior matches: Test against node:sqlite in Node.js 22+
- [ ] Old code removed: No workarounds remain (Rule 4 - fewest elements)
```

## node-sqlite Specific Concerns

### API Compatibility Is Non-Negotiable

Every feature must match `node:sqlite` exactly:

```typescript
// Test against Node.js built-in
import { DatabaseSync as NodeDB } from "node:sqlite";
import { DatabaseSync as OurDB } from "@photostructure/sqlite";

// Behavior must be identical
const nodeResult = new NodeDB(":memory:").prepare("SELECT 1").get();
const ourResult = new OurDB(":memory:").prepare("SELECT 1").get();
expect(ourResult).toEqual(nodeResult);
```

### Upstream Files Are Sacred

Never modify files in `src/upstream/`. They're synced from Node.js.

```bash
# Find upstream files
ls src/upstream/

# If upstream behavior seems wrong, check Node.js source first
# Reference: third-party/node/src/node_sqlite.cc
```

### N-API Gotchas to Document

When your task involves native code, document these traps:

| Issue | Symptom | Solution |
|-------|---------|----------|
| ArrayBufferView checking | DataView handled as Buffer | Check `IsDataView()` before `IsBuffer()` |
| SQLite callback context | Crash or corruption | Use POD types, not Napi::Reference |
| Aggregate state | Memory corruption | JSON serialize complex objects |
| Resource cleanup | Jest hangs | Close all databases in afterEach |

### Platform-Specific Failures

Document when behavior varies:

```markdown
**Windows**: File locks persist longer—use retry logic in cleanup
**Alpine ARM64**: 10x slower in CI—use `getTestTimeout()` for timing tests
**macOS**: VM performance varies—avoid exact timing assertions
```

## Anti-Patterns to Avoid

### "It Works" Without Proof

Bad: "I tested it and it works"
Good: "Test passes: `npm t -- --grep 'specific test name'`"

### Shelf-ware Code

Implementation exists but nothing uses it. Every feature needs integration proof:

```bash
# Prove production usage
grep -r "newFunction" src/ test/  # Must appear in both
```

### The 95% Trap

"Just needs cleanup" = 50% more work. Tasks are complete or incomplete—no percentages.

### Bogus Guardrails

Per [SIMPLE-DESIGN.md](./SIMPLE-DESIGN.md) Rule 5: Don't add defensive code for impossible cases. If assumptions are violated, fail visibly.

## Validation Requirements

### Required Evidence Types

Every checkbox needs proof another engineer can verify:

- **Commands that pass**: `npm t`, `npm run lint`, etc.
- **Code locations**: `src/sqlite_impl.cpp:234` where implementation exists
- **Integration proof**: `grep` commands showing production usage
- **Behavior comparison**: Test output against node:sqlite

### Definition of Complete

A task is complete when:

1. System behavior changes (provable with command)
2. Old workaround code removed
3. New capability used in production paths
4. All validation commands pass
5. `npm t` shows no regressions

### Common Over-Selling Patterns

Do NOT mark complete if:

- "Tests pass" but only for new code, not full suite
- "Implementation works" but no integration proof
- "Ready for review" but `npm run lint` fails
- "Feature complete" but old path still active

## Quality Checklist

Before marking your TPP ready:

- [ ] Problem and success fit in one paragraph
- [ ] Included commands that find relevant code
- [ ] Documented at least one "learned the hard way" lesson
- [ ] Each task has verifiable success command
- [ ] Explained how to adapt if code was refactored
- [ ] Bug fixes start with failing test ([TDD.md](./TDD.md))
- [ ] Code follows Four Rules ([SIMPLE-DESIGN.md](./SIMPLE-DESIGN.md))
- [ ] API compatibility with node:sqlite verified

## The Ultimate Test

Hand this TPP to someone unfamiliar with the codebase. If they can implement the solution without asking questions—even if the code was refactored—you've written an excellent TPP.

## TPP Template

Copy this structure for new TPPs--but omit sections that aren't relevant or helpful.

```markdown
# TPP: [Specific Project Name]

## Goal Definition

- **What Success Looks Like**: [1 sentence]
- **Core Problem**: [1 sentence]
- **Key Constraints**: [1 sentence—include API compatibility requirement]
- **Success Validation**: [1 sentence—include test command]

## Context Research

### Existing Patterns
[What similar code exists? Where?]

### Landmines
[What breaks easily? N-API gotchas? Platform issues?]

### node:sqlite Behavior
[What does the built-in do? Reference node_sqlite.cc lines]

## Tasks

### Don't blindly follow this section!

**It is your responsibility to complete (or at least make progress towards) this TPP's goal.**

These tasks were what seemed to be the best course of action at planning time.

As additional research and implementation details are completed, reconsider these task breakdowns and overall solution. If a new path can better follow ./SIMPLE-DESIGN.md, ask to revise the task breakdown and present the pros and cons of each approach.

### Task 1: [Name]

**Success**: `[test command]`

**Implementation**:
1. [Step with file:line]
2. [Step]

**If architecture changed**:
- [How to find new location]

**Completion checklist**:
- [ ] Test passes: `npm t -- --grep "..."`
- [ ] Integration shown: `grep -r "..." src/`
- [ ] Old code removed

### Task 2: ...

## Validation

- [ ] All tests pass: `npm t`
- [ ] Linting passes: `npm run lint`
- [ ] API matches node:sqlite
```

## File Naming

Place TPPs in `doc/todo/${priority}-${desc}.md` during work, move to `doc/done/${date}-${priority}-${desc}.md` when complete:

```
doc/todo/P01-fix-aggregate-null.md     # Priority 01, in progress
doc/done/20250115-P01-fix-aggregate.md # Completed with date prefix
```

Priority: P00 (critical) through P99 (nice-to-have).
