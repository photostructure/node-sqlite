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

**Build hardening.** Released binaries are compiled with the [OpenSSF Compiler
Options Hardening Guide](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html)
baseline on every platform we ship:

| Protection             | Linux                                                                                       | macOS                      | Windows                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| Stack smashing         | `-fstack-protector-strong`, `-fstack-clash-protection`                                      | `-fstack-protector-strong` | `/GS` (default), `/sdl`                      |
| Buffer / libc misuse   | `-D_FORTIFY_SOURCE=2`, `-D_GLIBCXX_ASSERTIONS`                                              | `-D_FORTIFY_SOURCE=2`      | `/sdl`                                       |
| Forward-edge CFI       | `-fcf-protection=full` (x64, Intel CET IBT); `-mbranch-protection=standard` (arm64, BTI)    | —                          | `/guard:cf`                                  |
| Backward-edge CFI      | `-fcf-protection=full` (x64, CET shadow stack); `-mbranch-protection=standard` (arm64, PAC) | —                          | `/CETCOMPAT` (x64), `/guard:signret` (arm64) |
| Spectre v1             | —                                                                                           | —                          | `/Qspectre`                                  |
| RELRO / non-exec stack | `-Wl,-z,relro -Wl,-z,now -Wl,-z,noexecstack`                                                | n/a (ld64)                 | n/a                                          |
| ASLR                   | `-fPIC`                                                                                     | default                    | `/DYNAMICBASE`, `/HIGHENTROPYVA`             |

See [build configuration details](./doc/build-flags.md).

**Vendored SQLite supply chain.** We compile the official SQLite amalgamation
directly into the addon, with SQLite's recommended security options (including
[API armor](https://sqlite.org/compile.html#enable_api_armor)). The sync tooling
verifies each download against a **SHA3-256 hash pinned in this repository** and
refuses to vendor a mismatch, so a corrupted or tampered amalgamation cannot
reach the compiler.

**Analysis in CI.** Every push and PR runs:

- **AddressSanitizer + LeakSanitizer + UndefinedBehaviorSanitizer** and
  **Valgrind Memcheck** over the full test suite. Leak suppressions deliberately
  never wildcard N-API frames, so first-party leaks cannot be masked.
- **clang-tidy**, gating on ownership/lifetime checks (use-after-move,
  dangling-handle, unchecked-optional-access, the NewDelete/Malloc analyzers,
  and rule-of-five on our resource-owning classes).
- **CodeQL** C++ semantic analysis.

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
