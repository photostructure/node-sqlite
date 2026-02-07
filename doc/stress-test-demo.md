# SQLite stress test demo

This document explains how to use the stress test system that generates 100MB+ databases and tests performance against other SQLite libraries.

## Features

- **Complex schema**: Users, Posts, Comments, Categories, Tags with foreign keys and junction tables
- **Natural data**: Realistic names, emails, content without external dependencies
- **Advanced SQLite features**: FTS5 full-text search, JSON columns, composite/partial indexes
- **100MB+ datasets**: Chunked generation to prevent memory issues
- **Performance scenarios**: Complex JOINs, FTS searches, bulk operations, concurrent access
- **Cross-library comparison**: @photostructure/sqlite vs better-sqlite3, node:sqlite, sqlite3

## Quick start

### Run default stress test (100MB database)

```bash
npm run stress
```

This will:

1. Generate a 100MB database with realistic data
2. Test all available drivers
3. Run all stress scenarios
4. Display performance comparison table

### Custom options

```bash
# Test specific drivers
npm run stress -- --drivers @photostructure/sqlite,better-sqlite3

# Target different database size
npm run stress -- --size 50

# Test specific scenarios only
npm run stress -- --scenarios stress-fts-search,stress-complex-joins

# JSON output for analysis
npm run stress -- --output json

# Verbose progress reporting
npm run stress -- --verbose

# Use existing database (skip generation)
npm run stress -- --skip-generation --db-path ./my-large-db.db
```

## Schema overview

The stress test creates a realistic blog/CMS schema:

### Tables

- **users**: User profiles with JSON preferences and stats
- **categories**: Content categorization
- **tags**: Flexible content tagging
- **posts**: Blog posts with rich metadata and JSON fields
- **comments**: Threaded comments system
- **post_tags**: Many-to-many junction table

### Advanced features

- **FTS5**: Full-text search on posts (title, excerpt, content)
- **JSON Columns**: Metadata, preferences, stats stored as JSON
- **Foreign Keys**: Proper referential integrity
- **Composite Indexes**: Multi-column indexes for common queries
- **Partial Indexes**: Conditional indexes for performance

## Performance scenarios

### 1. Complex JOIN operations

Multi-table queries with aggregations:

- Popular posts with author, category, comment counts
- User statistics with post/comment counts
- Category breakdowns with author counts

### 2. Full-text search performance

FTS5 searches across large content:

- Content search with snippet highlighting
- Title-only searches
- Phrase searches with ranking

### 3. Bulk operations with constraints

Large transactions with foreign keys:

- Bulk insert posts with comments
- Batch update post statistics
- Mass tag assignments

### 4. Concurrent read operations

Simulating multiple read patterns:

- Random post retrieval
- Recent posts queries
- Post with comments aggregation
- User profile loading

## Data generation

The system generates natural-looking data without external dependencies:

### User data

- Real first/last names from curated lists
- Realistic email addresses with common domains
- Phone numbers, bios, avatar URLs
- JSON preferences and statistics

### Content data

- Article titles and excerpts
- Natural language content using common words
- Categories like Technology, Science, Business
- Tags like tutorial, guide, javascript, python

### Relationships

- Foreign key relationships respected
- Many-to-many post-tag associations
- Threaded comment hierarchies
- Realistic data distribution

## Example output

```
SQLite Stress Test Suite
Target size: 100MB
Drivers: @photostructure/sqlite, better-sqlite3, node:sqlite

Generating test dataset...
Database generated in 45.3s
Final size: 103.2MB

Table statistics:
  users: 100,000 records
  posts: 200,000 records
  comments: 800,000 records
  categories: 50 records
  tags: 200 records
  post_tags: 400,000 records

Testing @photostructure/sqlite
  Running Complex JOIN Operations...
    1,245 ops/sec
  Running Full-Text Search Performance...
    523 ops/sec
  Running Bulk Operations with Constraints...
    89 ops/sec
  Running Concurrent Read Operations...
    2,134 ops/sec

Stress Test Results
Database size: 103.2MB

| Scenario | @photostructure/sqlite | better-sqlite3 | node:sqlite |
|---|---:|---:|---:|
| Complex JOIN Operations | 1,245 ops/s | 1,289 ops/s | 1,203 ops/s |
| Full-Text Search Performance | 523 ops/s | 556 ops/s | 501 ops/s |
| Bulk Operations with Constraints | 89 ops/s | 92 ops/s | 87 ops/s |
| Concurrent Read Operations | 2,134 ops/s | 2,198 ops/s | 2,087 ops/s |

Overall Performance Ranking

| Rank | Driver | Score |
|---:|---|---:|
| 1 | better-sqlite3 | 98% |
| 2 | @photostructure/sqlite | 94% |
| 3 | node:sqlite | 91% |

Resource Usage
Database Size: 103.2MB
Total Records: 140,000
Fastest Operation: 2,198 ops/sec (better-sqlite3)
```

## Validation tests

Run unit tests for the stress test components:

```bash
npm run stress:validate
```

This validates:

- Data generator produces consistent, realistic data
- Schema creation works correctly
- All indexes and FTS tables are created
- Foreign key relationships are maintained
- Scenarios execute without errors

## Use cases

### Performance regression testing

Run before/after releases to detect performance regressions:

```bash
# Before changes
npm run stress -- --output json > before.json

# After changes
npm run stress -- --output json > after.json

# Compare results programmatically
```

### Library comparison

Compare performance across SQLite libraries:

```bash
npm run stress -- --drivers @photostructure/sqlite,better-sqlite3,node:sqlite
```

### Scalability testing

Test how performance scales with database size:

```bash
npm run stress -- --size 10   # 10MB
npm run stress -- --size 50   # 50MB
npm run stress -- --size 100  # 100MB
npm run stress -- --size 500  # 500MB
```

### Scenario-specific testing

Focus on specific performance aspects:

```bash
# Test only FTS performance
npm run stress -- --scenarios stress-fts-search

# Test only JOIN performance
npm run stress -- --scenarios stress-complex-joins
```

## Architecture notes

### Memory management

- Chunked data generation prevents OOM on large datasets
- Progress reporting every 10 chunks
- Automatic cleanup of temporary files

### Cross-platform

- Deterministic data generation for reproducible results
- Platform-aware file handling
- Consistent performance measurement

### Extensibility

- Easy to add new scenarios
- Pluggable data generators
- Configurable schema elements

## Contributing

To add new stress scenarios:

1. Add scenario to `benchmark/stress-scenarios.ts`
2. Follow existing pattern: setup/run/cleanup
3. Include performance measurement
4. Add validation tests
5. Update documentation

To modify the schema:

1. Update `createStressSchema()` function
2. Adjust data generation accordingly
3. Update example queries in scenarios
4. Test with different data sizes
