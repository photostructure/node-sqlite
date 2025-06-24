# Aggregate Function Double Free Analysis and Solution

## Problem Statement

When replacing an aggregate function (same name and parameter count) after it has been executed, a double free error occurs:

```
free(): double free detected in tcache 2
Aborted (core dumped)
```

## Reproduction Steps

1. Register an aggregate function with `inverse` (window function) or without
2. **Execute the aggregate** (which creates SQLite aggregate context)
3. **Replace the aggregate** with another function of same name and parameter count

```javascript
const db = new Database(":memory:");
db.aggregate("agg", { step: (ctx, a, b) => a * b + ctx, inverse: () => {} });
const result = db.prepare("SELECT agg(10, 20)").pluck().get(); // Execute
db.aggregate("agg", { step: (ctx, a, b) => "foo", inverse: () => {} }); // CRASH
```

## Valgrind Analysis

```
Invalid write of size 1 at address 0x4349bdf8 (360 bytes inside a 368-byte freed block)
Invalid read of size 4 at address 0x4349bc9c (12 bytes inside the same freed block)
```

This shows:

- CustomAggregate object (368 bytes) is deleted via `xDestroy`
- But SQLite callbacks still try to access the destroyed object
- Race condition between SQLite's destruction and callback execution

## Root Cause Analysis

### Architectural Comparison

| Implementation         | Storage Model                     | Destructor         | External Storage     |
| ---------------------- | --------------------------------- | ------------------ | -------------------- |
| **Node.js**            | `Global<Value>` in SQLite context | Simple delete      | None                 |
| **better-sqlite3**     | `Global<Value>` in SQLite context | Virtual destructor | None                 |
| **Our implementation** | Complex external storage maps     | Complex cleanup    | Mutex-protected maps |

### Key Findings

#### 1. Node.js Implementation

```cpp
struct aggregate_data {
    Global<Value> value;
    bool initialized;
    bool is_window;
};

static void xDestroy(void* self) {
    delete static_cast<CustomAggregate*>(self);
}
```

#### 2. better-sqlite3 Implementation

```cpp
struct Accumulator {
    v8::Global<v8::Value> value;
    bool initialized;
    bool is_window;
};

// Critical safety check:
#define AGGREGATE_START() \
    _FUNCTION_START(CustomAggregate); \
    Accumulator* acc = self->GetAccumulator(invocation); \
    if (acc->value.IsEmpty()) return  // EXIT EARLY IF DESTROYED

static void xDestroy(void* self) {
    delete static_cast<CustomFunction*>(self);
}
```

#### 3. Our Implementation (Problematic)

```cpp
struct AggregateData {
    enum ValueType { ... } value_type;
    union { double number_val; int32_t string_id; int32_t object_id; ... };
    // ... complex state
};

// Complex external storage
std::unordered_map<int32_t, std::string> string_storage_;
std::unordered_map<int32_t, Napi::Reference<Napi::Value>> object_storage_;
std::mutex storage_mutex_;

// Complex destructor with race conditions
~CustomAggregate() {
    std::lock_guard<std::mutex> lock(storage_mutex_);
    for (auto& it : object_storage_) {
        it.second.Reset(); // RACE CONDITION HERE
    }
    // ... more complex cleanup
}
```

### The Problem

Our **complex external storage system** creates race conditions:

1. SQLite calls `xDestroy` on old aggregate during replacement
2. Our destructor starts cleaning up external storage maps
3. SQLite still has active contexts referencing the old aggregate
4. Those contexts try to access `object_storage_` while it's being destroyed
5. **Double free / use-after-free occurs**

## Previous Solution Attempts

### ❌ Attempt 1: Destruction Flags

```cpp
std::atomic<bool> is_destroyed_{false};
// Problem: Accessing the flag itself caused use-after-free
```

### ❌ Attempt 2: Simplified Destructor

```cpp
// Skip complex cleanup, only reset Napi::Reference objects
// Problem: Still had external storage access
```

### ❌ Attempt 3: Empty Destructor

```cpp
// Problem: Caused segfaults due to unreleased Napi::Reference objects
```

### ❌ Attempt 4: Node.js-style Aggregate Cleanup

```cpp
// Added DestroyAggregateData() like Node.js
// Problem: Didn't address the fundamental architectural issue
```

## Solution: Architectural Simplification

### Implementation Plan

#### Phase 1: Simplify Storage Model

1. **Remove external storage maps**
   - Eliminate `object_storage_` and `string_storage_`
   - Remove `storage_mutex_` and related complexity
   - Remove storage helper methods

