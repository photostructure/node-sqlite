// Self-contained SVG chart generation for the SQLite driver benchmark.
//
// Cribbed from ../node-vector-bench/src/reporters/svg.ts (MIT, PhotoStructure
// Inc.) and adapted: horizontal bar charts, no external deps, one file per
// chart so they embed straight into Markdown/GitHub. Two chart kinds:
//   - overview-ratio.svg : one bar per scenario = subject ÷ node:sqlite, with a
//     parity reference line at 1.0× (the headline "how do we compare" view).
//   - ops-<scenario>.svg : one bar per driver, self-scaled ops/sec (absolute
//     numbers per scenario, since scenarios span ~500 to ~110k ops/s).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sigFigs } from "./format.js";

// Distinct, white-background-legible colors per driver.
export const DRIVER_COLORS: Record<string, string> = {
  "@photostructure/sqlite": "#1B6B8A", // dark cyan (SQLite logo family)
  "better-sqlite3": "#B8860B", // dark goldenrod
  "node:sqlite": "#43853D", // Node green
};

// Colors per scenario category, used to tint the overview ratio bars.
const CATEGORY_COLORS: Record<string, string> = {
  cpu: "#1B6B8A", // read / query
  fsync: "#6B7280", // single-op write (durable-commit-bound, ties)
  batch: "#C2681E", // batched write (amortized commit, driver-dependent)
};

const CATEGORY_LEGEND: Array<{ key: string; label: string }> = [
  { key: "cpu", label: "read" },
  { key: "fsync", label: "single-op write (†)" },
  { key: "batch", label: "batched write (‡)" },
];

const FALLBACK_COLORS = ["#CC79A7", "#56B4E9", "#D55E00", "#F0E442"];
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;

function driverColor(name: string, index: number): string {
  return DRIVER_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compact human number for axis ticks: 110000 -> "110,000", 0.5 -> "0.5". */
function formatTick(n: number): string {
  const s = sigFigs(n, 3);
  if (Math.abs(s) >= 1000)
    return s.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return String(s);
}

/** Pick "nice" round tick values spanning [0, maxValue]. */
function niceTicks(maxValue: number, targetTicks = 5): number[] {
  if (maxValue <= 0) return [0];
  const roughStep = maxValue / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  const step =
    residual <= 1.5
      ? mag
      : residual <= 3
        ? 2 * mag
        : residual <= 7
          ? 5 * mag
          : 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

interface BarDatum {
  label: string;
  value: number;
  color: string;
  valueLabel: string;
}

interface RefLine {
  value: number;
  label: string;
}

/** Render one horizontal bar chart as a standalone SVG string. */
function renderBarChart(opts: {
  title: string;
  subtitle: string;
  bars: BarDatum[];
  fixedMax?: number;
  refLine?: RefLine;
  legend?: Array<{ label: string; color: string }>;
}): string {
  const { title, subtitle, bars, fixedMax, refLine, legend } = opts;

  const width = 680;
  // Leave separate text rows for the subtitle and optional reference-line
  // label; the prior 48px margin placed their baselines only 4px apart.
  const marginTop = 64;
  const marginRight = 104;
  const marginLeft = 168;
  const barHeight = 26;
  const barGap = 12;
  const legendHeight = legend && legend.length ? 22 : 0;
  const marginBottom = 30 + legendHeight;

  const contentHeight = bars.length * (barHeight + barGap) - barGap;
  const height = marginTop + contentHeight + marginBottom;
  const plotWidth = width - marginLeft - marginRight;

  const dataMax = Math.max(...bars.map((b) => b.value), refLine?.value ?? 0, 1);
  const maxValue = fixedMax ?? dataMax;
  const ticks = niceTicks(maxValue);
  const scaleMax = Math.max(ticks[ticks.length - 1], maxValue);
  const scaleX = (v: number) =>
    scaleMax === 0 ? 0 : (v / scaleMax) * plotWidth;
  const px = (v: number) => +(marginLeft + scaleX(v)).toFixed(2);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="${FONT}">`,
  );
  out.push(`  <title>${escXml(title)}</title>`);
  out.push(`  <rect width="${width}" height="${height}" fill="#fff" rx="6" />`);
  out.push(
    `  <text x="${width / 2}" y="20" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${escXml(title)}</text>`,
  );
  out.push(
    `  <text x="${width / 2}" y="36" text-anchor="middle" font-size="11" fill="#888">${escXml(subtitle)}</text>`,
  );

  // Grid lines
  for (const tick of ticks) {
    const x = px(tick);
    out.push(
      `  <line x1="${x}" y1="${marginTop - 4}" x2="${x}" y2="${marginTop + contentHeight + 4}" stroke="#ececec" stroke-width="1" />`,
    );
  }

  // Bars
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const y = marginTop + i * (barHeight + barGap);
    const barWidth = +Math.max(scaleX(bar.value), 2).toFixed(2);
    out.push(
      `  <text x="${marginLeft - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="12" fill="#444">${escXml(bar.label)}</text>`,
    );
    out.push(
      `  <rect x="${marginLeft}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${bar.color}" rx="3" opacity="0.9" />`,
    );
    const valueLabelX = +(marginLeft + barWidth + 6).toFixed(2);
    out.push(
      `  <text x="${valueLabelX}" y="${y + barHeight / 2 + 4}" font-size="11" fill="#555">${escXml(bar.valueLabel)}</text>`,
    );
  }

  // Reference line (e.g. parity at 1.0x)
  if (refLine) {
    const x = px(refLine.value);
    out.push(
      `  <line x1="${x}" y1="${marginTop - 4}" x2="${x}" y2="${marginTop + contentHeight + 4}" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="4 3" />`,
    );
    out.push(
      `  <text x="${x}" y="${marginTop - 8}" text-anchor="middle" font-size="10" fill="#c0392b">${escXml(refLine.label)}</text>`,
    );
  }

  // X-axis tick labels
  for (const tick of ticks) {
    out.push(
      `  <text x="${px(tick)}" y="${marginTop + contentHeight + 18}" text-anchor="middle" font-size="10" fill="#999">${escXml(formatTick(tick))}</text>`,
    );
  }

  // Legend
  if (legend && legend.length) {
    const legendY = marginTop + contentHeight + 30;
    let lx = marginLeft;
    for (const item of legend) {
      out.push(
        `  <rect x="${lx}" y="${legendY - 9}" width="11" height="11" fill="${item.color}" rx="2" />`,
      );
      out.push(
        `  <text x="${lx + 16}" y="${legendY}" font-size="10" fill="#666">${escXml(item.label)}</text>`,
      );
      lx += 16 + item.label.length * 6 + 20;
    }
  }

  out.push("</svg>");
  return out.join("\n");
}

