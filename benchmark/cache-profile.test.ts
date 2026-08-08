import { TempDir } from "../test/test-utils";
import { DEFAULT_CACHE_PROFILE, parseCacheProfile } from "./cache-profile";
import { createDriver, getAvailableDrivers } from "./drivers";
import { buildBenchmarkCharts } from "./svg-chart";

describe("benchmark cache profiles", () => {
  const tempDir = TempDir.perTest("sqlite-benchmark-cache-");

  test("defaults to controlled and rejects unknown profile names", () => {
    expect(parseCacheProfile(undefined)).toBe(DEFAULT_CACHE_PROFILE);
    expect(parseCacheProfile("controlled")).toBe("controlled");
    expect(parseCacheProfile("packaged")).toBe("packaged");
    expect(() => parseCacheProfile("default")).toThrow(/controlled\|packaged/);
  });

  test("shared driver creation preserves packaged cache defaults", async () => {
    for (const [index, driverName] of getAvailableDrivers().entries()) {
      const driver = await createDriver(
        driverName,
        tempDir.getDbPath(`implicit-packaged-${index}.db`),
      );
      try {
        expect(driver.benchmarkSettings.cacheProfile).toBe("packaged");
        expect(driver.benchmarkSettings.effectiveCacheSize).toBe(
          driver.benchmarkSettings.initialCacheSize,
        );
      } finally {
        await driver.close();
      }
    }
  });

  test("controlled mode pins every available driver to -16000", async () => {
    for (const [index, driverName] of getAvailableDrivers().entries()) {
      const driver = await createDriver(
        driverName,
        tempDir.getDbPath(`controlled-${index}.db`),
        { cacheProfile: "controlled" },
      );
      try {
        expect(driver.benchmarkSettings).toEqual(
          expect.objectContaining({
            cacheProfile: "controlled",
            effectiveCacheSize: -16000,
            journalMode: "delete",
            synchronous: 2,
          }),
        );
      } finally {
        await driver.close();
      }
    }
  });

  test("packaged mode preserves each driver's cache default", async () => {
    const settings = new Map<
      string,
      { initialCacheSize: number; effectiveCacheSize: number }
    >();

    for (const [index, driverName] of getAvailableDrivers().entries()) {
      const driver = await createDriver(
        driverName,
        tempDir.getDbPath(`packaged-${index}.db`),
        { cacheProfile: "packaged" },
      );
      try {
        const { initialCacheSize, effectiveCacheSize } =
          driver.benchmarkSettings;
        expect(effectiveCacheSize).toBe(initialCacheSize);
        settings.set(driverName, { initialCacheSize, effectiveCacheSize });
      } finally {
        await driver.close();
      }
    }

    expect(settings.get("@photostructure/sqlite")?.effectiveCacheSize).toBe(
      -2000,
    );
    if (settings.has("node:sqlite")) {
      expect(settings.get("node:sqlite")?.effectiveCacheSize).toBe(-2000);
    }
    if (settings.has("better-sqlite3")) {
      expect(settings.get("better-sqlite3")?.effectiveCacheSize).toBe(-16000);
    }
  });

  test("embeds the active profile and effective settings in SVG charts", () => {
    const charts = buildBenchmarkCharts(
      {
        "select-range": {
          "@photostructure/sqlite": { hz: 400 },
          "node:sqlite": { hz: 500 },
        },
      },
      [
        [
          "select-range",
          { name: "SELECT Range", description: "Fetch rows", category: "cpu" },
        ],
      ],
      ["@photostructure/sqlite", "node:sqlite"],
      {
        cacheProfile: "controlled",
        driverSettings: {
          "@photostructure/sqlite": {
            cacheProfile: "controlled",
            initialCacheSize: -2000,
            effectiveCacheSize: -16000,
            journalMode: "delete",
            synchronous: 2,
          },
        },
      },
    );

    const overview = charts.get("overview-ratio.svg");
    expect(overview).toContain("cache profile: controlled");
    expect(overview).toContain("benchmark-configuration");
    expect(overview).toContain("&quot;effectiveCacheSize&quot;:-16000");
  });
});
