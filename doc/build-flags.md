# SQLite build flags and configuration

**TL;DR**: We include 8 additional SQLite features beyond Node.js (JSON, FTS4, Unicode normalization, etc.) plus security-hardened defaults (foreign keys enabled, stricter SQL parsing, larger cache). The API remains fully compatible.

This document describes the SQLite build flags used in @photostructure/sqlite, compares them with Node.js's configuration, and explains the rationale behind our choices.

## Overview

Our SQLite build enables a broad set of features while maintaining security and performance. This configuration differs from Node.js's more conservative approach by including FTS4, NORMALIZE, and stricter security settings.

## Build configuration files

- **Our build configuration**: [`binding.gyp`](https://github.com/photostructure/node-sqlite/blob/main/binding.gyp) (lines 22-54)
- **Node.js SQLite configuration**: [`sqlite.gyp`](https://github.com/nodejs/node/blob/main/deps/sqlite/sqlite.gyp) (lines 15-28)

## Complete build flags comparison

### Core features present in both

| Flag                             | Purpose                               | @photostructure/sqlite | Node.js | Notes                                                                            |
| -------------------------------- | ------------------------------------- | :--------------------: | :-----: | -------------------------------------------------------------------------------- |
| `SQLITE_ENABLE_COLUMN_METADATA`  | Column metadata APIs                  |           ✅           |   ✅    | Required for schema introspection                                                |
| `SQLITE_ENABLE_DBSTAT_VTAB`      | Database statistics virtual table     |           ✅           |   ✅    | Performance monitoring                                                           |
| `SQLITE_ENABLE_FTS3`             | Full-text search version 3            |           ✅           |   ✅    | Basic FTS support                                                                |
| `SQLITE_ENABLE_FTS3_PARENTHESIS` | Enhanced FTS3 query syntax            |           ✅           |   ✅    | Improved query capabilities                                                      |
| `SQLITE_ENABLE_FTS5`             | Full-text search version 5            |           ✅           |   ✅    | Latest FTS with best performance                                                 |
| `SQLITE_ENABLE_GEOPOLY`          | GeoJSON and polygon functions         |           ✅           |   ✅    | Spatial data support                                                             |
| `SQLITE_ENABLE_MATH_FUNCTIONS`   | Math functions (sin, cos, sqrt, etc.) |           ✅           |   ✅    | Mathematical operations                                                          |
| `SQLITE_ENABLE_PREUPDATE_HOOK`   | Pre-update hooks for sessions         |           ✅           |   ✅    | Change tracking support                                                          |
| `SQLITE_ENABLE_RBU`              | Resumable Bulk Update support         |           ✅           |   ✅    | Incremental database updates                                                     |
| `SQLITE_ENABLE_RTREE`            | R\*Tree spatial indexing              |           ✅           |   ✅    | Spatial indexing capabilities                                                    |
| `SQLITE_ENABLE_SESSION`          | Session and changeset support         |           ✅           |   ✅    | Database replication features                                                    |
| `SQLITE_DEFAULT_MEMSTATUS=0`     | Disabled memory usage tracking        |           ✅           |   ✅    | `sqlite3_malloc()` routines run much faster                                      |
| `SQLITE_ENABLE_JSON1`            | JSON functions and operators          |           ✅           |   ✅    | Modern web development requires JSON support, defaults to enabled since v3.38.0+ |

### Additional features we include

| Flag                                | Purpose                           | @photostructure/sqlite | Node.js | Rationale                                           |
| ----------------------------------- | --------------------------------- | :--------------------: | :-----: | --------------------------------------------------- |
| `SQLITE_ENABLE_FTS4`                | Full-text search version 4        |           ✅           |   ❌    | Bridge between FTS3 and FTS5, broader compatibility |
| `SQLITE_ENABLE_NORMALIZE`           | Unicode normalization             |           ✅           |   ❌    | Proper Unicode handling for international apps      |
| `SQLITE_ENABLE_SNAPSHOT`            | Database snapshots                |           ✅           |   ❌    | Advanced backup and point-in-time recovery          |
| `SQLITE_ENABLE_STAT4`               | Advanced query planner statistics |           ✅           |   ❌    | Better query optimization                           |
| `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` | LIMIT clause on UPDATE/DELETE     |           ✅           |   ❌    | SQL standard compliance                             |
| `SQLITE_SOUNDEX`                    | Soundex algorithm                 |           ✅           |   ❌    | Fuzzy string matching capabilities                  |
| `SQLITE_USE_URI=1`                  | URI filename support              |           ✅           |   ❌    | Advanced database configuration via URIs            |

### Security and safety configurations

These include the majority of [SQLite's recommended compile options](https://sqlite.org/compile.html#recommended_compile_time_options)

| Flag                               | Purpose                                                                                                | @photostructure/sqlite | Node.js | Notes                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | :--------------------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_DEFAULT_FOREIGN_KEYS=1`    | [Foreign keys enabled by default](https://sqlite.org/compile.html#:~:text=SQLITE_DEFAULT_FOREIGN_KEYS) |           ✅           |   ❌    | Data integrity by default                                                                                                                |
| `SQLITE_DQS=0`                     | [Double-quoted strings disabled](https://sqlite.org/compile.html#:~:text=SQLITE_DQS%3D0)               |           ✅           |   ❌    | Prevents SQL ambiguity                                                                                                                   |
| `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` | [Safe WAL mode defaults](https://sqlite.org/compile.html#:~:text=SQLITE_DEFAULT_WAL_SYNCHRONOUS%3D1)   |           ✅           |   ❌    | Durability vs performance balance                                                                                                        |
| `SQLITE_OMIT_DEPRECATED`           | [Remove deprecated features](https://sqlite.org/compile.html#:~:text=SQLITE_OMIT_DEPRECATED)           |           ✅           |   ❌    | Smaller, more secure API surface                                                                                                         |
| `SQLITE_OMIT_SHARED_CACHE`         | [Disable shared cache mode](https://sqlite.org/compile.html#:~:text=SQLITE_OMIT_SHARED_CACHE)          |           ✅           |   ❌    | Shared cache is deprecated                                                                                                               |
| `SQLITE_LIKE_DOESNT_MATCH_BLOBS`   | [LIKE doesn't match BLOB data](https://sqlite.org/compile.html#:~:text=SQLITE_LIKE_DOESNT_MATCH_BLOBS) |           ✅           |   ❌    | LIKE and GLOB operators always return FALSE if either operand is a BLOB                                                                  |
| `SQLITE_ENABLE_API_ARMOR`          | [Validate C-API arguments](https://sqlite.org/compile.html#enable_api_armor)                           |           ✅           |   ❌    | Misused API calls return `SQLITE_MISUSE` instead of risking undefined behavior; defense-in-depth for hosted extensions (e.g. sqlite-vec) |

### Platform-specific build settings

#### Standard build flags (all platforms)

| Flag                  | Purpose                          | Notes                                                                                                 |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NAPI_CPP_EXCEPTIONS` | N-API C++ exception support      | Required for proper error handling                                                                    |
| `NAPI_VERSION=8`      | Pins the Node-API surface        | 8 is the header default and our ABI floor; explicit so a node-addon-api bump cannot silently widen it |
| `HAVE_STDINT_H=1`     | Standard integer types available | Cross-platform compatibility                                                                          |
| `HAVE_USLEEP=1`       | usleep() function available      | Sleep functionality                                                                                   |

#### Compiler and linker hardening (POSIX)

We follow the [OpenSSF Compiler Options Hardening Guide](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html).
A `.node` addon is a **shared library**, so we use `-fPIC` and never `-fPIE`/`-pie`.

**Toolchain floor matters.** The shipped glibc prebuild is built in
`node:20-bullseye` (Debian 11, **GCC 10.2**) so the binary loads on Ubuntu 20.04+.
Every flag below was verified against _that_ compiler, not the developer's newer one.

| Flag                                          | Scope                           | Purpose                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-fstack-protector-strong`                    | C + C++                         | Stack-smashing canary                                                                                                                                                                          |
| `-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=2`       | C + C++                         | Compile/run-time buffer + libc misuse checks. `=3` needs GCC 12+, so on our GCC 10.2 floor it would silently degrade to `=2` — we ask for `=2` honestly. Requires `-O1`+ (Release uses `-O3`). |
| `-Wformat -Wformat=2 -Werror=format-security` | C + C++                         | Format-string hardening. **Keep all three together:** GCC 10 _errors_ on `-Werror=format-security` without `-Wformat`.                                                                         |
| `-fstack-clash-protection`                    | C + C++, Linux                  | Probe each stack page so a large frame cannot leap the guard page. Not supported by Apple clang.                                                                                               |
| `-fcf-protection=full`                        | C + C++, **Linux x86/x64 only** | Intel CET (IBT/shadow stack). **Hard-errors on arm64** — must stay arch-gated.                                                                                                                 |
| `-mbranch-protection=standard`                | C + C++, **Linux arm64 only**   | AArch64 PAC return-signing + BTI. **Unknown option on x86** — must stay arch-gated.                                                                                                            |
| `-D_GLIBCXX_ASSERTIONS`                       | C++, Linux                      | libstdc++ bounds/precondition assertions. (The libc++ analogue, `_LIBCPP_HARDENING_MODE`, is not yet available on our macOS toolchain.)                                                        |
| `-Wl,-z,relro -Wl,-z,now`                     | Linker, Linux                   | Full RELRO (GOT mapped read-only after load)                                                                                                                                                   |
| `-Wl,-z,noexecstack`                          | Linker, Linux                   | Non-executable stack (W^X)                                                                                                                                                                     |
| `-fvisibility=hidden`                         | C + C++                         | Hide internal symbols; this addon shares a process with V8, libuv, and possibly other SQLite addons                                                                                            |
| `-fvisibility-inlines-hidden`                 | C++                             | Same, for inline functions                                                                                                                                                                     |
| `-Wno-implicit-fallthrough`                   | **C only**                      | SQLite uses intentional switch fallthroughs. Scoped to `cflags_c` so it cannot mask an unannotated fallthrough in _our_ C++.                                                                   |

The `-Wl,-z,*` family is GNU-ld/ELF only — macOS `ld64` rejects it, so those flags
are confined to the Linux branch. macOS gets PIE/ASLR and W^X from the platform.

`_FORTIFY_SOURCE` is **disabled** in sanitizer builds ([`scripts/sanitizers-test.sh`](https://github.com/photostructure/node-sqlite/blob/main/scripts/sanitizers-test.sh)):
its libc interceptors collide with AddressSanitizer's and produce false results.

You can confirm the protections actually landed in the built artifact:

```bash
readelf -d  build/Release/phstr_sqlite.node | grep BIND_NOW   # full RELRO
readelf -lW build/Release/phstr_sqlite.node | grep GNU_STACK  # must be RW, not RWE
readelf -nW build/Release/phstr_sqlite.node | grep -i shstk   # Intel CET (x64)
readelf -sW build/Release/phstr_sqlite.node | grep _chk       # FORTIFY'd libc calls
```

#### Linux-specific performance settings

| Flag       | Scope            | Purpose                                                                                                                                                                                  |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-fno-plt` | C++ sources only | Calls Node-API symbols through the ELF GOT instead of the procedure linkage table, removing one indirection from each row-materialization call without changing the stable Node-API ABI. |

Pinned, alternating A/B measurements on the 1,000-row SELECT shape showed a
2.3% improvement for `all()` and 2.8% for `iterate()`. The flag is deliberately
Linux-only; macOS and Windows builds are unchanged.

#### Windows-specific security settings

For Windows builds, we include extensive security features:

Both architectures get `/Qspectre`, `/guard:cf`, `/ZH:SHA_256`, `/sdl` and
`/DYNAMICBASE`. They differ only in **backward-edge** control-flow integrity,
which is a genuine hardware difference:

| Protection                     | x64                                                                             | ARM64                           |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------- |
| Spectre v1 mitigation          | `/Qspectre`                                                                     | `/Qspectre`                     |
| Forward-edge CFI               | `/guard:cf`                                                                     | `/guard:cf`                     |
| **Backward-edge CFI (ROP)**    | `/CETCOMPAT` (Intel CET)                                                        | `/guard:signret` (hardware PAC) |
| ASLR                           | `/DYNAMICBASE`                                                                  | `/DYNAMICBASE`                  |
| Source-file hash               | `/ZH:SHA_256`                                                                   | `/ZH:SHA_256`                   |
| SDL checks                     | `/sdl`                                                                          | `/sdl`                          |
| Stack cookie, DEP, 64-bit ASLR | `/GS`, `/NXCOMPAT`, `/HIGHENTROPYVA` — **on by default**, not passed explicitly |

Two corrections to beliefs this document previously encoded:

- **`/Qspectre` is not x64-only.** MSVC has supported it on ARM/ARM64 since
  VS 2017 15.7 and ships Spectre-mitigated ARM64 libraries
  ([docs](https://learn.microsoft.com/en-us/cpp/build/reference/qspectre)).
  Omitting it left the ARM64 build under-hardened.
- **`/guard:cf` is forward-edge only.** ARM64 does not get backward-edge
  protection "for free" from PAC — it must be requested with `/guard:signret`
  (verified accepted by MSVC 19.44 / VS 2022 targeting ARM64).

`/CETCOMPAT` genuinely _is_ x64-only (CET shadow-stack is an Intel/AMD feature),
so its absence on ARM64 is correct.

## Rationale for extra features

### 1. JSON support (`SQLITE_ENABLE_JSON1`)

- Modern web applications use JSON extensively
- Enables efficient JSON storage and querying
- Faster than external JSON parsing
- Many other SQLite distributions include this

### 2. FTS4 (`SQLITE_ENABLE_FTS4`)

- Bridge between FTS3 and FTS5 for broader compatibility
- Supports applications migrating from older FTS versions
- Minimal overhead when not used

### 3. Unicode normalization (`SQLITE_ENABLE_NORMALIZE`)

- Proper Unicode handling for international applications
- Prevents Unicode-related data corruption
- Required for applications with non-ASCII text

### 4. Security defaults

- **Foreign Keys**: Enabled by default to prevent data integrity issues
- **DQS=0**: Prevents ambiguous SQL parsing
- **WAL Synchronous**: Balanced durability and performance

### 5. Performance features

- **STAT4**: Better query optimization with column statistics
- **16MB Cache**: Larger default cache for better performance
- **Multi-thread Mode**: Optimized for Node.js worker threads

## Features intentionally omitted

These SQLite features are available but not enabled in our build:

| Feature                       | Reason for omission                          |
| ----------------------------- | -------------------------------------------- |
| `SQLITE_ENABLE_ICU`           | Adds large ICU dependency, platform-specific |
| `SQLITE_ENABLE_MEMSYS3/5`     | Alternative allocators not needed            |
| `SQLITE_ENABLE_UNLOCK_NOTIFY` | Primarily for embedded systems               |
| `SQLITE_ENABLE_ATOMIC_WRITE`  | Platform-specific, limited benefit           |

## Security implications

### Enabled security features

1. **Foreign Key Enforcement**: Prevents referential integrity violations
2. **DQS=0**: Eliminates double-quoted string ambiguity
3. **Deprecated Feature Removal**: Reduces attack surface
4. **Safe WAL Defaults**: Balances performance with data durability

### Potential security considerations

1. **JSON Functions**: Could potentially be used for data exfiltration (mitigated by proper application design)
2. **Extension Loading**: Disabled by default in our implementation
3. **User-Defined Functions**: Properly sandboxed in our implementation

## Performance implications

### Performance benefits

1. **Larger Cache**: 16MB default vs 2MB improves read performance
2. **STAT4**: Better query optimization with advanced statistics
3. **Multi-thread Mode**: Optimized for concurrent access patterns
4. **JSON Functions**: Faster than external JSON parsing

### Performance considerations

1. **Binary Size**: Additional features increase library size by ~200KB
2. **Memory Usage**: More features mean higher base memory consumption
3. **Compilation Time**: More features extend build time
4. **API Armor**: `SQLITE_ENABLE_API_ARMOR` adds argument-validation checks at the C-API boundary. Benchmarking it on vs. off across `SELECT`/`INSERT`/`BLOB` workloads (30 trials each) showed all differences within run-to-run noise (~1–2%, with no consistent direction) — i.e. **no measurable runtime cost**, since the checks are never-taken branches on well-formed calls.

## Customizing build flags

To modify build flags for your specific use case:

### 1. Fork and modify

```bash
# Clone the repository
git clone https://github.com/photostructure/node-sqlite.git
cd node-sqlite

# Edit binding.gyp - modify the "defines" array
# Lines 22-54 contain the SQLite build flags

# Rebuild
npm run clean
npm run build:native
```

### 2. Common customizations

**Minimal build** (remove features):

```python
# Remove optional features for smaller binary
# Comment out or remove these lines:
"SQLITE_ENABLE_FTS4",
"SQLITE_ENABLE_JSON1",
"SQLITE_SOUNDEX",
"SQLITE_ENABLE_NORMALIZE",
```

**Maximum features** (add more features):

```python
# Add these to the defines array:
"SQLITE_ENABLE_ICU",           # Requires ICU library
"SQLITE_ENABLE_ATOMIC_WRITE",  # Platform-specific
```

**Performance tuning**:

```python
# Larger cache for memory-rich environments
"SQLITE_DEFAULT_CACHE_SIZE=-32000",  # 32MB cache

# Or smaller cache for memory-constrained environments
"SQLITE_DEFAULT_CACHE_SIZE=-4000",   # 4MB cache
```

## Maintenance and sync

### Keeping documentation in sync

When modifying build flags in `binding.gyp`:

1. **Update this document** with new flags and rationale
2. **Update [`features.md`](./features.md)** with user-facing feature descriptions
3. **Test thoroughly** to ensure new flags work correctly
4. **Update comparison tables** with any Node.js changes

### Monitoring upstream changes

We regularly check Node.js's `sqlite.gyp` for changes:

1. **Automated sync**: `scripts/sync-from-node.ts` monitors Node.js changes
2. **Manual review**: Quarterly review of Node.js SQLite configuration
3. **Issue tracking**: GitHub issues track when Node.js adds new flags

### Links for reference

- **SQLite Compile-Time Options**: https://sqlite.org/compile.html
- **SQLite Build Configuration**: https://sqlite.org/howtocompile.html
- **Node.js SQLite Source**: https://github.com/nodejs/node/tree/main/deps/sqlite
- **Our Build Configuration**: https://github.com/photostructure/node-sqlite/blob/main/binding.gyp
