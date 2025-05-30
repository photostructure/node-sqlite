# SQLite Driver Benchmarks

Performance and memory benchmarks comparing `@photostructure/sqlite` against other popular SQLite libraries for Node.js.

## Summary

The performance of @photostructure/sqlite is quite similar to node:sqlite and better-sqlite3, while significantly faster than async sqlite3.

## Libraries Tested

- **@photostructure/sqlite** - This package
- **better-sqlite3** - Popular synchronous SQLite3 binding
- **sqlite3** - Classic asynchronous SQLite3 binding
- **node:sqlite** - Node.js built-in SQLite (when available)

## Installation

```bash
cd benchmark
npm install
```

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

1. **select-by-id** - Single row retrieval by primary key (143k+ ops/sec)
2. **select-range** - Fetch up to 1k rows with WHERE clause and index (13k+ ops/sec)
3. **select-iterate** - Iterator performance over 1k rows (700+ ops/sec)
4. **insert-simple** - Single row inserts (700+ ops/sec)
5. **insert-transaction** - Bulk inserts (1k rows) in transaction (300+ ops/sec)
6. **select-join** - Complex JOIN with aggregation (1.8k+ ops/sec)
7. **insert-blob** - Binary data handling (10KB blobs) (600+ ops/sec)
8. **update-indexed** - UPDATE operations using indexed columns (700+ ops/sec)
9. **delete-bulk** - Bulk DELETE in transactions (80+ ops/sec)

### Memory Scenarios

1. **prepare-finalize** - Statement lifecycle memory management
2. **large-select** - Memory handling with large result sets
3. **blob-handling** - Binary data memory management
4. **transaction-stress** - Memory usage in large transactions
5. **prepare-cache** - Statement cache stress testing

## Output Format

### Performance Results

The benchmark outputs clean markdown tables that can be directly copied into documentation:

### 📈 Summary

| Scenario | @photostructure/sqlite | better-sqlite3 | node:sqlite | sqlite3 |
|---|---:|---:|---:|---:|
| SELECT by Primary Key | 150,000 ops/s | 150,000 ops/s | 140,000 ops/s | 24,000 ops/s |
| SELECT Range | 13,000 ops/s | 14,000 ops/s | 13,000 ops/s | 5,600 ops/s |
| SELECT with Iterator | 710 ops/s | 860 ops/s | 750 ops/s | 610 ops/s |
| INSERT Single Row | 720 ops/s | 720 ops/s | 740 ops/s | 710 ops/s |
| INSERT in Transaction | 340 ops/s | 350 ops/s | 350 ops/s | 38 ops/s |
| SELECT with JOIN | 1,800 ops/s | 2,000 ops/s | 1,800 ops/s | 1,600 ops/s |
| INSERT with BLOB | 640 ops/s | 660 ops/s | 650 ops/s | 590 ops/s |
| UPDATE with Index | 750 ops/s | 720 ops/s | 740 ops/s | 720 ops/s |
| DELETE Bulk | 89 ops/s | 90 ops/s | 83 ops/s | 25 ops/s |


### 🏆 Overall Performance Ranking

| Rank | Driver | Score |
|---:|---|---:|
| 1 🥇 | better-sqlite3 | 99% |
| 2 🥈 | @photostructure/sqlite | 94% |
| 3 🥉 | node:sqlite | 94% |
| 4 🐌 | sqlite3 | 58% |

Key features:

- **Adaptive iteration counts**: Automatically calibrates to run each scenario for ~2 seconds
- **Markdown-ready output**: Tables can be directly copied into documentation
- **Comma-formatted numbers**: Easy to read large operation counts
- **Overall performance ranking**: Weighted average across all scenarios

### Memory Results

Memory benchmarks also output markdown-ready tables:

```
💾 SQLite Driver Memory Benchmark

📊 Testing @photostructure/sqlite

  Statement Prepare/Finalize: Tests for memory leaks in statement lifecycle
    ✓ No memory leak detected
    Heap growth: 0.12 KB/iteration (R²=0.045)
    External growth: 0.00 KB/iteration (R²=0.001)

📈 Summary

| Scenario | @photostructure/sqlite | better-sqlite3 | node:sqlite | sqlite3 |
|---|---|---|---|---|
| Statement Prepare/Finalize | ✓ OK | ✓ OK | ✓ OK | ✓ OK |
| Large Result Sets | ✓ OK | ✓ OK | ✓ OK | ✓ OK |
| BLOB Memory Management | ✓ OK | ✓ OK | ✓ OK | ✓ OK |

📋 Memory table generated above - copy/paste ready for documentation!
```

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

- **sqlite3 Performance**: The sqlite3 driver shows lower performance in synchronous-style benchmarks because it's inherently asynchronous.
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
