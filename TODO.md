# TODO: @photostructure/sqlite

This document tracks the remaining tasks before releasing v1.0.0.

## 🚧 Remaining Tasks

### High Priority

- [ ] Support for [worker threads](./WORKER-THREAD-SUPPORT.md)
- [ ] **Upload prebuilds to GitHub releases** - Enable automatic distribution
- [ ] **Test prebuild downloads** - Verify installation works correctly

### Medium Priority

- [ ] **Resource limits testing** - Test SQLite resource limit handling
- [ ] **Concurrent access patterns** - Test multi-process/thread scenarios (worker threads causing segfaults)

### Low Priority

- [ ] **Error message compatibility** - Match Node.js error formatting exactly
- [ ] **Enhanced memory tracking** - Node.js-style memory management

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
