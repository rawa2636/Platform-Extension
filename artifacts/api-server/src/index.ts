import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/harvester/scheduler";
import { startTraderScheduler } from "./lib/trader/scheduler";
import { initGoldPlatform } from "./lib/trader/gold-platform";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Harvester scheduler — does not touch DB at startup, safe to run directly
  startScheduler();

  // Trader scheduler — initialises singleton DB rows; wrap so a missing/frozen
  // production DB does not crash the process and healthz keeps returning 200.
  startTraderScheduler().catch((err) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.scheduler.start.error — running in degraded mode",
    );
  });

  // Gold platform SSE — purely network; wrap defensively
  try {
    initGoldPlatform();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "gold.platform.init.error — running in degraded mode",
    );
  }
});
