import { logger } from "../logger.js";
import { runOneCycle, expireOldPendingSignals } from "./executor.js";
import { getSettings, ensureSingletons } from "./account.js";
import { ensureCycleStateRow } from "./executor.js";

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await expireOldPendingSignals();
    const settings = await getSettings();
    if (settings.executionMode === "OFF") {
      return;
    }
    await runOneCycle();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.scheduler.tick.error",
    );
  } finally {
    inFlight = false;
  }
}

async function loop(): Promise<void> {
  await tick();
  const settings = await getSettings();
  const intervalSec =
    settings.tradingMode === "DAILY" ? 300 : 180;
  timer = setTimeout(loop, intervalSec * 1000);
}

export async function startTraderScheduler(): Promise<void> {
  await ensureSingletons();
  await ensureCycleStateRow();
  if (timer) clearTimeout(timer);
  // Initial delay 15s to let server warm up
  timer = setTimeout(loop, 15_000);
  logger.info("trader.scheduler.started");
}

export function stopTraderScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
