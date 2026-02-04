---
name: handoff
description: Update or create a TPP for engineer handoff when session context is running low. Use when ending a session, handing off work, or capturing progress on complex tasks.
allowed-tools: Read Edit Write Glob Grep
disable-model-invocation: true
---

# TPP Handoff

We're out of time and need to hand off remaining work to a new engineer (or future session).

## Your Task

1. **Find or create the TPP** - Check `doc/todo/` for an active TPP matching current work
2. **Re-read key documents** - Review [TPP-GUIDE.md](doc/reference/TPP-GUIDE.md), [TDD.md](doc/reference/TDD.md), [SIMPLE-DESIGN.md](doc/reference/SIMPLE-DESIGN.md)
3. **Update progress** - Mark completed tasks, update current phase with completion checklists
4. **Add context** - Document discoveries, gotchas, and insights from this session
5. **Record failures** - Include attempted approaches that didn't work, and why
6. **Prepare next steps** - Clarify what remains and any blockers

## TPP Location

- **Active work**: `doc/todo/P{NN}-{desc}.md` (e.g., `doc/todo/P01-fix-aggregate-null.md`)
- **Completed**: Move to `doc/done/{date}-P{NN}-{desc}.md`
- **Priority**: P00 (critical) through P99 (nice-to-have)

Create `doc/todo/` and `doc/done/` directories if they don't exist.

## Style Guide

Follow [TPP-GUIDE.md](doc/reference/TPP-GUIDE.md):

- Keep under 400 lines (trim redundancy, clarify, simplify)
- Transfer expertise, not just instructions
- Highlight uncertainties for the next engineer to explore
- Include verification commands for completed work
- Be precise about what tests validate vs. what requires code review

## Key Sections to Update

- **Goal Definition** - Problem, why it matters, success test, key constraints
- **Context Research** - Patterns found, landmines discovered, node:sqlite behavior
- **Tasks** - Mark done items, add new discoveries, include completion checklists
- **Tribal Knowledge** - N-API gotchas, platform-specific issues, learned the hard way

## node-sqlite Specific Concerns

When documenting, remember to include:

- **API compatibility**: Does behavior match `node:sqlite` exactly?
- **Upstream files**: Never modify `src/upstream/*` - note if upstream sync is needed
- **N-API patterns**: Document traps like ArrayBufferView checking, SQLite callback context, aggregate state
- **Platform issues**: Windows file locks, Alpine ARM64 slowness, macOS VM timing
- **Test coverage**: What the test actually validates vs. what's validated by code review

## Validation Requirements

Every completed task needs verifiable proof:

- Commands that pass: `npm t`, `npm run lint`, etc.
- Code locations: `src/sqlite_impl.cpp:234` where implementation exists
- Integration proof: `grep` commands showing production usage
- Behavior comparison: Test output against node:sqlite

## The Goal

The next engineer should be able to continue seamlessly without asking questions—even if the code changed since you wrote the TPP.
