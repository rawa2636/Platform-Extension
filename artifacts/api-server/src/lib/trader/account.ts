import { eq } from "drizzle-orm";
import {
  db,
  traderAccountTable,
  traderSettingsTable,
  traderPositionsTable,
} from "@workspace/db";
import type { TradingMode, ExecutionMode } from "./types.js";

const SINGLETON_ID = "singleton";

export interface AccountState {
  id: string;
  startingBalance: number;
  balance: number;
  realizedPnl: number;
  peakEquity: number;
  dailyPnl: number;
  dailyPnlResetAt: Date;
  totalTrades: number;
  winningTrades: number;
  updatedAt: Date;
}

export interface SettingsState {
  id: string;
  executionMode: ExecutionMode;
  tradingMode: TradingMode;
  riskPerTradePct: number;
  dailyLossCapPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  minConfidence: number;
  minRiskReward: number;
  requireAiConfirmation: boolean;
  aiConfirmCount: number;
  signalExpirySec: number;
  updatedAt: Date;
}

export async function ensureSingletons(): Promise<void> {
  const settings = await db.select().from(traderSettingsTable).limit(1);
  if (settings.length === 0) {
    await db.insert(traderSettingsTable).values({ id: SINGLETON_ID });
  }
  const account = await db.select().from(traderAccountTable).limit(1);
  if (account.length === 0) {
    await db.insert(traderAccountTable).values({ id: SINGLETON_ID });
  }
}

export async function getSettings(): Promise<SettingsState> {
  await ensureSingletons();
  const rows = await db
    .select()
    .from(traderSettingsTable)
    .where(eq(traderSettingsTable.id, SINGLETON_ID))
    .limit(1);
  return rows[0] as SettingsState;
}

export async function getAccount(): Promise<AccountState> {
  await ensureSingletons();
  const rows = await db
    .select()
    .from(traderAccountTable)
    .where(eq(traderAccountTable.id, SINGLETON_ID))
    .limit(1);
  return rows[0] as AccountState;
}

export interface EquityBreakdown {
  account: AccountState;
  settings: SettingsState;
  unrealizedPnl: number;
  equity: number;
  drawdownPct: number;
  openPositions: number;
  tradesToday: number;
  winRate: number | null;
}

export async function computeEquityBreakdown(
  currentSpot: number | null,
): Promise<EquityBreakdown> {
  const [account, settings] = await Promise.all([getAccount(), getSettings()]);

  const openRows = await db
    .select()
    .from(traderPositionsTable)
    .where(eq(traderPositionsTable.status, "OPEN"));

  let unrealized = 0;
  if (currentSpot !== null && Number.isFinite(currentSpot)) {
    for (const p of openRows) {
      const dir = p.side === "BUY" ? 1 : -1;
      unrealized += dir * (currentSpot - p.entry) * p.sizeUnits;
    }
  }

  const equity = account.balance + unrealized;
  const drawdownPct =
    account.peakEquity > 0
      ? Math.max(0, ((account.peakEquity - equity) / account.peakEquity) * 100)
      : 0;

  const todayStart = new Date(account.dailyPnlResetAt);
  const tradesToday = openRows.filter(
    (p) => new Date(p.openedAt).getTime() >= todayStart.getTime(),
  ).length;

  const winRate =
    account.totalTrades > 0
      ? account.winningTrades / account.totalTrades
      : null;

  return {
    account,
    settings,
    unrealizedPnl: unrealized,
    equity,
    drawdownPct,
    openPositions: openRows.length,
    tradesToday,
    winRate,
  };
}

export async function rolloverDailyIfNeeded(): Promise<void> {
  const a = await getAccount();
  const last = new Date(a.dailyPnlResetAt);
  const now = new Date();
  const sameUtcDay =
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate();
  if (!sameUtcDay) {
    await db
      .update(traderAccountTable)
      .set({ dailyPnl: 0, dailyPnlResetAt: now, updatedAt: now })
      .where(eq(traderAccountTable.id, SINGLETON_ID));
  }
}

export async function applyTradePnl(pnl: number): Promise<void> {
  const a = await getAccount();
  const now = new Date();
  const newBalance = a.balance + pnl;
  const newRealized = a.realizedPnl + pnl;
  const newPeak = Math.max(a.peakEquity, newBalance);
  const newDaily = a.dailyPnl + pnl;
  const newTotal = a.totalTrades + 1;
  const newWins = pnl > 0 ? a.winningTrades + 1 : a.winningTrades;
  await db
    .update(traderAccountTable)
    .set({
      balance: newBalance,
      realizedPnl: newRealized,
      peakEquity: newPeak,
      dailyPnl: newDaily,
      totalTrades: newTotal,
      winningTrades: newWins,
      updatedAt: now,
    })
    .where(eq(traderAccountTable.id, SINGLETON_ID));
}

export async function resetAccount(startingBalance: number): Promise<void> {
  const now = new Date();
  await db
    .update(traderAccountTable)
    .set({
      startingBalance,
      balance: startingBalance,
      realizedPnl: 0,
      peakEquity: startingBalance,
      dailyPnl: 0,
      dailyPnlResetAt: now,
      totalTrades: 0,
      winningTrades: 0,
      updatedAt: now,
    })
    .where(eq(traderAccountTable.id, SINGLETON_ID));
}

export async function updateSettings(
  patch: Partial<Omit<SettingsState, "id" | "updatedAt">>,
): Promise<SettingsState> {
  await ensureSingletons();
  await db
    .update(traderSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(traderSettingsTable.id, SINGLETON_ID));
  return getSettings();
}
