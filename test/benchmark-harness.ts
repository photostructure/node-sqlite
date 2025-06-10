import { getTimingMultiplier } from "./test-timeout-config.cjs";

export interface BenchmarkOptions {
  /**
   * Target duration for the benchmark in milliseconds (default: 20000ms / 20 seconds)
   */
  targetDurationMs?: number;

  /**
   * Maximum timeout for the entire benchmark in milliseconds (default: 60000ms / 1 minute)
   */
  maxTimeoutMs?: number;

  /**
   * Minimum iterations to run regardless of timing (default: 5)
   */
  minIterations?: number;

  /**
   * Maximum iterations to run regardless of timing (default: 10000)
   */
  maxIterations?: number;

  /**
   * Number of warmup iterations before timing (default: 3)
   */
  warmupIterations?: number;

  /**
   * Whether to log debug information (default: false)
   */
  debug?: boolean;
}

export interface BenchmarkResult {
  /**
   * Number of iterations actually performed
   */
  iterations: number;

  /**
   * Total duration in milliseconds
   */
  totalDurationMs: number;

  /**
   * Average duration per iteration in milliseconds
   */
  avgIterationMs: number;

  /**
   * Whether the benchmark hit the timeout
   */
  timedOut: boolean;
}

export interface MemoryBenchmarkOptions extends BenchmarkOptions {
  /**
   * Maximum allowed memory growth in KB per second (default: 500)
   */
  maxMemoryGrowthKBPerSecond?: number;

  /**
   * Minimum R-squared value to consider a leak significant (default: 0.5)
   */
  minRSquaredForLeak?: number;

  /**
   * Whether to force garbage collection between iterations (default: true)
   */
  forceGC?: boolean;

  /**
   * How often to force GC (every N iterations, default: 10)
   */
  gcFrequency?: number;
}

export interface MemoryBenchmarkResult extends BenchmarkResult {
  /**
   * Initial memory usage in bytes
   */
  initialMemoryBytes: number;

  /**
   * Final memory usage in bytes
   */
  finalMemoryBytes: number;

  /**
   * Memory growth rate in KB per second
   */
  memoryGrowthKBPerSecond: number;

  /**
   * Memory growth per iteration in KB
   */
  memoryGrowthKBPerIteration: number;

  /**
   * R-squared value for linear regression (0-1, higher means more linear)
   */
  rSquared: number;

  /**
   * Whether a memory leak was detected
   */
  hasMemoryLeak: boolean;

  /**
   * All memory measurements taken during the benchmark
   */
  measurements: number[];
}

/**
 * Runs a benchmark operation adaptively based on the performance of the test environment.
 *
 * This harness:
 * 1. Runs warmup iterations to estimate operation time
 * 2. Calculates how many iterations can fit within the target duration
 * 3. Runs the calculated number of iterations with a safety timeout
 *
 * @param operation - The async function to benchmark (should be a single iteration)
 * @param options - Configuration options for the benchmark
 * @returns Results of the benchmark run
 */
