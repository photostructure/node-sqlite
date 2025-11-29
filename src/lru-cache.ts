/**
 * Simple LRU (Least Recently Used) cache implementation.
 * Uses Map's insertion order to track recency - first key is oldest.
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxCapacity: number;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new RangeError("LRU cache capacity must be at least 1");
    }
    this.maxCapacity = capacity;
  }

  /**
   * Get a value from the cache.
   * If found, moves the entry to the end (most recently used).
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used) by reinserting
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Set a value in the cache.
   * If key exists, updates and moves to end.
   * If at capacity, evicts the oldest entry first.
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing - delete and reinsert at end
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      // Evict oldest (first key in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Delete an entry from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if a key exists in the cache.
   * Does NOT update recency.
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum capacity of the cache.
   */
  capacity(): number {
    return this.maxCapacity;
  }
}
