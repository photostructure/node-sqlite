/**
 * Options for the pragma() method.
 *
 * @see https://sqlite.org/pragma.html
 */
export interface PragmaOptions {
  /**
   * When true, returns only the first column of the first row.
   * This is useful for pragmas that return a single value.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Without simple: returns [{ cache_size: -16000 }]
   * db.pragma('cache_size');
   *
   * // With simple: returns -16000
   * db.pragma('cache_size', { simple: true });
   * ```
   */
  readonly simple?: boolean;
}
