# Testing Philosophy

This document outlines the testing approach and philosophy for @photostructure/sqlite.

## Error Handling Testing Philosophy

### Core Principle: Behavior Over Messages

We prioritize **functional behavior** over exact error message matching in our test suite.

### What We Test For

✅ **What matters:**

- Errors occur in the right circumstances
- Appropriate error types are thrown (Error, TypeError, RangeError, etc.)
- Error objects have the correct properties (sqliteCode, sqliteExtendedCode, etc.)
- Functions fail safely without crashes or memory leaks
- Recovery behavior after errors

❌ **What doesn't matter:**

- Exact error message text
- Specific wording variations
- Platform-specific error details
- Minor differences between Node.js versions

### Testing Patterns

#### ✅ Good: Functional Error Testing

```typescript
// Test that an error occurs in the right circumstance
expect(() => {
  stmt.get(); // Function that should throw
}).toThrow(); // Just verify an error is thrown

// Test for specific error types when important
expect(() => {
  db.prepare("INVALID SQL");
}).toThrow(Error); // Or TypeError, RangeError, etc.

// Test error properties when they matter
try {
  stmt.get();
} catch (error) {
  expect(error.sqliteCode).toBe(19); // SQLITE_CONSTRAINT
  expect(error.code).toBe("SQLITE_CONSTRAINT");
}
```

#### ❌ Avoid: Brittle Message Matching

```typescript
// Brittle - exact message matching
expect(() => {
  stmt.get();
}).toThrow("Exactly this error message");

// Brittle - regex patterns for user function errors
expect(() => {
  stmt.get();
}).toThrow(/user function error|Test error/);
```

### Rationale

1. **Cross-platform compatibility**: Error messages can vary between operating systems
2. **Node.js version independence**: Different Node.js versions may phrase errors differently
3. **Implementation flexibility**: Our error messages may differ from Node.js built-in messages
4. **Maintenance burden**: Exact message matching creates brittle tests that break on minor wording changes
5. **Focus on functionality**: The important thing is that errors occur when they should

### Exceptions to the Rule

There are cases where message content **is** important to test:

#### SQLite-specific error codes and properties

```typescript
// These are standardized and should be tested
expect(error.sqliteCode).toBe(19);
expect(error.code).toBe("SQLITE_CONSTRAINT");
expect(error.sqliteErrorString).toBe("constraint failed");
```

#### API contract violations

```typescript
// When testing argument validation
expect(() => {
  db.prepare(null);
}).toThrow(TypeError); // Type matters, message doesn't
```

#### Critical security or data integrity messages

```typescript
// When the specific message indicates a security issue
expect(() => {
  db.loadExtension("/etc/passwd");
}).toThrow(/not allowed|security|permission/i);
```

## Memory and Resource Testing

### Memory Leak Prevention

- Use the benchmark harness for memory tests that require statistical analysis
- Focus on memory growth patterns rather than absolute values
- Account for garbage collection timing variations

### Resource Cleanup Testing

- Verify databases, statements, and sessions are properly cleaned up
- Test resource cleanup in error conditions
- Use `using` declarations and RAII (Resource Acquisition Is Initialization) patterns where possible

## Platform Considerations

### CI Environment Differences

- GitHub Actions runners vary significantly in performance
- Alpine Linux ARM64 emulation is 5-20x slower
- Windows process operations are 4x slower
- Account for these differences in timeout values

### Adaptive Testing

```typescript
import { getTestTimeout } from "./test-timeout-config.cjs";

test(
  "operation with adaptive timeout",
  async () => {
    // Test code
  },
  getTestTimeout(10000),
); // Automatically adjusts for platform
```

## Compatibility Testing Strategy

### Node.js Built-in Comparison

- Compare behavior, not exact output
- Focus on API surface and functional compatibility
- Allow for reasonable implementation differences

### better-sqlite3 Compatibility

- Test drop-in replacement scenarios
- Verify similar performance characteristics
- Allow for different error handling approaches

## Test Organization

### Test File Naming

- `*.test.ts` - Standard test files
- `*-simple.test.ts` - Simplified versions focused on core functionality
- `*-stress.test.ts` - Performance and stress testing
- `*-compatibility.test.ts` - Cross-implementation compatibility

### Test Categories

- **Unit tests**: Individual function/method testing
- **Integration tests**: Multi-component interaction testing
- **Compatibility tests**: Cross-implementation behavior comparison
- **Memory tests**: Leak detection and resource management
- **Platform tests**: Cross-platform behavior verification

## Contributing Guidelines

When writing new tests:

1. **Focus on behavior**: Test what the code should do, not exact error messages
2. **Use descriptive test names**: Clearly indicate what behavior is being tested
3. **Group related tests**: Use `describe` blocks to organize related functionality
4. **Add context**: Include comments explaining why specific test patterns are used
5. **Consider platforms**: Write tests that work reliably across all supported platforms

When updating existing tests:

1. **Preserve intent**: Understand what the original test was trying to verify
2. **Improve reliability**: Replace brittle patterns with robust alternatives
3. **Document changes**: Explain why changes were made in commit messages
4. **Test thoroughly**: Verify changes work across different environments

This philosophy helps maintain a robust, reliable test suite that accurately validates functionality while remaining maintainable across different environments and implementation details.
