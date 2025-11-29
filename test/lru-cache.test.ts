/**
 * Comprehensive tests for LRUCache implementation
 */
import { LRUCache } from "../src/lru-cache";

describe("LRUCache", () => {
  describe("constructor", () => {
    test("creates cache with specified capacity", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.capacity()).toBe(5);
      expect(cache.size()).toBe(0);
    });

    test("throws RangeError for capacity of 0", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow(RangeError);
      expect(() => new LRUCache<string, number>(0)).toThrow(
        "LRU cache capacity must be at least 1",
      );
    });

    test("throws RangeError for negative capacity", () => {
      expect(() => new LRUCache<string, number>(-1)).toThrow(RangeError);
      expect(() => new LRUCache<string, number>(-100)).toThrow(RangeError);
    });

    test("accepts capacity of 1", () => {
      const cache = new LRUCache<string, number>(1);
      expect(cache.capacity()).toBe(1);
    });

    test("accepts large capacity", () => {
      const cache = new LRUCache<string, number>(10000);
      expect(cache.capacity()).toBe(10000);
    });
  });

  describe("set and get", () => {
    test("stores and retrieves a single value", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    test("stores and retrieves multiple values", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    test("returns undefined for non-existent key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    test("handles various value types", () => {
      const objCache = new LRUCache<string, object>(3);
      const obj = { foo: "bar" };
      objCache.set("obj", obj);
      expect(objCache.get("obj")).toBe(obj);

      const nullCache = new LRUCache<string, null>(3);
      nullCache.set("null", null);
      expect(nullCache.get("null")).toBeNull();

      const arrCache = new LRUCache<string, number[]>(3);
      const arr = [1, 2, 3];
      arrCache.set("arr", arr);
      expect(arrCache.get("arr")).toBe(arr);
    });

    test("handles various key types", () => {
      const numCache = new LRUCache<number, string>(3);
      numCache.set(1, "one");
      numCache.set(2, "two");
      expect(numCache.get(1)).toBe("one");
      expect(numCache.get(2)).toBe("two");

      // Object keys (uses reference equality)
      const objCache = new LRUCache<object, string>(3);
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      objCache.set(key1, "first");
      objCache.set(key2, "second");
      expect(objCache.get(key1)).toBe("first");
      expect(objCache.get(key2)).toBe("second");
      // Different object with same structure is a different key
      expect(objCache.get({ id: 1 })).toBeUndefined();
    });

    test("updates existing key value", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);

      cache.set("a", 100);
      expect(cache.get("a")).toBe(100);
      expect(cache.size()).toBe(1);
    });

    test("updating existing key does not increase size", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size()).toBe(2);

      cache.set("a", 10);
      cache.set("b", 20);
      expect(cache.size()).toBe(2);
    });
  });

  describe("LRU eviction", () => {
    test("evicts oldest entry when at capacity", () => {
      const cache = new LRUCache<string, number>(2);

      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size()).toBe(2);

      cache.set("c", 3); // Should evict "a"
      expect(cache.size()).toBe(2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    test("get() updates recency", () => {
      const cache = new LRUCache<string, number>(2);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // Makes "a" most recent

      cache.set("c", 3); // Should evict "b", not "a"
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });

    test("set() on existing key updates recency", () => {
      const cache = new LRUCache<string, number>(2);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10); // Updates "a" value and makes it most recent

      cache.set("c", 3); // Should evict "b", not "a"
      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });

    test("eviction order with multiple operations", () => {
      const cache = new LRUCache<string, number>(3);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.get("a"); // Order now: b, c, a
      cache.set("d", 4); // Evicts b
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("c")).toBe(true);
      expect(cache.has("d")).toBe(true);

      cache.get("c"); // Order now: a, d, c
      cache.set("e", 5); // Evicts a
      expect(cache.has("a")).toBe(false);
      expect(cache.has("c")).toBe(true);
      expect(cache.has("d")).toBe(true);
      expect(cache.has("e")).toBe(true);
    });

    test("capacity of 1 always evicts previous entry", () => {
      const cache = new LRUCache<string, number>(1);

      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);

      cache.set("b", 2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);

      cache.set("c", 3);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
    });

    test("never exceeds capacity", () => {
      const cache = new LRUCache<string, number>(3);

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, i);
        expect(cache.size()).toBeLessThanOrEqual(3);
      }

      expect(cache.size()).toBe(3);
      // Only the last 3 should remain
      expect(cache.has("key97")).toBe(true);
      expect(cache.has("key98")).toBe(true);
      expect(cache.has("key99")).toBe(true);
      expect(cache.has("key96")).toBe(false);
    });
  });

  describe("has()", () => {
    test("returns true for existing key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
    });

    test("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      expect(cache.has("b")).toBe(false);
    });

    test("does NOT update recency", () => {
      const cache = new LRUCache<string, number>(2);

      cache.set("a", 1);
      cache.set("b", 2);

      // has() should not update recency
      cache.has("a");
      cache.has("a");
      cache.has("a");

      // "a" should still be evicted first since has() doesn't update recency
      cache.set("c", 3);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    test("returns false after eviction", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.has("a")).toBe(true);
      cache.set("c", 3); // Evicts "a"
      expect(cache.has("a")).toBe(false);
    });
  });

  describe("delete()", () => {
    test("removes existing entry and returns true", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.has("a")).toBe(false);
      expect(cache.size()).toBe(1);
    });

    test("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);

      expect(cache.delete("nonexistent")).toBe(false);
      expect(cache.size()).toBe(1);
    });

    test("allows adding new entries after deletion", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);

      cache.delete("a");
      cache.set("c", 3); // Should not evict "b"

      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
      expect(cache.size()).toBe(2);
    });

    test("deleted key can be re-added", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.delete("a");

      cache.set("a", 100);
      expect(cache.get("a")).toBe(100);
    });
  });

  describe("clear()", () => {
    test("removes all entries", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBeUndefined();
    });

    test("preserves capacity after clear", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      cache.clear();

      expect(cache.capacity()).toBe(5);
    });

    test("cache is usable after clear", () => {
      const cache = new LRUCache<string, number>(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();

      cache.set("c", 3);
      cache.set("d", 4);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size()).toBe(2);
    });

    test("clear on empty cache is safe", () => {
      const cache = new LRUCache<string, number>(3);
      expect(() => cache.clear()).not.toThrow();
      expect(cache.size()).toBe(0);
    });
  });

  describe("size()", () => {
    test("returns 0 for empty cache", () => {
      const cache = new LRUCache<string, number>(3);
      expect(cache.size()).toBe(0);
    });

    test("increases when adding entries", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.size()).toBe(0);

      cache.set("a", 1);
      expect(cache.size()).toBe(1);

      cache.set("b", 2);
      expect(cache.size()).toBe(2);

      cache.set("c", 3);
      expect(cache.size()).toBe(3);
    });

    test("stays constant when updating entries", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size()).toBe(2);

      cache.set("a", 100);
      expect(cache.size()).toBe(2);
    });

    test("decreases when deleting entries", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size()).toBe(2);

      cache.delete("a");
      expect(cache.size()).toBe(1);
    });

    test("capped at capacity", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4);
      cache.set("e", 5);

      expect(cache.size()).toBe(3);
    });
  });

  describe("capacity()", () => {
    test("returns the configured capacity", () => {
      expect(new LRUCache<string, number>(1).capacity()).toBe(1);
      expect(new LRUCache<string, number>(10).capacity()).toBe(10);
      expect(new LRUCache<string, number>(1000).capacity()).toBe(1000);
    });

    test("capacity remains constant regardless of operations", () => {
      const cache = new LRUCache<string, number>(5);

      cache.set("a", 1);
      expect(cache.capacity()).toBe(5);

      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.capacity()).toBe(5);

      cache.delete("a");
      expect(cache.capacity()).toBe(5);

      cache.clear();
      expect(cache.capacity()).toBe(5);
    });
  });

  describe("edge cases", () => {
    test("handles empty string key", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("", 42);
      expect(cache.get("")).toBe(42);
      expect(cache.has("")).toBe(true);
    });

    test("handles undefined value (returns undefined, same as not found)", () => {
      const cache = new LRUCache<string, undefined>(3);
      cache.set("a", undefined);
      // Note: get() returns undefined both for stored undefined and not found
      expect(cache.get("a")).toBeUndefined();
      // Use has() to distinguish
      expect(cache.has("a")).toBe(true);
    });

    test("handles NaN key (uses Object.is semantics)", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(NaN, "not a number");
      // Map treats NaN === NaN for key equality
      expect(cache.get(NaN)).toBe("not a number");
      expect(cache.has(NaN)).toBe(true);
    });

    test("handles -0 and +0 keys (Map treats as same key)", () => {
      const cache = new LRUCache<number, string>(3);
      cache.set(0, "zero");
      cache.set(-0, "negative zero"); // Overwrites +0
      expect(cache.get(0)).toBe("negative zero");
      expect(cache.get(-0)).toBe("negative zero");
      expect(cache.size()).toBe(1);
    });

    test("stress test with many operations", () => {
      const cache = new LRUCache<number, number>(100);

      // Add many entries
      for (let i = 0; i < 1000; i++) {
        cache.set(i, i * 2);
      }

      expect(cache.size()).toBe(100);

      // Verify only last 100 exist
      for (let i = 0; i < 900; i++) {
        expect(cache.has(i)).toBe(false);
      }
      for (let i = 900; i < 1000; i++) {
        expect(cache.has(i)).toBe(true);
        expect(cache.get(i)).toBe(i * 2);
      }
    });

    test("interleaved operations maintain correctness", () => {
      const cache = new LRUCache<string, number>(3);

      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBe(1);
      cache.set("c", 3);
      cache.delete("b");
      cache.set("d", 4);
      expect(cache.get("c")).toBe(3);
      cache.set("e", 5);

      // Should have: c, d, e (a was evicted, b was deleted)
      expect(cache.size()).toBe(3);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("c")).toBe(true);
      expect(cache.has("d")).toBe(true);
      expect(cache.has("e")).toBe(true);
    });
  });
});
