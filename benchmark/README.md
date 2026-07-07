# SQLite Driver Benchmarks

Performance and memory benchmarks comparing `@photostructure/sqlite` against other popular SQLite libraries for Node.js.

## Summary

The performance of @photostructure/sqlite is broadly comparable to node:sqlite and better-sqlite3. Each scenario reports a median over multiple trials plus a 95% margin of error, so run-to-run noise is visible rather than hidden.

## Libraries Tested

- **@photostructure/sqlite** - This package
- **better-sqlite3** - Popular synchronous SQLite3 binding
- **node:sqlite** - Node.js built-in SQLite (when available)

Not benchmarked:

- **sqlite3** - The classic asynchronous binding ([`node-sqlite3`](https://github.com/TryGhost/node-sqlite3)) is [deprecated / effectively unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) and its async, callback-based API isn't a meaningful apples-to-apples comparison with these synchronous drivers, so it is excluded.

## Installation

```bash
cd benchmark
npm install
```

> **Note:** better-sqlite3 ships prebuilt binaries via the (deprecated) `prebuild-install`, which may lag the newest Node.js releases. If the benchmark prints `Error in better-sqlite3: Could not locate the bindings file`, build it from source:
>
> ```bash
> npm rebuild better-sqlite3 --build-from-source
> ```

## Running Benchmarks

### Performance Benchmarks

```bash
# Run all benchmarks
npm run bench

# Run specific scenario types
npm run bench select      # Only SELECT query benchmarks
npm run bench insert      # Only INSERT operation benchmarks
npm run bench transaction # Only transaction benchmarks

# Advanced options
tsx index.ts --drivers @photostructure/sqlite,better-sqlite3
tsx index.ts select --drivers @photostructure/sqlite,node:sqlite
tsx index.ts --verbose
tsx index.ts --memory     # Include memory usage tracking
```

### Memory Benchmarks

```bash
# Run memory leak detection (requires --expose-gc)
npm run bench:memory

# Or run directly with tsx
tsx --expose-gc memory-benchmark.ts

# Test specific drivers
tsx --expose-gc memory-benchmark.ts --drivers @photostructure/sqlite,better-sqlite3

# Test specific scenarios
tsx --expose-gc memory-benchmark.ts --scenarios prepare-finalize,large-select

# Adjust iterations for leak detection
tsx --expose-gc memory-benchmark.ts --iterations 100
```

### Command Line Options

#### Performance Benchmarks (`index.ts`)

- `--drivers <list>` - Comma-separated list of drivers to test
- `--verbose` - Show detailed output during benchmarking
- `--memory` - Track memory usage during performance tests
- `--help` - Show usage information

#### Memory Benchmarks (`memory-benchmark.ts`)

- `--drivers <list>` - Comma-separated list of drivers to test
- `--scenarios <list>` - Comma-separated list of memory scenarios to run
- `--iterations <n>` - Number of iterations for leak detection (default: 50)
- `--help` - Show usage information

### Example Commands

```bash
# Compare just the sync drivers
npm run bench -- --drivers @photostructure/sqlite,better-sqlite3,node:sqlite

# Test only SELECT performance
npm run bench select

# Run memory tests with more iterations for accuracy
tsx --expose-gc memory-benchmark.ts --iterations 100

# Test specific memory scenario
tsx --expose-gc memory-benchmark.ts --scenarios blob-handling
```

## Benchmark Scenarios

### Performance Scenarios

1. **select-by-id** - Single row retrieval by primary key
2. **select-range** - Fetch up to 1k rows with WHERE clause and index
3. **select-iterate** - Iterator performance over 1k rows
4. **insert-simple** - Single row inserts
5. **insert-transaction** - Bulk inserts (1k rows) in transaction
6. **select-join** - Complex JOIN with aggregation
7. **insert-blob** - Binary data handling (10KB blobs)
8. **update-indexed** - UPDATE operations using indexed columns
9. **delete-bulk** - Bulk DELETE in transactions

(See the [example results](#summary) below for approximate throughput; absolute numbers vary by hardware and Node.js version.)

### Memory Scenarios

1. **prepare-finalize** - Statement lifecycle memory management
2. **large-select** - Memory handling with large result sets
3. **blob-handling** - Binary data memory management
4. **transaction-stress** - Memory usage in large transactions
5. **prepare-cache** - Statement cache stress testing

## Output Format

### Performance Results

The benchmark outputs clean markdown tables that can be directly copied into documentation. Absolute numbers depend on hardware and Node.js version — the example below is one run (Linux x64, Node 24) and is only meant to show the format and rough relationships. Each cell is a median with a 95% margin of error.

### Summary

| Scenario              | @photostructure/sqlite |      better-sqlite3 |         node:sqlite |
| --------------------- | ---------------------: | ------------------: | ------------------: |
| SELECT by Primary Key |    110,000 ops/s ±1.6% | 130,000 ops/s ±1.8% | 120,000 ops/s ±2.5% |
| SELECT Range          |      8,300 ops/s ±1.7% |  25,000 ops/s ±2.4% |  12,000 ops/s ±2.5% |
| SELECT with Iterator  |        680 ops/s ±3.4% |   1,300 ops/s ±3.8% |   1,200 ops/s ±1.9% |
| INSERT Single Row     |        400 ops/s ±0.7% |     400 ops/s ±1.5% |     390 ops/s ±1.0% |
| INSERT in Transaction |        250 ops/s ±1.7% |     280 ops/s ±2.6% |     300 ops/s ±2.2% |
| SELECT with JOIN      |      1,800 ops/s ±0.5% |   2,100 ops/s ±0.4% |   1,800 ops/s ±0.8% |
| INSERT with BLOB      |        380 ops/s ±1.8% |     380 ops/s ±0.6% |     380 ops/s ±1.1% |
| UPDATE with Index     |        400 ops/s ±1.6% |     390 ops/s ±1.7% |     400 ops/s ±3.0% |
| DELETE Bulk           |        180 ops/s ±1.2% |     200 ops/s ±1.2% |     210 ops/s ±1.9% |

### Overall performance ranking

| Rank | Driver                 | Score |
| ---: | ---------------------- | ----: |
|    1 | better-sqlite3         |   98% |
|    2 | node:sqlite            |   91% |
|    3 | @photostructure/sqlite |   81% |

Key features:

- **Adaptive iteration counts**: calibrates each scenario to ~50 ms per trial, then runs many trials for a median + margin of error
- **Markdown-ready output**: Tables can be directly copied into documentation
- **Comma-formatted numbers**: Easy to read large operation counts
- **Overall performance ranking**: Weighted average across all scenarios

### Memory Results

Memory benchmarks also output markdown-ready tables:

```
SQLite Driver Memory Benchmark

Testing @photostructure/sqlite

  Statement Prepare/Finalize: Tests for memory leaks in statement lifecycle
    OK - No memory leak detected
    Heap growth: 0.12 KB/iteration (R²=0.045)
    External growth: 0.00 KB/iteration (R²=0.001)

Summary

| Scenario                   | @photostructure/sqlite | better-sqlite3 | node:sqlite |
| -------------------------- | ---------------------- | -------------- | ----------- |
| Statement Prepare/Finalize | OK                     | OK             | OK          |
| Large Result Sets          | OK                     | OK             | OK          |
| BLOB Memory Management     | OK                     | OK             | OK          |
```

Memory table generated above - copy/paste ready for documentation!

Features:

- **Leak detection**: Automatically identifies potential memory leaks (>1KB/iteration growth)
- **Statistical analysis**: R² correlation values show trend strength
- **Multiple scenarios**: Tests various memory usage patterns
- **Markdown output**: Ready for documentation

## Interpreting Results

### Performance Metrics

- **Ops/sec**: Operations per second (higher is better)
- **Relative**: Performance relative to fastest driver
- **Margin**: Error margin (lower is more consistent)
- **Runs**: Number of benchmark samples collected

### Memory Metrics

- **Heap growth**: Memory growth rate per iteration
- **External growth**: Native memory growth rate
- **R²**: Correlation coefficient (closer to 1 = stronger trend)
- **Leak detection**: Flags potential memory leaks (>1KB/iteration)

## Advanced Features

The benchmark system automatically calibrates iteration counts and scales results based on operation complexity to ensure fair comparisons across all drivers.

## Notes

- **sqlite3 Performance**: The sqlite3 driver shows lower performance in synchronous-style benchmarks because it's inherently asynchronous. Note: sqlite3 is [deprecated and unmaintained](https://github.com/TryGhost/node-sqlite3/pull/1844) since December 2025.
- **Memory Testing**: Always run memory benchmarks with `--expose-gc` for accurate garbage collection control.
- **Real-world Performance**: These benchmarks test specific patterns. Real application performance depends on your specific use case.

## Contributing

To add new benchmark scenarios:

1. Add scenario to `scenarios.js` for performance tests
2. Add scenario to `memory-benchmark.js` for memory tests
3. Follow the existing pattern for setup/run/cleanup
4. Ensure scenarios are fair across all drivers

## License

Same as parent project
