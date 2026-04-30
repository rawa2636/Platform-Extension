import { logger } from "../logger";
import { startHarvestRun, isHarvestRunning } from "./orchestrator";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

let scheduledTimer: NodeJS.Timeout | null = null;
let nextScheduledAt: Date | null = null;

function nextRunDate(): Date {
  return new Date(Date.now() + TWELVE_HOURS_MS);
}

export function getNextScheduledAt(): Date | null {
  return nextScheduledAt;
}

async function tick(): Promise<void> {
  try {
    if (!isHarvestRunning()) {
      logger.info("scheduler triggering harvest run");
      await startHarvestRun();
    } else {
      logger.info("scheduler skipped (run already in progress)");
    }
  } catch (err) {
    logger.error({ err }, "scheduler tick failed");
  } finally {
    nextScheduledAt = nextRunDate();
    scheduledTimer = setTimeout(() => {
      void tick();
    }, TWELVE_HOURS_MS);
  }
}

export function startScheduler(): void {
  if (scheduledTimer) return;
  nextScheduledAt = nextRunDate();
  scheduledTimer = setTimeout(() => {
    void tick();
  }, TWELVE_HOURS_MS);
  logger.info(
    { nextScheduledAt },
    "harvest scheduler armed (every 12 hours)",
  );
}
