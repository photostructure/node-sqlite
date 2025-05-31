// Helper script for multi-process tests
const { DatabaseSync } = require("../dist/index.cjs");

const command = process.argv[2];
const dbPath = process.argv[3];

switch (command) {
  case "read": {
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare("SELECT * FROM test").all();
    console.log(JSON.stringify(rows));
    db.close();
    break;
  }

  case "count": {
    const db = new DatabaseSync(dbPath);
    const stmt = db.prepare(
      "SELECT COUNT(*) as count, SUM(value) as sum FROM shared_data",
    );
    const result = stmt.get();
    console.log(JSON.stringify(result));
    db.close();
    break;
  }

  case "increment": {
    const processId = process.argv[4];
    const db = new DatabaseSync(dbPath, { timeout: 5000 }); // Increase timeout
    let successes = 0;

    // Ensure we're in WAL mode (in case parent process setting didn't persist)
    db.exec("PRAGMA journal_mode = WAL");

    for (let i = 0; i < 10; i++) {
      let retries = 5; // Increase retries
      while (retries > 0) {
        try {
          db.exec("BEGIN IMMEDIATE");
          const current = db
            .prepare("SELECT value FROM counters WHERE id = 1")
            .get();
          const newValue = current.value + 1;
          db.prepare("UPDATE counters SET value = ? WHERE id = 1").run(
            newValue,
          );
          db.exec("COMMIT");

          // Force a checkpoint after each successful commit to ensure durability
          if (i === 9) {
            // Only on last iteration
            try {
              db.exec("PRAGMA wal_checkpoint(PASSIVE)");
            } catch {
              // Ignore checkpoint errors
            }
          }

          successes++;
          break; // Success, exit retry loop
        } catch (e) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Ignore rollback errors
          }

          // If database is locked, retry after a small delay
          if (
            retries > 1 &&
            (e.message.includes("locked") || e.message.includes("busy"))
          ) {
            retries--;
            // Small random delay to reduce contention
            const delay = Math.random() * 100 + processId * 10; // Add process-specific offset
            const start = Date.now();
            while (Date.now() - start < delay) {
              // Busy wait
            }
          } else {
            // Log unexpected errors
            if (!e.message.includes("locked") && !e.message.includes("busy")) {
              console.error(`Process ${processId} error:`, e.message);
            }
            break; // Non-retriable error or out of retries
          }
        }
      }
    }

    // Ensure output is flushed before exit
    process.stdout.write(successes.toString() + "\n");
    db.close();

    // Small delay to ensure output is flushed
    setTimeout(() => {
      process.exit(0);
    }, 10);
    break;
  }

  case "write": {
    const processId = parseInt(process.argv[4]);
    const db = new DatabaseSync(dbPath, { timeout: 10000 });

    try {
      const stmt = db.prepare(
        "INSERT INTO process_writes (process_id, value, timestamp) VALUES (?, ?, ?)",
      );

      for (let i = 0; i < 20; i++) {
        stmt.run(
          processId,
          `value_${processId}_${i}`,
          new Date().toISOString(),
        );
        // Small delay to increase chance of contention
        if (i % 5 === 0) {
          const start = Date.now();
          while (Date.now() - start < 10) {
            // Busy wait
          }
        }
      }

      console.log("SUCCESS");
    } catch (error) {
      console.error("ERROR:", error.message);
    } finally {
      db.close();
    }
    break;
  }

  default:
    console.error("Unknown command:", command);
    process.exit(1);
}
