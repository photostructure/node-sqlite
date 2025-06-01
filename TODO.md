# TODO: @photostructure/sqlite

This document tracks the remaining tasks before releasing v1.0.0.

## ✅ Recently Completed

- ✅ **Worker thread support** - Full support with proper V8 isolate handling (see [WORKER-THREAD-SUPPORT.md](./WORKER-THREAD-SUPPORT.md))
  - Fixed static constructor issue causing HandleScope errors
  - Each worker thread gets its own isolated environment
  - 100% test success rate (was ~85% before fix)
  - No special initialization required
- ✅ **Hybrid ESM/CJS package** - Full dual-package support implemented
  - tsup configuration for modern build pipeline
  - Package.json exports field for proper module resolution
  - Tests run in both CJS and ESM modes
  - Simplified TypeScript configuration (from 6+ files to 3)

## 🚧 Remaining Tasks

### High Priority

- [x] **Upload prebuilds to GitHub releases** - Enable automatic distribution
  - ✅ Added .release-it.json configuration
  - ✅ GitHub Actions workflow already includes release automation
  - ✅ Prebuild naming includes libc tags (e.g., .glibc.node, .musl.node)
  - ✅ Added Node.js 24 to test matrix
- [ ] **Test prebuild downloads** - Verify installation works correctly

### Medium Priority

- [x] **Resource limits testing** - Test SQLite resource limit handling
  - ✅ Created comprehensive resource limits tests (test/resource-limits.test.ts)
  - ✅ Tested SQL statement length, column counts, attached databases
  - ✅ Tested expression depth, JOIN complexity, LIKE patterns
  - ✅ Verified SQLite's built-in constraints are properly enforced
- [x] **Concurrent access patterns** - Test multi-process scenarios
  - ✅ Created comprehensive concurrent access tests (test/concurrent-access.test.ts)
  - ✅ Created multi-process tests with child processes (test/multi-process-simple.test.ts)
  - ✅ Tested database locking, WAL mode, transaction isolation
  - ✅ Verified SQLite handles concurrent operations correctly

### Testing

- [ ] **Compare with Node.js built-in SQLite** (when available)
  - [ ] API surface area comparison
  - [ ] Behavior verification
  - [ ] Performance benchmarking
- [ ] **Integration tests** with real applications

### Future Enhancements

- [ ] **Automated upstream sync workflow** - GitHub Action for Node.js updates
- [ ] **Automated PR creation for upstream changes**
- [ ] **Change detection and compatibility validation**
- [ ] **Review and optimize SQLite compile flags**
- [ ] **Memory allocation strategies**
- [ ] **I/O optimization settings**
- [ ] **Migration guide from other SQLite libraries**
- [ ] **Performance tuning guide** - Advanced optimization tips
- [ ] **Example applications repository** - Real-world usage examples

### Maintenance

- [ ] **Dependency management**
  - [ ] Keep Node-API and build tools updated
  - [ ] Monitor for security updates
  - [ ] Test compatibility with new Node.js versions
- [ ] **SQLite version updates**
  - [ ] Track SQLite releases
  - [ ] Test with new SQLite versions
  - [ ] Update build configuration as needed
- [ ] **Issue templates**
  - [ ] Bug report template
  - [ ] Feature request template
  - [ ] Support question template
- [ ] **Documentation maintenance**
  - [ ] Keep README updated
  - [ ] Maintain CHANGELOG
  - [ ] Update API documentation

## Priority Levels

🔴 **Critical** - Core functionality (COMPLETED!)
🟡 **Important** - Production readiness  
🟢 **Enhancement** - Developer experience
🔵 **Future** - Nice to have

## Notes

- Core SQLite operations are fully functional
- Package is ready for production use with advanced features
- Focus on prebuild distribution and remaining test coverage
- Ready for alpha/beta releases
