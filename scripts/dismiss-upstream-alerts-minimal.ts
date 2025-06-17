#!/usr/bin/env tsx

/**
 * Dismiss CodeQL alerts from upstream SQLite code
 * This is a one-time cleanup before our SARIF filtering takes effect
 */

import { execFileSync } from "node:child_process";

async function main() {
  console.log("🔍 Dismissing upstream SQLite alerts...");

  // Get all upstream alerts in one batch
  const allAlertsJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts", "--paginate"],
    { encoding: "utf8" },
  );
  const allAlerts = JSON.parse(allAlertsJson);
  const upstreamAlerts = allAlerts
    .filter((alert: any) => alert.most_recent_instance.location.path.startsWith("src/upstream/"))
    .map((alert: any) => alert.number);

  console.log(`Found ${upstreamAlerts.length} upstream alerts to dismiss`);

  if (upstreamAlerts.length === 0) {
    console.log("✅ No upstream alerts to dismiss");
    return;
  }

  console.log("📝 Dismissing alerts in batches...");

  // Process in small batches to avoid rate limits
  const batchSize = 5;
  let dismissed = 0;

  for (let i = 0; i < upstreamAlerts.length; i += batchSize) {
    const batch = upstreamAlerts.slice(i, i + batchSize);

    for (const alertNumber of batch) {
      try {
        execFileSync(
          "gh",
          [
            "api",
            "-X",
            "PATCH",
            `repos/photostructure/node-sqlite/code-scanning/alerts/${alertNumber}`,
            "--field",
            "state=dismissed",
            "--field",
            "dismissed_reason=won't fix",
            "--field",
            "dismissed_comment=Upstream SQLite code - filtered by SARIF processing. See .github/workflows/security.yml",
          ],
          { stdio: "pipe" },
        );
        dismissed++;
        process.stdout.write(".");
      } catch (error: any) {
        process.stdout.write("✗");
        console.error(
          `\nFailed to dismiss alert ${alertNumber}: ${error.message}`,
        );
      }
    }

    // Brief pause between batches
    if (i + batchSize < upstreamAlerts.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(
    `\n✅ Dismissed ${dismissed}/${upstreamAlerts.length} upstream alerts`,
  );

  // Show summary of remaining alerts
  const remainingAlertsJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts"],
    { encoding: "utf8" },
  );
  const remainingAlerts = JSON.parse(remainingAlertsJson);
  const remainingOpen = remainingAlerts.filter((alert: any) => alert.state === "open").length;

  console.log(`📊 Remaining open alerts: ${remainingOpen}`);

  if (remainingOpen > 0) {
    console.log(
      "\nRemaining alerts should now be from your own code that needs attention:",
    );
    const openAlerts = remainingAlerts.filter((alert: any) => alert.state === "open");
    const pathCounts = openAlerts.reduce((acc: any, alert: any) => {
      const path = alert.most_recent_instance.location.path;
      acc[path] = (acc[path] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(pathCounts)
      .sort(([, a]: any, [, b]: any) => b - a)
      .slice(0, 10)
      .forEach(([path, count]) => {
        console.log(`  ${path}: ${count}`);
      });
  }
}

main().catch(console.error);
