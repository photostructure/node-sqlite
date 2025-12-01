# Security Policy

## Supported Versions

Security updates are provided for the latest released version only.

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Report via:
- Email: security@photostructure.com
- GitHub's private vulnerability reporting

Include: issue type, affected source files, reproduction steps, and potential impact.

We acknowledge reports within 48 hours and provide detailed response within 7 days.

## Security Measures

### Automated Scanning

- **npm audit** and **OSV Scanner** for dependency vulnerabilities
- **CodeQL** for JS/TS and C++ semantic analysis
- **TruffleHog** for secrets detection
- **ESLint Security Plugin** for static analysis

Scans run on every push, PR, and weekly.

### Native Code Security

- Uses official SQLite amalgamation source with recommended security flags
- C++ code analyzed with clang-tidy and ASAN
- Memory safety validated through comprehensive testing

## Security Configuration

```javascript
// Read-only mode
const db = new DatabaseSync("database.db", { readonly: true });

// Extension loading (disabled by default)
db.allowExtension();
db.enableLoadExtension(true);
db.loadExtension("path/to/extension");
```

### Best Practices

1. Use parameterized queries to prevent SQL injection
2. Validate user input before use in queries
3. Run with minimal permissions
4. Keep dependencies updated

## Disclosure Policy

Upon receiving a report, we confirm the issue, audit for similar problems, prepare fixes, and coordinate disclosure with the reporter.
