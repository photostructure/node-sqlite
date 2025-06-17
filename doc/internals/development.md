# Development

Information about the development of @photostructure/sqlite.

## Project Timeline

This project demonstrates modern software development practices with AI assistance:

- **900+ lines of C++** - Core SQLite binding implementation
- **17,000+ lines of TypeScript tests** - Comprehensive test coverage
- **400+ tests** with full API compliance running in both ESM and CJS modes
- **Multi-platform CI/CD** with dedicated ARM64 and x64 build jobs across all platforms
- **Security scanning** and memory leak detection
- **Automated sync** from Node.js and SQLite upstream
- **Robust [benchmarking suite](../../benchmark/README.md)** including all popular Node.js SQLite libraries

## AI-Assisted Development

This project was built with substantial assistance from [Claude Code](https://claude.ai/referral/gM3vgw7pfA), an AI coding assistant.

### Development Cost

- **API usage**: ~$1400 in Claude API tokens
- **Actual cost**: $200/month MAX 20x plan subscription
- **Time saved**: At least a month of setup, analysis, porting and testing

### Development Process

1. **Initial Analysis**: Claude analyzed the Node.js SQLite source code and architecture
2. **Shim Layer Design**: Developed compatibility layer for Node.js internals
3. **Implementation**: Ported C++ code with N-API adaptations
4. **Testing**: Created comprehensive test suite with 400+ tests
5. **Documentation**: Generated user and API documentation
6. **CI/CD**: Set up multi-platform build and release pipeline

### Quality Assurance

While AI significantly accelerated development, all code underwent:

- Human review before merging
- Comprehensive automated testing
- Memory leak detection (Valgrind, ASAN)
- Security scanning (npm audit, Snyk, OSV, CodeQL)
- Performance benchmarking

This approach demonstrates how AI-assisted development can accelerate complex system programming while maintaining high code quality through comprehensive testing and human oversight.

## Building from Source

### Prerequisites

- Node.js 20+
- Python 3.8+
- C++ compiler:
  - **Linux**: GCC 10+ or Clang 10+
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio 2019+

### Build Commands

```bash
# Install dependencies
npm install

# Build native module
npm run build:native

# Run tests
npm test

# Run benchmarks
npm run benchmark
```

### Development Workflow

```bash
# Watch mode for TypeScript
npm run watch

# Lint code
npm run lint

# Format code
npm run fmt

# Run specific test file
npm test -- working-with-data.test.ts
```

## Architecture

See [Architecture Documentation](./architecture.md) for details on:

- Shim layer design
- Node.js compatibility approach
- Memory management strategy
- Threading model

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Code Style

- TypeScript/JavaScript: Prettier with project config
- C++: clang-format with project style
- Commit messages: Conventional Commits format

### Testing Requirements

- New features must include tests
- Tests must pass on all platforms
- Memory leak tests for native code
- Benchmark comparisons for performance changes

## Release Process

See [Release Process](./release-process.md) for detailed release instructions.

## Upstream Synchronization

The project maintains synchronization with:

- Node.js SQLite implementation
- SQLite amalgamation source

```bash
# Sync from Node.js
npm run sync:node

# Update SQLite version
npm run sync:sqlite
```

## Resources

- [Node.js N-API Documentation](https://nodejs.org/api/n-api.html)
- [SQLite C API Reference](https://sqlite.org/c3ref/intro.html)
- [Node-addon-api](https://github.com/nodejs/node-addon-api)