// Minimal shapes the builder needs from the benchmark's data.
interface ScenarioMeta {
  name: string;
  description: string;
  category: string;
}
type Results = Record<string, Record<string, { hz: number; rme?: number }>>;

/**
 * Build all benchmark charts, keyed by output filename.
 *
 * @param results   scenarioKey -> driver -> { hz, rme }
 * @param scenarios [scenarioKey, meta][] in display order
 * @param drivers   driver names present in the run, in display order
 */
export function buildBenchmarkCharts(
  results: Results,
  scenarios: Array<[string, ScenarioMeta]>,
  drivers: string[],
): Map<string, string> {
  const charts = new Map<string, string>();
  const opsLabel = (hz: number) =>
    `${sigFigs(hz).toLocaleString("en-US")} ops/s`;

  // Overview: subject ÷ node:sqlite per scenario, with a parity line at 1.0x.
  const BASELINE = "node:sqlite";
  const PACKAGE_DRIVER = "@photostructure/sqlite";
  const subject = drivers.includes(PACKAGE_DRIVER)
    ? PACKAGE_DRIVER
    : drivers.find((d) => d !== BASELINE);
  if (subject && drivers.includes(BASELINE)) {
    const bars: BarDatum[] = [];
    for (const [key, meta] of scenarios) {
      const s = results[key]?.[subject];
      const b = results[key]?.[BASELINE];
      if (!s || !b || !(b.hz > 0)) continue;
      const ratio = s.hz / b.hz;
      const marker =
        meta.category === "fsync"
          ? " †"
          : meta.category === "batch"
            ? " ‡"
            : "";
      bars.push({
        label: `${meta.name}${marker}`,
        value: ratio,
        color: CATEGORY_COLORS[meta.category] ?? "#1B6B8A",
        valueLabel: `${ratio.toFixed(2)}×`,
      });
    }
    if (bars.length) {
      const maxRatio = Math.max(...bars.map((b) => b.value), 1);
      charts.set(
        "overview-ratio.svg",
        renderBarChart({
          title: `${subject} throughput vs node:sqlite`,
          subtitle: "ratio of ops/sec (1.0× = parity; higher is faster)",
          bars,
          fixedMax: maxRatio <= 1.05 ? 1.2 : maxRatio * 1.1,
          refLine: { value: 1, label: "node:sqlite = 1.0×" },
          legend: CATEGORY_LEGEND.map((c) => ({
            label: c.label,
            color: CATEGORY_COLORS[c.key],
          })),
        }),
      );
    }
  }

  // Per-scenario absolute throughput (self-scaled — scenarios span decades).
  for (const [key, meta] of scenarios) {
    const bars: BarDatum[] = [];
    drivers.forEach((driver, i) => {
      const r = results[key]?.[driver];
      if (!r || !(r.hz > 0)) return;
      bars.push({
        label: driver,
        value: r.hz,
        color: driverColor(driver, i),
        valueLabel: opsLabel(r.hz),
      });
    });
    if (!bars.length) continue;
    charts.set(
      `ops-${key}.svg`,
      renderBarChart({
        title: meta.name,
        subtitle: `${meta.description} · higher is better`,
        bars,
      }),
    );
  }

  return charts;
}

/** Write a filename -> svg map to disk, creating the directory. */
export function writeCharts(charts: Map<string, string>, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const [filename, svg] of charts) {
    writeFileSync(join(outDir, filename), svg);
  }
}
