---
name: tpp
description: Work on a Technical Project Plan - research, design, implement, or complete tasks based on current phase. Use when starting or continuing work on a TPP.
allowed-tools: Bash Read Glob Grep Edit Write WebSearch Skill
---

# Work on TPP

Make progress on the referenced Technical Project Plan. Determine the current phase and take appropriate action.

## Required Reading First

Before any work, you MUST read:

- [CLAUDE.md](CLAUDE.md) - Project rules and patterns
- [SIMPLE-DESIGN.md](doc/reference/SIMPLE-DESIGN.md) - Kent Beck's Simple Design
- [TDD.md](doc/reference/TDD.md) - Test-driven development
- [TPP-GUIDE.md](doc/reference/TPP-GUIDE.md) - TPP style guide

## Process

### 1. Read the TPP

Find and read the referenced TPP from `doc/todo/` (named `${priority}-${desc}.md`). Identify the current phase from the checklist.

### 2. Take Action Based on Phase

| Phase                    | Action                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| **Research & Planning**  | Read referenced docs and code. Gather context. Update TPP with findings. |
| **Write breaking tests** | Follow TDD approach - write failing tests first.                         |
| **Design alternatives**  | Iterate on design with critiques, consider multiple approaches.          |
| **Breakdown of tasks**   | Create specific, verifiable task list with commands.                     |
| **Implementation**       | Work through tasks sequentially. Update TPP as you go.                   |
| **Review & Refinement**  | Review changed code. Address issues. Check API compatibility.            |
| **Final Integration**    | Run full test suite. Verify all acceptance criteria.                     |
| **Review**               | Present completion proof to user.                                        |

### 3. Update the TPP

After each work session:

- Check off completed phases/tasks
- Add discoveries to Tribal Knowledge
- Document failed approaches and why
- Keep under 400 lines (trim redundancy)

### 4. Completion

When all phases are complete:

1. Run verification commands from the TPP
2. Ensure all tests pass (`npm test`)
3. Review all changes for API compatibility with `node:sqlite`
4. Present proof of completion to user
5. After user approval, move TPP to `doc/done/` with date prefix

```bash
# Example: P01-fix-aggregate-null.md -> 20250203-P01-fix-aggregate-null.md
git mv doc/todo/P01-feature.md doc/done/$(date +%Y%m%d)-P01-feature.md
```

## Phase Details

### Research & Planning

- Read all "Required reading" in the TPP
- Explore referenced source files
- Check Node.js SQLite and better-sqlite3 for API reference
- Web search for prior art if needed
- Consult `../node-addon-api/` for N-API questions
- Document findings in the TPP

### Design Alternatives

- Generate 2-4 approaches
- Critique each for simplicity, testability, maintainability
- Consider API compatibility with `node:sqlite`
- Iterate at least 3 times
- Document final recommendation in TPP

### Task Breakdown

Each task must include:

- Clear deliverable
- Files to change
- Success criteria
- Verification command

### Implementation

- Work tasks sequentially
- Mark tasks complete as you go
- Run verification after each task
- Update TPP with any discoveries
- Follow N-API best practices (see `../node-addon-api/`)

## Remember

- Transfer expertise, not just instructions
- Document what didn't work and why
- Ask for clarification when uncertain
- The next engineer should be able to continue seamlessly
- Maintain API compatibility with `node:sqlite`
