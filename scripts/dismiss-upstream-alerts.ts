#!/usr/bin/env tsx

/**
 * Dismiss all code scanning alerts from upstream SQLite code
 */

import { execFileSync } from "node:child_process";

async function main() {
  console.log("Fetching alerts...");

  // Get alert count first
  const alertsJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts"],
    { encoding: "utf8" },
  );
  const alerts = JSON.parse(alertsJson);
  const totalCount = alerts.length;

  console.log(`Total alerts: ${totalCount}`);

  // Process in pages
  const perPage = 100;
  const pages = Math.ceil(totalCount / perPage);
  const upstreamAlerts: any[] = [];

  for (let page = 1; page <= pages; page++) {
    console.log(`Fetching page ${page}/${pages}...`);
    const pageAlertsJson = execFileSync(
      "gh",
      [
        "api",
        `repos/photostructure/node-sqlite/code-scanning/alerts?per_page=${perPage}&page=${page}`,
      ],
      { encoding: "utf8" },
    );
    const pageAlerts = JSON.parse(pageAlertsJson);

    // Filter upstream alerts
    const upstreamInPage = pageAlerts.filter((alert: any) =>
      alert.most_recent_instance.location.path.startsWith("src/upstream/"),
    );

    upstreamAlerts.push(...upstreamInPage);
    console.log(
      `  Found ${upstreamInPage.length} upstream alerts in this page`,
    );
  }

  console.log(`\nTotal upstream alerts to dismiss: ${upstreamAlerts.length}`);

  // Group by file for summary
  const byFile = upstreamAlerts.reduce((acc: any, alert: any) => {
    const path = alert.most_recent_instance.location.path;
    acc[path] = (acc[path] || 0) + 1;
    return acc;
  }, {});

  console.log("\nUpstream alerts by file:");
  Object.entries(byFile)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .forEach(([path, count]) => {
      console.log(`  ${path}: ${count}`);
    });

  // Ask for confirmation
  console.log("\n⚠️  About to dismiss all upstream alerts!");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Process dismissals in smaller batches
  const batchSize = 10;
  let dismissed = 0;
  let failed = 0;

  for (let i = 0; i < upstreamAlerts.length; i += batchSize) {
    const batch = upstreamAlerts.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(upstreamAlerts.length / batchSize);

    console.log(`\nProcessing batch ${batchNum}/${totalBatches}...`);

    for (const alert of batch) {
      try {
        execFileSync(
          "gh",
          [
            "api",
            "-X",
            "PATCH",
            `repos/photostructure/node-sqlite/code-scanning/alerts/${alert.number}`,
            "--field",
            "state=dismissed",
            "--field",
            "dismissed_reason=won't_fix",
            "--field",
            "dismissed_comment=This is upstream SQLite code that we don't control. SQLite has its own security review process.",
          ],
          { stdio: "pipe" },
        );
        dismissed++;
        process.stdout.write("✓");
      } catch (error: any) {
        failed++;
        process.stdout.write("✗");
        console.error(
          `\nFailed to dismiss alert ${alert.number}: ${error.message}`,
        );
      }
    }

    console.log(`\nProgress: ${dismissed} dismissed, ${failed} failed`);

    // Rate limit pause
    if (i + batchSize < upstreamAlerts.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✅ Completed: ${dismissed} dismissed, ${failed} failed`);

  // Show remaining open alerts
  console.log("\nFetching remaining open alerts...");

  const remainingAlertsJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts"],
    { encoding: "utf8" },
  );
  const remainingAlerts = JSON.parse(remainingAlertsJson);
  const remainingCount = remainingAlerts.filter((alert: any) => alert.state === "open").length;

  console.log(`📊 Remaining open alerts: ${remainingCount}`);

  // Get summary of remaining alerts
  const allRemainingJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts", "--paginate"],
    { encoding: "utf8" },
  );
  const allRemaining = JSON.parse(allRemainingJson);
  const openAlerts = allRemaining.filter((alert: any) => alert.state === "open");
  
  // Group by path and get top 10
  const pathCounts = openAlerts.reduce((acc: any, alert: any) => {
    const path = alert.most_recent_instance.location.path;
    acc[path] = (acc[path] || 0) + 1;
    return acc;
  }, {});
  
  const remainingSummary = Object.entries(pathCounts)
    .map(([path, count]) => ({ path, count }))
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 10);

  console.log("\nTop files with remaining alerts:");
  console.log(JSON.stringify(remainingSummary, null, 2));
}

main().catch(console.error);