export async function runAdaptiveBenchmark(
  operation: () => void | Promise<void>,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const {
    targetDurationMs = 20_000,
    maxTimeoutMs = 60_000,
    minIterations = 5,
    maxIterations = 10_000,
    warmupIterations = 3,
    debug = false,
  } = options;

  // Apply timing multiplier based on environment
  const multiplier = getTimingMultiplier();
  const adjustedTargetMs = targetDurationMs * multiplier;
  const adjustedTimeoutMs = maxTimeoutMs * multiplier;

  if (debug) {
    console.log(`[Benchmark] Environment multiplier: ${multiplier}x`);
    console.log(`[Benchmark] Adjusted target: ${adjustedTargetMs}ms`);
    console.log(`[Benchmark] Adjusted timeout: ${adjustedTimeoutMs}ms`);
  }

  // Run warmup iterations
  if (debug)
    console.log(`[Benchmark] Running ${warmupIterations} warmup iterations...`);

  const warmupTimings: number[] = [];
  for (let i = 0; i < warmupIterations; i++) {
    const start = process.hrtime.bigint();
    await operation();
    const end = process.hrtime.bigint();
    warmupTimings.push(Number(end - start) / 1_000_000); // Convert to ms
  }

  const avgWarmupTime =
    warmupTimings.reduce((a, b) => a + b) / warmupTimings.length;

  if (debug) {
    console.log(
      `[Benchmark] Average warmup time: ${avgWarmupTime.toFixed(2)}ms per iteration`,
    );
  }

  // Calculate target iterations based on warmup timing
  // Add 10% safety margin to avoid overshooting
  const safetyMargin = 0.9;
  let targetIterations = Math.floor(
    (adjustedTargetMs * safetyMargin) / avgWarmupTime,
  );

  // Clamp to min/max bounds
  targetIterations = Math.max(
    minIterations,
    Math.min(maxIterations, targetIterations),
  );

  if (debug) {
    console.log(
      `[Benchmark] Calculated target iterations: ${targetIterations}`,
    );
  }

  // Run the actual benchmark
  const benchmarkStart = Date.now();
  let completedIterations = 0;
  let timedOut = false;

  for (let i = 0; i < targetIterations; i++) {
    // Check if we're approaching the timeout
    const elapsed = Date.now() - benchmarkStart;
    if (elapsed > adjustedTimeoutMs * 0.95) {
      if (debug)
        console.log(
          `[Benchmark] Approaching timeout, stopping at ${completedIterations} iterations`,
        );
      timedOut = true;
      break;
    }

    await operation();
    completedIterations++;
  }

  const totalDuration = Date.now() - benchmarkStart;
  const avgIterationTime = totalDuration / completedIterations;

  const result: BenchmarkResult = {
    iterations: completedIterations,
    totalDurationMs: totalDuration,
    avgIterationMs: avgIterationTime,
    timedOut,
  };

  if (debug) {
    console.log(
      `[Benchmark] Completed ${completedIterations} iterations in ${totalDuration}ms`,
    );
    console.log(
      `[Benchmark] Average time per iteration: ${avgIterationTime.toFixed(2)}ms`,
    );
    if (timedOut) console.log(`[Benchmark] Note: Benchmark timed out`);
  }

  return result;
}

/**
 * Gets the current heap memory usage, optionally forcing garbage collection first
 */
function getMemoryUsage(forceGC = true): number {
  const gc = global.gc;
  if (forceGC && gc) gc();
  return process.memoryUsage().heapUsed;
}

/**
 * Runs a memory benchmark that tracks heap usage over iterations
 *
 * @param operation - The function to benchmark for memory usage
 * @param options - Configuration options for the memory benchmark
 * @returns Results including memory growth analysis
 */
