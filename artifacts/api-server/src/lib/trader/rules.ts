import { and, eq, gte } from "drizzle-orm";
import { db, traderPositionsTable } from "@workspace/db";
import type {
  GateDecision,
  NormalizedSnapshot,
  Direction,
} from "./types.js";
import { MODE_CONFIGS } from "./types.js";
import type { SettingsState, EquityBreakdown } from "./account.js";

export interface RuleEvalResult {
  passed: boolean;
  direction: Direction | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number;
  atrAbs: number;
  gates: GateDecision[];
}

export async function evaluateRules(
  snapshot: NormalizedSnapshot,
  settings: SettingsState,
  equity: EquityBreakdown,
): Promise<RuleEvalResult> {
  const gates: GateDecision[] = [];

  const fail = (over: Partial<RuleEvalResult> = {}): RuleEvalResult => ({
    passed: false,
    direction: null,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: 0,
    atrAbs: 0,
    ...over,
    gates,
  });

  // Gate 1: execution mode must allow trading
  const execOn = settings.executionMode !== "OFF";
  gates.push({
    gate: "execution_mode_on",
    passed: execOn,
    reason: execOn
      ? `executionMode=${settings.executionMode}`
      : "executionMode=OFF, trading disabled",
  });
  if (!execOn) return fail();

  // Gate 2: source data live
  const sourceLive = snapshot.sourceStatus === "live";
  gates.push({
    gate: "source_live",
    passed: sourceLive,
    reason: sourceLive
      ? "data source live"
      : `source status: ${snapshot.sourceStatus}`,
  });
  if (!sourceLive) return fail();

  // Gate 3: directional signal exists
  const hasDir =
    snapshot.signalDirection === "BUY" || snapshot.signalDirection === "SELL";
  gates.push({
    gate: "directional_signal",
    passed: hasDir,
    reason: hasDir
      ? `direction=${snapshot.signalDirection}`
      : "no directional signal (NEUTRAL)",
  });
  if (!hasDir) return fail();
  const direction = snapshot.signalDirection as Direction;

  // Gate 4: confidence threshold
  const confOk = snapshot.signalConfidence >= settings.minConfidence;
  gates.push({
    gate: "confidence_threshold",
    passed: confOk,
    reason: confOk
      ? `confidence ${snapshot.signalConfidence.toFixed(2)} >= min ${settings.minConfidence}`
      : `confidence ${snapshot.signalConfidence.toFixed(2)} below min ${settings.minConfidence}`,
    value: snapshot.signalConfidence,
    threshold: settings.minConfidence,
  });
  if (!confOk) return fail();

  // Gate 5: ATR sane
  const atrAbs = snapshot.atrAbs ?? 0;
  const atrOk = atrAbs > 0 && (snapshot.atrPct ?? 0) < 0.1;
  gates.push({
    gate: "atr_sane",
    passed: atrOk,
    reason: atrOk
      ? `ATR=${atrAbs.toFixed(2)} (${((snapshot.atrPct ?? 0) * 100).toFixed(3)}%)`
      : `ATR out of range: abs=${atrAbs}, pct=${snapshot.atrPct}`,
    value: snapshot.atrPct,
  });
  if (!atrOk) return fail();

  // Gate 6: timing not BUILDING
  const timingOk = snapshot.timingState !== "BUILDING";
  gates.push({
    gate: "timing_ready",
    passed: timingOk,
    reason: timingOk
      ? `timing=${snapshot.timingState ?? "n/a"}`
      : `timing=BUILDING (data warming up)`,
  });
  if (!timingOk) return fail();

  // Gate 7: COT extreme reversal filter — block trades aligned with extreme tilt
  const cot = snapshot.cotTilt;
  let cotOk = true;
  let cotReason = `cot=${cot ?? "n/a"}`;
  if (cot === "EXTREME_LONG" && direction === "BUY") {
    cotOk = false;
    cotReason = "COT speculators EXTREME_LONG — blocking new BUY";
  } else if (cot === "EXTREME_SHORT" && direction === "SELL") {
    cotOk = false;
    cotReason = "COT speculators EXTREME_SHORT — blocking new SELL";
  }
  gates.push({ gate: "cot_filter", passed: cotOk, reason: cotReason });
  if (!cotOk) return fail();

  // Gate 8: build entry / SL / TP using mode ATR multiplier
  const mode = MODE_CONFIGS[settings.tradingMode];
  const entry = snapshot.spot;
  const slDist = atrAbs * mode.atrMult;
  const tpDist = slDist * mode.rrTarget;
  const stopLoss =
    direction === "BUY" ? entry - slDist : entry + slDist;
  const takeProfit =
    direction === "BUY" ? entry + tpDist : entry - tpDist;
  const rr = mode.rrTarget;

  // Gate 9: RR meets minimum
  const rrOk = rr >= settings.minRiskReward;
  gates.push({
    gate: "risk_reward_min",
    passed: rrOk,
    reason: rrOk
      ? `RR ${rr.toFixed(2)} >= min ${settings.minRiskReward}`
      : `RR ${rr.toFixed(2)} below min ${settings.minRiskReward}`,
    value: rr,
    threshold: settings.minRiskReward,
  });
  if (!rrOk) return fail();

  // Gate 10: daily loss cap not breached
  const dailyLossCapAbs =
    -(settings.dailyLossCapPct / 100) * equity.account.startingBalance;
  const ddOk = equity.account.dailyPnl > dailyLossCapAbs;
  gates.push({
    gate: "daily_loss_cap",
    passed: ddOk,
    reason: ddOk
      ? `dailyPnl ${equity.account.dailyPnl.toFixed(2)} above cap ${dailyLossCapAbs.toFixed(2)}`
      : `daily loss cap breached (pnl ${equity.account.dailyPnl.toFixed(2)} <= cap ${dailyLossCapAbs.toFixed(2)})`,
    value: equity.account.dailyPnl,
    threshold: dailyLossCapAbs,
  });
  if (!ddOk) return fail();

  // Gate 11: max open positions
  const openOk = equity.openPositions < settings.maxOpenPositions;
  gates.push({
    gate: "max_open_positions",
    passed: openOk,
    reason: openOk
      ? `open ${equity.openPositions} < max ${settings.maxOpenPositions}`
      : `open ${equity.openPositions} >= max ${settings.maxOpenPositions}`,
    value: equity.openPositions,
    threshold: settings.maxOpenPositions,
  });
  if (!openOk) return fail();

  // Gate 12: max trades per day (count today's executed positions)
  const todayStart = new Date(equity.account.dailyPnlResetAt);
  const todayRows = await db
    .select({ id: traderPositionsTable.id })
    .from(traderPositionsTable)
    .where(gte(traderPositionsTable.openedAt, todayStart));
  const tradesToday = todayRows.length;
  const tradesOk = tradesToday < settings.maxTradesPerDay;
  gates.push({
    gate: "max_trades_per_day",
    passed: tradesOk,
    reason: tradesOk
      ? `trades today ${tradesToday} < max ${settings.maxTradesPerDay}`
      : `trades today ${tradesToday} >= max ${settings.maxTradesPerDay}`,
    value: tradesToday,
    threshold: settings.maxTradesPerDay,
  });
  if (!tradesOk) return fail();

  // Gate 13: no duplicate same-direction open position
  const sameDir = await db
    .select({ id: traderPositionsTable.id })
    .from(traderPositionsTable)
    .where(
      and(
        eq(traderPositionsTable.status, "OPEN"),
        eq(traderPositionsTable.side, direction),
      ),
    )
    .limit(1);
  const noDup = sameDir.length === 0;
  gates.push({
    gate: "no_duplicate_direction",
    passed: noDup,
    reason: noDup
      ? `no open ${direction} position`
      : `${direction} position already open`,
  });
  if (!noDup) return fail();

  return {
    passed: true,
    direction,
    entry,
    stopLoss,
    takeProfit,
    riskReward: rr,
    atrAbs,
    gates,
  };
}
