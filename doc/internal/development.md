# Development

Information about the development of @photostructure/sqlite.

## Project overview

- Full API compliance running in both ESM and CJS modes
- Multi-platform CI/CD with dedicated ARM64 and x64 build jobs across all platforms
- Security scanning and memory leak detection
- Automated sync from Node.js and SQLite upstream
- [Benchmarking suite](../../benchmark/README.md) covering popular Node.js SQLite libraries

## AI-assisted development

This project was built with substantial assistance from [Claude Code](https://claude.ai/referral/gM3vgw7pfA), an AI coding assistant.

### Development process

1. **Analysis**: Claude analyzed the Node.js SQLite source code and architecture
2. **Shim layer**: Developed compatibility layer for Node.js internals
3. **Implementation**: Ported C++ code with N-API adaptations
4. **Testing**: Created test suite
5. **Documentation**: Generated user and API documentation
6. **CI/CD**: Set up multi-platform build and release pipeline

### Quality assurance

All code was reviewed by a human and validated by automated tests before merging:

- Automated testing across platforms
- Memory leak detection (Valgrind, ASAN)
- Security scanning (npm audit, OSV, CodeQL)
- Performance benchmarking

## Building from source

### Prerequisites

- Node.js 22+
- Python 3.8+
- C++ compiler:
  - **Linux**: GCC 10+ or Clang 10+
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio 2019+

### Build commands

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

### Development workflow

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

### Code style

- TypeScript/JavaScript: Prettier with project config
- C++: clang-format with project style
- Commit messages: Conventional Commits format

### Testing requirements

- New features must include tests
- Tests must pass on all platforms
- Memory leak tests for native code
- Benchmark comparisons for performance changes

## Release process

See [Release Process](./release-process.md) for detailed release instructions.

## Upstream synchronization

The project maintains synchronization with:

- Node.js SQLite implementation
- SQLite amalgamation source

### GitHub API authentication

To avoid rate limiting when syncing from GitHub (60 requests/hour for unauthenticated requests), set up authentication:

```bash
# Set your GitHub personal access token
export GITHUB_TOKEN=your_personal_access_token

# Now sync commands will use authentication (5000 requests/hour)
npm run sync:node
npm run sync:sqlite
```

You can create a personal access token at: https://github.com/settings/tokens

The token only needs public repository read access.

### Sync commands

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