export async function runMemoryBenchmark(
  operation: () => void | Promise<void>,
  options: MemoryBenchmarkOptions = {},
): Promise<MemoryBenchmarkResult> {
  const {
    maxMemoryGrowthKBPerSecond = 500,
    minRSquaredForLeak = 0.5,
    forceGC = true,
    gcFrequency = 10,
    debug = false,
    ...benchmarkOptions
  } = options;

  const gc = global.gc;
  if (!gc && forceGC) {
    throw new Error(
      "Memory benchmarks require --expose-gc flag when forceGC is enabled",
    );
  }

  const measurements: number[] = [];

  // Wrapper to collect memory measurements
  let iteration = 0;
  const measurementOperation = async () => {
    getMemoryUsage(forceGC);
    await operation();
    const memory = getMemoryUsage(false); // Don't force GC after operation
    measurements.push(memory);

    // Periodic GC
    if (forceGC && gc && ++iteration % gcFrequency === 0) {
      gc();
    }
  };

  // Run the adaptive benchmark
  const result = await runAdaptiveBenchmark(
    measurementOperation,
    benchmarkOptions,
  );

  // Analyze memory growth
  const n = measurements.length;
  if (n < 2) {
    throw new Error(`Insufficient measurements (${n}) for memory analysis`);
  }

  // Calculate linear regression
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = measurements.reduce((a, b) => a + b, 0);
  const sumXY = measurements.reduce((sum, y, x) => sum + x * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const meanY = sumY / n;
  const ssTotal = measurements.reduce(
    (sum, y) => sum + Math.pow(y - meanY, 2),
    0,
  );
  const ssResidual = measurements.reduce((sum, y, x) => {
    const predicted = intercept + slope * x;
    return sum + Math.pow(y - predicted, 2);
  }, 0);
  const rSquared = 1 - ssResidual / ssTotal;

  // Convert to meaningful units
  const slopeKBPerIteration = slope / 1024;
  const memoryGrowthKBPerSecond =
    (slopeKBPerIteration * result.iterations * 1000) / result.totalDurationMs;

  // Determine if there's a leak
  const hasMemoryLeak =
    memoryGrowthKBPerSecond > maxMemoryGrowthKBPerSecond &&
    rSquared > minRSquaredForLeak &&
    memoryGrowthKBPerSecond > 10; // Ignore tiny variations

  const memoryResult: MemoryBenchmarkResult = {
    ...result,
    initialMemoryBytes: measurements[0],
    finalMemoryBytes: measurements[n - 1],
    memoryGrowthKBPerSecond,
    memoryGrowthKBPerIteration: slopeKBPerIteration,
    rSquared,
    hasMemoryLeak,
    measurements,
  };

  if (debug) {
    console.log(
      `[Memory] Initial: ${(measurements[0] / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `[Memory] Final: ${(measurements[n - 1] / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `[Memory] Growth rate: ${memoryGrowthKBPerSecond.toFixed(2)} KB/s`,
    );
    console.log(`[Memory] R-squared: ${rSquared.toFixed(4)}`);
    if (hasMemoryLeak) console.log(`[Memory] ⚠️ Memory leak detected!`);
  }

  return memoryResult;
}

/**
 * Jest test wrapper for memory benchmarks
 */
export function testMemoryBenchmark(
  testName: string,
  operation: () => void | Promise<void>,
  options: MemoryBenchmarkOptions = {},
) {
  const { maxTimeoutMs = 60_000, ...benchmarkOptions } = options;
  const multiplier = getTimingMultiplier();
  const jestTimeout = maxTimeoutMs * multiplier;

  test(
    testName,
    async () => {
      let result: MemoryBenchmarkResult | null = null;
      
      try {
        // Add debug output to track test progress in ESM mode
        if (process.env.DEBUG_ESM_TESTS) {
          console.log(`[ESM Debug] Starting test: ${testName}`);
        }

        result = await runMemoryBenchmark(operation, options);

        if (process.env.DEBUG_ESM_TESTS) {
          console.log(`[ESM Debug] Completed test: ${testName}`);
        }

        // Log results - only if we successfully got results
        if (result) {
          console.log(`${testName}:`);
          console.log(`  Iterations: ${result.iterations}`);
          console.log(`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
          console.log(
            `  Growth rate: ${result.memoryGrowthKBPerSecond.toFixed(2)} KB/second`,
          );
          console.log(`  R-squared: ${result.rSquared.toFixed(4)}`);
          console.log(
            `  Initial memory: ${(result.initialMemoryBytes / 1024 / 1024).toFixed(2)} MB`,
          );
          console.log(
            `  Final memory: ${(result.finalMemoryBytes / 1024 / 1024).toFixed(2)} MB`,
          );
        }

        if (result?.hasMemoryLeak) {
          throw new Error(
            `Memory leak detected: ${result.memoryGrowthKBPerSecond.toFixed(2)} KB/second ` +
              `(max allowed: ${benchmarkOptions.maxMemoryGrowthKBPerSecond ?? 500} KB/second, ` +
              `R²: ${result.rSquared.toFixed(4)})`,
          );
        }
      } catch (error) {
        // Re-throw but ensure no async operations continue
        throw error;
      }
    },
    jestTimeout,
  );
}
