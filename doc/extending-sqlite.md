# Extending SQLite

Learn how to extend SQLite with custom functions, aggregate functions, and loadable extensions.

## Custom Scalar Functions

Scalar functions operate on individual values and return a single result.

### Basic Functions

```javascript
import { DatabaseSync } from "@photostructure/sqlite";

const db = new DatabaseSync(":memory:");

// Simple function
db.function("double", (x) => x * 2);

// Use in SQL
const result = db.prepare("SELECT double(21) as answer").get();
console.log(result.answer); // 42

// Multiple parameters
db.function("multiply", (a, b) => a * b);
const product = db.prepare("SELECT multiply(6, 7) as result").get();
console.log(product.result); // 42
```

### Function Options

```javascript
// Deterministic function - same input always produces same output
db.function(
  "hash",
  {
    deterministic: true,
  },
  (value) => {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  },
);

// Direct-only function - cannot be used in triggers or views
db.function(
  "random_uuid",
  {
    directOnly: true,
  },
  () => {
    const crypto = require("crypto");
    return crypto.randomUUID();
  },
);

// Variable arguments function
db.function(
  "concat",
  {
    varargs: true,
  },
  (...args) => {
    return args.join("");
  },
);

// Use varargs function
const text = db
  .prepare('SELECT concat("Hello", " ", "World", "!") as msg')
  .get();
console.log(text.msg); // "Hello World!"
```

### Real-World Examples

#### String Manipulation

```javascript
// Reverse string function
db.function("reverse", (str) => {
  return str ? str.split("").reverse().join("") : null;
});

// Extract domain from email
db.function("email_domain", (email) => {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1].toLowerCase();
});

// Slugify function
db.function("slugify", (text) => {
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
});

// Usage
db.exec(`
  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    title TEXT,
    slug TEXT GENERATED ALWAYS AS (slugify(title)) STORED
  )
`);
```

#### Date and Time

```javascript
// Parse ISO date to Unix timestamp
db.function("iso_to_timestamp", (isoDate) => {
  const date = new Date(isoDate);
  return Math.floor(date.getTime() / 1000);
});

// Format timestamp as relative time
db.function("time_ago", (timestamp) => {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;

  const intervals = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
});

// Usage
const posts = db
  .prepare(
    `
  SELECT title, time_ago(created_at) as posted
  FROM posts
  ORDER BY created_at DESC
`,
  )
  .all();
```

#### JSON Operations

```javascript
// Parse JSON and extract field
db.function("json_get", (jsonStr, path) => {
  try {
    const obj = JSON.parse(jsonStr);
    return path.split(".").reduce((o, p) => o?.[p], obj);
  } catch {
    return null;
  }
});

// Check if JSON contains value
db.function("json_contains", (jsonStr, value) => {
  try {
    const obj = JSON.parse(jsonStr);
    return JSON.stringify(obj).includes(value) ? 1 : 0;
  } catch {
    return 0;
  }
});
```

## Custom Aggregate Functions

Aggregate functions process multiple rows and return a single result.

### Basic Aggregates

```javascript
// Custom sum aggregate
db.aggregate("custom_sum", {
  start: 0,
  step: (total, value) => total + (value || 0),
});

// Custom average with null handling
db.aggregate("custom_avg", {
  start: { sum: 0, count: 0 },
  step: (acc, value) => {
    if (value != null) {
      acc.sum += value;
      acc.count += 1;
    }
    return acc;
  },
  result: (acc) => (acc.count > 0 ? acc.sum / acc.count : null),
});
```

### Advanced Aggregates

#### Statistical Functions

```javascript
// Standard deviation
db.aggregate("stddev", {
  start: { values: [] },
  step: (acc, value) => {
    if (value != null) acc.values.push(value);
    return acc;
  },
  result: (acc) => {
    if (acc.values.length === 0) return null;

    const mean = acc.values.reduce((a, b) => a + b) / acc.values.length;
    const variance =
      acc.values.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) /
      acc.values.length;

    return Math.sqrt(variance);
  },
});

// Median
db.aggregate("median", {
  start: { values: [] },
  step: (acc, value) => {
    if (value != null) acc.values.push(value);
    return acc;
  },
  result: (acc) => {
    if (acc.values.length === 0) return null;

    acc.values.sort((a, b) => a - b);
    const mid = Math.floor(acc.values.length / 2);

    return acc.values.length % 2 === 0
      ? (acc.values[mid - 1] + acc.values[mid]) / 2
      : acc.values[mid];
  },
});
```

#### String Aggregation

```javascript
// Group concat with custom separator
db.aggregate("group_concat_custom", {
  start: () => ({ values: [], separator: null }),
  step: (acc, value, separator) => {
    if (value != null) acc.values.push(value);
    if (separator != null && acc.separator === null) {
      acc.separator = separator;
    }
    return acc;
  },
  result: (acc) => acc.values.join(acc.separator || ","),
});

// Usage
const tags = db
  .prepare(
    `
  SELECT group_concat_custom(tag, ' | ') as all_tags
  FROM post_tags
  WHERE post_id = ?
`,
  )
  .get(postId);
```

#### JSON Aggregation

