# Using with Knex.js

[@photostructure/knex-sqlite](https://github.com/photostructure/knex-sqlite) provides a Knex.js dialect that uses @photostructure/sqlite as the SQLite driver instead of better-sqlite3.

## Installation

```bash
npm install @photostructure/knex-sqlite @photostructure/sqlite knex
```

## Setup

```javascript
const knex = require("knex");
const Client = require("@photostructure/knex-sqlite");

const db = knex({
  client: Client,
  connection: {
    filename: "./mydb.sqlite",
  },
  useNullAsDefault: true,
});
```

## Connection options

```javascript
const db = knex({
  client: Client,
  connection: {
    filename: "./mydb.sqlite",
    options: {
      readonly: false, // open as read-only
      safeIntegers: false, // return BigInt for large integers
    },
  },
  useNullAsDefault: true,
});
```

## Features

All standard Knex.js features work: schema building, queries, transactions, joins, aggregations, raw SQL, and `RETURNING` clauses on INSERT/UPDATE.

```javascript
// Schema
await db.schema.createTable("users", (table) => {
  table.increments("id");
  table.string("name");
  table.integer("age");
});

// CRUD
await db("users").insert({ name: "Alice", age: 30 });
const users = await db("users").where("age", ">", 25).select("*");

// Transactions
await db.transaction(async (trx) => {
  await trx("users").insert({ name: "Bob", age: 25 });
  await trx("posts").insert({ user_id: 1, title: "Hello" });
});
```

## How it works

The dialect extends Knex's built-in `Client_BetterSQLite3` and adapts three things:

1. **Driver**: loads @photostructure/sqlite and calls `enhance()` to add better-sqlite3-style methods
2. **Statement `.reader` property**: uses `stmt.columns().length > 0` to detect whether a statement returns rows (correctly handles `RETURNING` clauses)
3. **Binding format**: spreads array bindings as variadic arguments, and maps `safeIntegers()` to `setReadBigInts()`

See the [@photostructure/knex-sqlite README](https://github.com/photostructure/knex-sqlite) for full details.
