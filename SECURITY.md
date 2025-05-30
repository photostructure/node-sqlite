# Security Policy

## Supported Versions

Currently, we support security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take the security of @photostructure/sqlite seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. Email us at security@photostructure.com
2. Use GitHub's private vulnerability reporting feature (if available)

### What to Include

Please include the following information in your report:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- We will acknowledge receipt of your vulnerability report within 48 hours
- We will provide a more detailed response within 7 days
- We will work on fixes and coordinate disclosure timeline with you

## Security Measures

### Automated Security Scanning

This project employs multiple layers of automated security scanning:

1. **npm audit** - Scans for known vulnerabilities in dependencies
2. **Snyk** - Advanced vulnerability detection and remediation
3. **OSV Scanner** - Google's Open Source Vulnerabilities scanner
4. **CodeQL** - GitHub's semantic code analysis for both JavaScript/TypeScript and C++
5. **TruffleHog** - Secrets detection in code

These scans run automatically on:

- Every push to the main branch
- Every pull request
- Weekly scheduled scans
- Manual workflow dispatch

### Development Practices

- All dependencies are regularly updated via Dependabot
- Security patches are prioritized and released quickly
- Native C++ code is analyzed with clang-tidy and ASAN
- Memory safety is validated through comprehensive testing

### Native Code Security

Since this package includes native C++ bindings to SQLite:

- We use the official SQLite amalgamation source
- SQLite is compiled with recommended security flags
- Buffer overflows are prevented through careful memory management
- All user inputs are properly validated before passing to SQLite

## Security Configuration

### SQLite Security Features

The following SQLite security features are available:

```javascript
// Restrict file access to read-only
const db = new DatabaseSync("database.db", {
  readonly: true,
});

// Disable extension loading by default
// Extensions must be explicitly enabled
db.allowExtension(); // Required first
db.enableLoadExtension(true); // Then enable
db.loadExtension("path/to/extension");
```

### Best Practices

1. **Always validate and sanitize user input** before using in SQL queries
2. **Use parameterized queries** to prevent SQL injection
3. **Run with minimal permissions** when possible
4. **Keep dependencies updated** regularly
5. **Monitor security advisories** for SQLite and Node.js

## Disclosure Policy

When we receive a security report, we will:

1. Confirm the problem and determine affected versions
2. Audit code to find similar problems
3. Prepare fixes for all supported versions
4. Coordinate disclosure with the reporter

We aim to disclose vulnerabilities responsibly, balancing the need for users to be informed with giving them time to update.