```javascript
// Aggregate into JSON array
db.aggregate("json_array_agg", {
  start: [],
  step: (acc, value) => {
    if (value != null) acc.push(value);
    return acc;
  },
  result: (acc) => JSON.stringify(acc),
});

// Aggregate into JSON object
db.aggregate("json_object_agg", {
  start: {},
  step: (acc, key, value) => {
    if (key != null) acc[key] = value;
    return acc;
  },
  result: (acc) => JSON.stringify(acc),
});

// Usage
const userPrefs = db
  .prepare(
    `
  SELECT json_object_agg(key, value) as preferences
  FROM user_settings
  WHERE user_id = ?
`,
  )
  .get(userId);
```

### Window Functions

Aggregate functions can be used as window functions in SQLite:

```javascript
// Cumulative sum aggregate
db.aggregate("cumsum", {
  start: 0,
  step: (sum, value) => sum + (value || 0),
});

// Use as window function
const results = db
  .prepare(
    `
  SELECT 
    date,
    amount,
    cumsum(amount) OVER (ORDER BY date) as running_total
  FROM transactions
  WHERE account_id = ?
`,
  )
  .all(accountId);
```

## Loading Extensions

SQLite supports loadable extensions to add functionality at runtime.

### Enabling Extensions

```javascript
// Must be enabled in constructor
const db = new DatabaseSync("myapp.db", {
  allowExtension: true,
});

// Enable extension loading
db.enableLoadExtension(true);

// Load an extension
db.loadExtension("./extensions/vector.so");

// Disable for security
db.enableLoadExtension(false);
```

### Platform-Specific Extensions

```javascript
const path = require("path");
const os = require("os");

function loadExtension(db, extensionName) {
  // Determine platform-specific extension
  let ext;
  switch (os.platform()) {
    case "win32":
      ext = ".dll";
      break;
    case "darwin":
      ext = ".dylib";
      break;
    default:
      ext = ".so";
  }

  const extensionPath = path.join(__dirname, "extensions", extensionName + ext);

  db.enableLoadExtension(true);
  try {
    db.loadExtension(extensionPath);
    console.log(`Loaded extension: ${extensionName}`);
  } finally {
    db.enableLoadExtension(false);
  }
}

// Usage
loadExtension(db, "vector"); // Loads vector.so/.dll/.dylib
loadExtension(db, "crypto"); // Loads crypto extension
```

### Common Extensions

#### Vector Search Extension

```javascript
// After loading vector extension
db.exec(`
  CREATE VIRTUAL TABLE products_vec USING vec0(
    embedding float[384]
  );
`);

// Insert embeddings
const insertVec = db.prepare(`
  INSERT INTO products_vec(rowid, embedding) VALUES (?, ?)
`);

// Search similar vectors
const similar = db
  .prepare(
    `
  SELECT rowid, distance
  FROM products_vec
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 10
`,
  )
  .all(queryEmbedding);
```

#### Full-Text Search (Built-in)

```javascript
// FTS5 is built into this package
db.exec(`
  CREATE VIRTUAL TABLE articles_fts USING fts5(
    title, 
    content,
    tags,
    tokenize = 'porter unicode61'
  );
`);

// Populate FTS table
db.exec(`
  INSERT INTO articles_fts(title, content, tags)
  SELECT title, content, tags FROM articles;
`);

// Search
const results = db
  .prepare(
    `
  SELECT title, snippet(articles_fts, 1, '<b>', '</b>', '...', 32) as excerpt
  FROM articles_fts
  WHERE articles_fts MATCH ?
  ORDER BY rank
`,
  )
  .all("sqlite NEAR extension");
```

## Best Practices

### Error Handling in Functions

```javascript
db.function("safe_divide", (a, b) => {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
});

// More graceful error handling
db.function("safe_json_parse", (jsonStr) => {
  try {
    return JSON.stringify(JSON.parse(jsonStr));
  } catch (e) {
    return null; // Return null instead of throwing
  }
});
```

### Performance Considerations

```javascript
// Deterministic functions can be optimized by SQLite
db.function(
  "expensive_calculation",
  {
    deterministic: true, // SQLite can cache results
  },
  (input) => {
    // Complex calculation
    return complexMath(input);
  },
);

// Avoid creating closures in hot paths
const cache = new Map();
db.function("cached_lookup", (key) => {
  if (!cache.has(key)) {
    cache.set(key, expensiveLookup(key));
  }
  return cache.get(key);
});
```

### Testing Custom Functions

```javascript
// Test helper
function testFunction(db, functionName, testCases) {
  for (const { input, expected } of testCases) {
    const sql = `SELECT ${functionName}(${input.map(() => "?").join(",")}) as result`;
    const result = db.prepare(sql).get(...input);

    if (result.result !== expected) {
      throw new Error(
        `${functionName}(${input.join(", ")}) = ${result.result}, expected ${expected}`,
      );
    }
  }
  console.log(`✓ ${functionName} passed all tests`);
}

// Test custom functions
testFunction(db, "double", [
  { input: [5], expected: 10 },
  { input: [0], expected: 0 },
  { input: [-3], expected: -6 },
]);
```

## Next Steps

- [Advanced Patterns](./advanced-patterns.md) - Worker threads, backups, and sessions
- [API Reference](./api-reference.md) - Complete API documentation
- [Library Comparison](./library-comparison.md) - Compare with other SQLite libraries
