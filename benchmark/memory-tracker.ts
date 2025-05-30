// Memory tracking utilities for benchmarks

interface MemorySample {
  label: string;
  timestamp: number;
  memory: NodeJS.MemoryUsage;
  delta?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
}

interface MemoryStats {
  sampleCount: number;
  metrics: {
    [key: string]: {
      baseline: number;
      final: number;
      min: number;
      max: number;
      mean: number;
      deltaMin: number;
      deltaMax: number;
      deltaMean: number;
    };
  };
}

interface LeakCheckSample {
  iteration: number;
  heapUsed: number;
  external: number;
  deltaHeap: number;
  deltaExternal: number;
}

interface TrendResult {
  slope: number;
  intercept: number;
  r2: number;
}

interface LeakCheckResult {
  samples: LeakCheckSample[];
  heapTrend: TrendResult;
  externalTrend: TrendResult;
  likelyLeak: boolean;
  summary: {
    heapGrowth: string;
    externalGrowth: string;
    heapR2: string;
    externalR2: string;
  };
}

export class MemoryTracker {
  private baseline: NodeJS.MemoryUsage | null = null;
  private samples: MemorySample[] = [];
  private gcAvailable: boolean;

  constructor() {
    this.gcAvailable = typeof global.gc === "function";
  }

  reset(): void {
    this.baseline = null;
    this.samples = [];
  }

  recordBaseline(): NodeJS.MemoryUsage {
    if (this.gcAvailable) {
      global.gc!();
    }
    this.baseline = process.memoryUsage();
    return this.baseline;
  }

  takeSample(label: string): MemorySample {
    if (this.gcAvailable) {
      global.gc!();
    }

    const current = process.memoryUsage();
    const sample: MemorySample = {
      label,
      timestamp: Date.now(),
      memory: current,
    };

    if (this.baseline) {
      sample.delta = {
        rss: current.rss - this.baseline.rss,
        heapTotal: current.heapTotal - this.baseline.heapTotal,
        heapUsed: current.heapUsed - this.baseline.heapUsed,
        external: current.external - this.baseline.external,
        arrayBuffers: current.arrayBuffers - this.baseline.arrayBuffers,
      };
    }

    this.samples.push(sample);
    return sample;
  }

  getStats(): MemoryStats | null {
    if (this.samples.length === 0) {
      return null;
    }

    const stats: MemoryStats = {
      sampleCount: this.samples.length,
      metrics: {},
    };

    // Calculate stats for each metric
    const metrics: (keyof NodeJS.MemoryUsage)[] = [
      "rss",
      "heapTotal",
      "heapUsed",
      "external",
      "arrayBuffers",
    ];

    for (const metric of metrics) {
      const values = this.samples.map((s) => s.memory[metric]);
      const deltas = this.samples.map((s) => s.delta?.[metric] ?? 0);

      stats.metrics[metric] = {
        baseline: this.baseline?.[metric] ?? 0,
        final: values[values.length - 1],
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        deltaMin: Math.min(...deltas),
        deltaMax: Math.max(...deltas),
        deltaMean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      };
    }

    return stats;
  }

  // Check for memory leaks by running a function multiple times
  async checkForLeaks(
    fn: () => Promise<void> | void,
    iterations = 10,
    warmup = 5,
  ): Promise<LeakCheckResult> {
    const samples: LeakCheckSample[] = [];

    // Warmup runs
    for (let i = 0; i < warmup; i++) {
      await fn();
      if (this.gcAvailable) {
        global.gc!();
      }
    }

    // Record baseline after warmup
    const baseline = process.memoryUsage();

    // Test runs
    for (let i = 0; i < iterations; i++) {
      await fn();

      if (this.gcAvailable) {
        global.gc!();
      }

      const memory = process.memoryUsage();
      samples.push({
        iteration: i,
        heapUsed: memory.heapUsed,
        external: memory.external,
        deltaHeap: memory.heapUsed - baseline.heapUsed,
        deltaExternal: memory.external - baseline.external,
      });
    }

    // Analyze trend using linear regression
    const heapTrend = this.calculateTrend(samples.map((s) => s.deltaHeap));
    const externalTrend = this.calculateTrend(
      samples.map((s) => s.deltaExternal),
    );

    return {
      samples,
      heapTrend,
      externalTrend,
      likelyLeak: heapTrend.slope > 1000 || externalTrend.slope > 1000, // 1KB per iteration threshold (logical OR is correct here)
      summary: {
        heapGrowth: `${(heapTrend.slope / 1024).toFixed(2)} KB/iteration`,
        externalGrowth: `${(externalTrend.slope / 1024).toFixed(2)} KB/iteration`,
        heapR2: heapTrend.r2.toFixed(3),
        externalR2: externalTrend.r2.toFixed(3),
      },
    };
  }

  // Simple linear regression to detect memory growth trend
  private calculateTrend(values: number[]): TrendResult {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = values.reduce((sum, yi) => sum + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = values.reduce(
      (sum, yi) => sum + Math.pow(yi - yMean, 2),
      0,
    );
    const ssResidual = values.reduce((sum, yi, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const r2 = 1 - ssResidual / ssTotal;

    return { slope, intercept, r2 };
  }

  formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let value = Math.abs(bytes);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    const formatted = value.toFixed(2) + " " + units[unitIndex];
    return bytes < 0 ? `-${formatted}` : formatted;
  }

  generateReport(): string {
    const stats = this.getStats();
    if (!stats) {
      return "No memory samples collected";
    }

    const report: string[] = [];
    report.push("Memory Usage Report");
    report.push("==================\n");

    for (const [metric, data] of Object.entries(stats.metrics)) {
      report.push(`${metric}:`);
      report.push(`  Baseline: ${this.formatBytes(data.baseline)}`);
      report.push(`  Final:    ${this.formatBytes(data.final)}`);
      report.push(
        `  Delta:    ${this.formatBytes(data.final - data.baseline)}`,
      );
      report.push(
        `  Range:    ${this.formatBytes(data.min)} - ${this.formatBytes(data.max)}`,
      );
      report.push("");
    }

    return report.join("\n");
  }
}

// Export singleton instance for convenience
export const memoryTracker = new MemoryTracker();
