#!/usr/bin/env tsx

/**
 * Dismiss false positive CodeQL alerts
 */

import { execFileSync } from "node:child_process";

async function main() {
  const falsePosAlerts = [
    { id: 515, reason: "Documentation HTML file, not application code" },
    {
      id: 519,
      reason: "N-API design pattern - BigInt to Value assignment is intended",
    },
    {
      id: 520,
      reason: "N-API design pattern - Number to Value assignment is intended",
    },
    {
      id: 521,
      reason: "N-API design pattern - BigInt to Value assignment is intended",
    },
    {
      id: 522,
      reason: "N-API design pattern - Number to Value assignment is intended",
    },
    {
      id: 530,
      reason: "N-API design pattern - Function to Value assignment is intended",
    },
    {
      id: 513,
      reason:
        "Alert refers to non-existent .mjs file - fixed by converting to TypeScript",
    },
    {
      id: 514,
      reason:
        "Alert refers to non-existent .mjs file - fixed by converting to TypeScript",
    },
  ];

  console.log(`Dismissing ${falsePosAlerts.length} false positive alerts...`);

  for (const alert of falsePosAlerts) {
    try {
      execFileSync(
        "gh",
        [
          "api",
          "-X",
          "PATCH",
          `repos/photostructure/node-sqlite/code-scanning/alerts/${alert.id}`,
          "--field",
          "state=dismissed",
          "--field",
          "dismissed_reason=false positive",
          "--field",
          `dismissed_comment=${alert.reason}`,
        ],
        { stdio: "pipe" },
      );
      console.log(`✓ Dismissed alert ${alert.id}: ${alert.reason}`);
    } catch (error: any) {
      console.error(`✗ Failed to dismiss alert ${alert.id}: ${error.message}`);
    }
  }

  // Check remaining alerts
  const alertsJson = execFileSync(
    "gh",
    ["api", "repos/photostructure/node-sqlite/code-scanning/alerts"],
    { encoding: "utf8" },
  );

  const allAlerts = JSON.parse(alertsJson);
  const remaining = allAlerts.filter((alert: any) => alert.state === "open");

  console.log(`\n📊 Remaining open alerts: ${remaining.length}`);

  if (remaining.length > 0) {
    console.log("\nRemaining alerts that need attention:");
    remaining.forEach((alert: any) => {
      console.log(
        `  ${alert.number}: ${alert.rule.description} in ${alert.most_recent_instance.location.path}:${alert.most_recent_instance.location.start_line}`,
      );
    });
  } else {
    console.log("🎉 All alerts resolved!");
  }
}

main().catch(console.error);
