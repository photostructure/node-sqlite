# Test-Driven Development and Bug Fixing

## Mandatory Bug-Fixing Workflow

When a bug or defect is discovered, you **MUST** follow this exact sequence:

### 1. Create a Breaking Test

Write a test that reproduces the issue:

- Clearly isolate the problematic behavior
- Use minimal test data that triggers the bug
- Give it a descriptive name explaining what should work

### 2. Validate the Test Explodes

Run the test to confirm it fails for the exact reason you expect:

- Must fail due to the bug, not test setup issues
- Verify failure mode matches the reported issue, (and isn't exposing yet another bug, or making an invalid assertion)

### 3. Address the Bug

Fix the underlying issue:

- Ensure we retain API compatibility as much as possible with `node:sqlite`
- Include comments referencing Node.js or SQLite source when applicable

### 4. Validate the Test Passes

Confirm the fix works:

- Test now passes completely
- Run full test suite (`npm t`) to ensure no regressions

## Test Design Principles

- **Isolation**: One test per issue, minimal test data
- **Clarity**: Descriptive names, comments explaining the issue
- **Reproducibility**: Consistent, deterministic test data

## Integration with node:sqlite

When fixing bugs:

1. Research `node:sqlite`'s behavior for this case
2. Compare implementations to find divergence
3. Consult SQLite documentation for expected behavior
4. Test against Node.js built-in SQLite when possible