2. **Store values directly in SQLite context**
   - Change `AggregateData` to store `Napi::Reference<Napi::Value>` directly
   - Follow Node.js/better-sqlite3 pattern of simple storage

#### Phase 2: Update Data Structures

```cpp
// NEW: Simplified aggregate data (like Node.js/better-sqlite3)
struct AggregateData {
    Napi::Reference<Napi::Value> value;  // Direct storage like Node.js
    bool initialized;
    bool is_window;
    bool first_call;
};
```

#### Phase 3: Simplify Value Management

1. **Remove type enum and union**
   - No more `ValueType` enum
   - No more union of primitive types
   - Store everything as `Napi::Value` like Node.js

2. **Simplify conversion methods**
   - `StoreJSValueAsRaw()` → `StoreValue()`
   - `RawValueToJS()` → `GetValue()`
   - Remove complex type switching

#### Phase 4: Update Destructor

```cpp
CustomAggregate::~CustomAggregate() {
    // Simple cleanup like better-sqlite3
    if (start_type_ == OBJECT) {
        object_ref_.Reset();
    }
    if (start_type_ == FUNCTION) {
        start_fn_.Reset();
    }
    step_fn_.Reset();
    inverse_fn_.Reset();
    result_fn_.Reset();
    // No external storage to clean up!
}
```

#### Phase 5: Add Safety Checks

```cpp
// Add better-sqlite3 style safety check
auto agg = GetAggregate(ctx);
if (!agg || agg->value.IsEmpty()) {
    return; // Exit early if aggregate is being destroyed
}
```

### Files to Modify

1. **`src/aggregate_function.h`**
   - Simplify `AggregateData` struct
   - Remove external storage members
   - Remove storage helper method declarations

2. **`src/aggregate_function.cpp`**
   - Simplify constructor (no external storage initialization)
   - Simplify destructor (no external storage cleanup)
   - Rewrite `StoreJSValueAsRaw()` and `RawValueToJS()`
   - Remove storage helper method implementations
   - Add safety checks in callback methods

### Benefits of This Approach

1. **Eliminates race conditions** by removing complex external storage
2. **Matches proven patterns** from Node.js and better-sqlite3
3. **Simpler code** that's easier to maintain and debug
4. **Better performance** due to reduced complexity and locking
5. **Proven reliability** - both reference implementations work correctly

### Risks and Considerations

1. **Breaking change**: External storage was handling complex object types
2. **Memory usage**: May store more data in SQLite contexts
3. **Testing required**: Need to verify all aggregate functionality still works

### Testing Plan

1. **Test basic aggregates** (numbers, strings, simple objects)
2. **Test window functions** (with `inverse`)
3. **Test aggregate replacement** (the original failing case)
4. **Test complex data types** (arrays, nested objects)
5. **Memory testing** to ensure no new leaks
6. **Performance testing** to verify no regression

## Implementation Steps

### Step 1: Backup and Analysis

- [ ] Create git branch for this work
- [ ] Document current test failures for comparison
- [ ] Run baseline memory tests

### Step 2: Header Changes

- [ ] Modify `AggregateData` struct in `aggregate_function.h`
- [ ] Remove external storage member variables
- [ ] Update method signatures

### Step 3: Implementation Changes

- [ ] Rewrite constructor to use simple storage
- [ ] Rewrite destructor to be minimal
- [ ] Rewrite value storage/retrieval methods
- [ ] Add safety checks in callback methods

### Step 4: Testing and Validation

- [ ] Test basic functionality
- [ ] Test the original failing case
- [ ] Run full test suite
- [ ] Memory testing with valgrind

### Step 5: Documentation and Cleanup

- [ ] Update internal documentation
- [ ] Remove unused code
- [ ] Add comments explaining the simplified approach

## Tribal Knowledge Acquired

### SQLite Aggregate Replacement Behavior

- SQLite calls `xDestroy` on old aggregate when registering replacement
- Active aggregate contexts may still reference the old object
- Race condition window exists between destruction and context cleanup

### better-sqlite3 Safety Pattern

- Use `if (acc->value.IsEmpty()) return` to exit early if aggregate destroyed
- Store data directly in SQLite context as `Global<Value>`
- Minimal destructors that only clean up V8 references

### Node.js Simplicity Pattern

- Simple `Global<Value>` storage in SQLite context
- No external storage maps or complex cleanup
- Trust V8's garbage collection for memory management

### Performance Considerations

- Complex external storage with mutexes creates contention
- Direct storage in SQLite context is more efficient
- Fewer memory allocations and deallocations

This analysis and plan provides a clear path forward to resolve the double free issue by adopting the proven architectural patterns from Node.js and better-sqlite3.
