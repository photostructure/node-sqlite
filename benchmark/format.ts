// Shared number-formatting helpers for benchmark output. Kept in their own
// module so both consumers (index.ts's summary table and svg-chart.ts's charts)
// depend on a neutral utility rather than importing from each other.

/**
 * Round a number to `digits` significant figures.
 *
 * @param value   The number to round.
 * @param digits  How many significant figures to keep (must be ≥ 1).
 * @returns       The rounded number, or 0 for non-finite inputs, zero, or
 *                `digits` < 1.
 */
export function sigFigs(value: number, digits = 2): number {
  if (!isFinite(value) || value === 0 || digits < 1) return 0;
  // toPrecision gives a string with the correct sig-figs; parseFloat turns it
  // back into a number.
  return parseFloat(value.toPrecision(digits));
}
