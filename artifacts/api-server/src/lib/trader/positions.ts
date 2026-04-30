import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  traderPositionsTable,
  traderEquityCurveTable,
} from "@workspace/db";
import { logger } from "../logger.js";
import {
  applyTradePnl,
  computeEquityBreakdown,
  rolloverDailyIfNeeded,
} from "./account.js";

export interface OpenPositionParams {
  signalId: string;
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUnits: number;
  riskAmount: number;
}

export async function openPosition(
  p: OpenPositionParams,
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(traderPositionsTable).values({
    id,
    signalId: p.signalId,
    side: p.side,
    entry: p.entry,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    sizeUnits: p.sizeUnits,
    riskAmount: p.riskAmount,
    openedAt: new Date(),
    status: "OPEN",
  });
  logger.info(
    {
      id,
      side: p.side,
      entry: p.entry,
      sl: p.stopLoss,
      tp: p.takeProfit,
      size: p.sizeUnits,
    },
    "trader.position.opened",
  );
  await recordEquityPoint(p.entry);
  return { id };
}

export interface ClosePositionResult {
  pnl: number;
  pnlR: number;
  exitPrice: number;
  exitReason: string;
}

export async function closePosition(
  positionId: string,
  currentPrice: number,
  exitReason: string,
): Promise<ClosePositionResult | null> {
  const [pos] = await db
    .select()
    .from(traderPositionsTable)
    .where(eq(traderPositionsTable.id, positionId))
    .limit(1);
  if (!pos || pos.status !== "OPEN") return null;
  const dir = pos.side === "BUY" ? 1 : -1;
  const pnl = dir * (currentPrice - pos.entry) * pos.sizeUnits;
  const pnlR = pos.riskAmount > 0 ? pnl / pos.riskAmount : 0;
  await db
    .update(traderPositionsTable)
    .set({
      status: "CLOSED",
      closedAt: new Date(),
      exitPrice: currentPrice,
      exitReason,
      pnl: Math.round(pnl * 100) / 100,
      pnlR: Math.round(pnlR * 1000) / 1000,
    })
    .where(eq(traderPositionsTable.id, positionId));
  await rolloverDailyIfNeeded();
  await applyTradePnl(pnl);
  await recordEquityPoint(currentPrice);
  logger.info(
    { id: positionId, pnl, pnlR, exitReason },
    "trader.position.closed",
  );
  return {
    pnl: Math.round(pnl * 100) / 100,
    pnlR: Math.round(pnlR * 1000) / 1000,
    exitPrice: currentPrice,
    exitReason,
  };
}

export async function checkOpenPositionsForExit(
  currentPrice: number,
): Promise<number> {
  const open = await db
    .select()
    .from(traderPositionsTable)
    .where(eq(traderPositionsTable.status, "OPEN"));
  let closedCount = 0;
  for (const p of open) {
    let exitReason: string | null = null;
    let exitPrice = currentPrice;
    if (p.side === "BUY") {
      if (currentPrice <= p.stopLoss) {
        exitReason = "SL";
        exitPrice = p.stopLoss;
      } else if (currentPrice >= p.takeProfit) {
        exitReason = "TP";
        exitPrice = p.takeProfit;
      }
    } else {
      if (currentPrice >= p.stopLoss) {
        exitReason = "SL";
        exitPrice = p.stopLoss;
      } else if (currentPrice <= p.takeProfit) {
        exitReason = "TP";
        exitPrice = p.takeProfit;
      }
    }
    if (exitReason) {
      await closePosition(p.id, exitPrice, exitReason);
      closedCount += 1;
    }
  }
  return closedCount;
}

export async function recordEquityPoint(currentSpot: number): Promise<void> {
  const eq = await computeEquityBreakdown(currentSpot);
  await db.insert(traderEquityCurveTable).values({
    id: randomUUID(),
    t: new Date(),
    equity: Math.round(eq.equity * 100) / 100,
    realizedPnl: Math.round(eq.account.realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(eq.unrealizedPnl * 100) / 100,
    openPositions: eq.openPositions,
  });
}
