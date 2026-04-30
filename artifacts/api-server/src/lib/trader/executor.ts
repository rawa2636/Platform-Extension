import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  traderSignalsTable,
  traderCycleStateTable,
  type traderSettingsTable as _,
} from "@workspace/db";
import { logger } from "../logger.js";
import { fetchAndPersistSnapshot } from "./datasource.js";
import { evaluateRules } from "./rules.js";
import { aiConfirm } from "./ai-confirm.js";
import { computePositionSize } from "./sizing.js";
import {
  checkOpenPositionsForExit,
  openPosition,
} from "./positions.js";
import {
  computeEquityBreakdown,
  getSettings,
  rolloverDailyIfNeeded,
} from "./account.js";
import type { GateDecision, AiVote } from "./types.js";

const SINGLETON = "singleton";

export interface CycleResult {
  ranAt: string;
  ok: boolean;
  signalCreated: boolean;
  signalId: string | null;
  signalStatus: string | null;
  rejectionReason: string | null;
  positionsClosed: number;
  gates: GateDecision[];
}

export async function ensureCycleStateRow(): Promise<void> {
  const rows = await db.select().from(traderCycleStateTable).limit(1);
  if (rows.length === 0) {
    await db
      .insert(traderCycleStateTable)
      .values({ id: SINGLETON, running: false });
  }
}

async function setCycleRunning(running: boolean): Promise<void> {
  await ensureCycleStateRow();
  await db
    .update(traderCycleStateTable)
    .set({ running })
    .where(eq(traderCycleStateTable.id, SINGLETON));
}

async function recordCycleTimes(nextSec: number): Promise<void> {
  const now = new Date();
  const next = new Date(now.getTime() + nextSec * 1000);
  await db
    .update(traderCycleStateTable)
    .set({ lastCycleAt: now, nextCycleAt: next, running: false, lastError: null })
    .where(eq(traderCycleStateTable.id, SINGLETON));
}

async function recordCycleError(message: string): Promise<void> {
  await ensureCycleStateRow();
  await db
    .update(traderCycleStateTable)
    .set({ running: false, lastError: message, lastCycleAt: new Date() })
    .where(eq(traderCycleStateTable.id, SINGLETON));
}

async function persistRejectedSignal(
  data: {
    settings: Awaited<ReturnType<typeof getSettings>>;
    snapshotId: string;
    direction: string;
    confidence: number;
    score: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    atrAbs: number;
    sizeUnits: number;
    riskAmount: number;
    rulesPassed: boolean;
    aiPassed: boolean | null;
    aiVotersCount: number;
    aiAgreeCount: number;
    rejectionReason: string;
    gates: GateDecision[];
    aiVotes: AiVote[];
  },
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(traderSignalsTable).values({
    id,
    createdAt: now,
    tradingMode: data.settings.tradingMode,
    executionMode: data.settings.executionMode,
    direction: data.direction,
    confidence: data.confidence,
    sourceScore: data.score,
    entry: data.entry,
    stopLoss: data.stopLoss,
    takeProfit: data.takeProfit,
    riskReward: data.riskReward,
    atrAbs: data.atrAbs,
    sizeUnits: data.sizeUnits,
    riskAmount: data.riskAmount,
    rulesPassed: data.rulesPassed,
    aiPassed: data.aiPassed,
    aiVotersCount: data.aiVotersCount,
    aiAgreeCount: data.aiAgreeCount,
    status: "REJECTED",
    rejectionReason: data.rejectionReason,
    snapshotId: data.snapshotId,
    gates: data.gates as unknown as Record<string, unknown>,
    aiVotes: data.aiVotes as unknown as Record<string, unknown>,
    expiresAt: new Date(now.getTime() + data.settings.signalExpirySec * 1000),
    decidedAt: now,
  });
  return id;
}

export async function runOneCycle(): Promise<CycleResult> {
  const ranAt = new Date().toISOString();
  await ensureCycleStateRow();
  await setCycleRunning(true);
  try {
    await rolloverDailyIfNeeded();
    const settings = await getSettings();

    // 1. Fetch snapshot
    const { snapshot, snapshotId } = await fetchAndPersistSnapshot();

    // 2. Manage existing open positions
    const positionsClosed = await checkOpenPositionsForExit(snapshot.spot);

    // 3. Compute equity for sizing/limits
    const equity = await computeEquityBreakdown(snapshot.spot);

    // 4. Run rule engine
    const ruleEval = await evaluateRules(snapshot, settings, equity);

    if (!ruleEval.passed) {
      const lastFail = ruleEval.gates.find((g) => !g.passed);
      const reason = lastFail?.reason ?? "rule engine rejected";
      await recordCycleTimes(
        settings.tradingMode === "DAILY" ? 300 : 180,
      );
      logger.info(
        { reason, gates: ruleEval.gates.length },
        "trader.cycle.rules_rejected",
      );
      return {
        ranAt,
        ok: true,
        signalCreated: false,
        signalId: null,
        signalStatus: null,
        rejectionReason: reason,
        positionsClosed,
        gates: ruleEval.gates,
      };
    }

    // 5. AI confirmation (if enabled)
    let aiVotes: AiVote[] = [];
    let aiPassed: boolean | null = null;
    let aiAgreeCount = 0;
    let aiVotersCount = 0;
    if (settings.requireAiConfirmation) {
      const aiRes = await aiConfirm(
        snapshot,
        ruleEval.direction!,
        settings.aiConfirmCount,
      );
      aiVotes = aiRes.votes;
      aiAgreeCount = aiRes.agreeCount;
      aiVotersCount = aiRes.votersCount;
      aiPassed = aiRes.passed;
    }

    // 6. Sizing
    const sizing = computePositionSize(
      ruleEval.entry!,
      ruleEval.stopLoss!,
      settings,
      equity,
    );

    const signalId = randomUUID();
    const now = new Date();
    const baseRecord = {
      id: signalId,
      createdAt: now,
      tradingMode: settings.tradingMode,
      executionMode: settings.executionMode,
      direction: ruleEval.direction!,
      confidence: snapshot.signalConfidence,
      sourceScore: snapshot.signalScore,
      entry: ruleEval.entry!,
      stopLoss: ruleEval.stopLoss!,
      takeProfit: ruleEval.takeProfit!,
      riskReward: ruleEval.riskReward,
      atrAbs: ruleEval.atrAbs,
      sizeUnits: sizing.sizeUnits,
      riskAmount: sizing.riskAmount,
      rulesPassed: true,
      aiPassed,
      aiVotersCount,
      aiAgreeCount,
      snapshotId,
      gates: ruleEval.gates as unknown as Record<string, unknown>,
      aiVotes: aiVotes as unknown as Record<string, unknown>,
      expiresAt: new Date(now.getTime() + settings.signalExpirySec * 1000),
    };

    if (settings.requireAiConfirmation && aiPassed === false) {
      await db.insert(traderSignalsTable).values({
        ...baseRecord,
        status: "REJECTED",
        rejectionReason: `AI confirmation failed (${aiAgreeCount}/${aiVotersCount} agreed, need ${settings.aiConfirmCount})`,
        decidedAt: now,
      });
      await recordCycleTimes(
        settings.tradingMode === "DAILY" ? 300 : 180,
      );
      return {
        ranAt,
        ok: true,
        signalCreated: true,
        signalId,
        signalStatus: "REJECTED",
        rejectionReason: `AI confirmation failed (${aiAgreeCount}/${aiVotersCount})`,
        positionsClosed,
        gates: ruleEval.gates,
      };
    }

    if (sizing.sizeUnits <= 0) {
      await db.insert(traderSignalsTable).values({
        ...baseRecord,
        status: "REJECTED",
        rejectionReason: "computed position size is zero",
        decidedAt: now,
      });
      await recordCycleTimes(
        settings.tradingMode === "DAILY" ? 300 : 180,
      );
      return {
        ranAt,
        ok: true,
        signalCreated: true,
        signalId,
        signalStatus: "REJECTED",
        rejectionReason: "size=0",
        positionsClosed,
        gates: ruleEval.gates,
      };
    }

    // 7. Decide AUTO vs MANUAL
    if (settings.executionMode === "AUTO") {
      const pos = await openPosition({
        signalId,
        side: ruleEval.direction!,
        entry: ruleEval.entry!,
        stopLoss: ruleEval.stopLoss!,
        takeProfit: ruleEval.takeProfit!,
        sizeUnits: sizing.sizeUnits,
        riskAmount: sizing.riskAmount,
      });
      await db.insert(traderSignalsTable).values({
        ...baseRecord,
        status: "EXECUTED",
        positionId: pos.id,
        decidedAt: now,
      });
      await recordCycleTimes(
        settings.tradingMode === "DAILY" ? 300 : 180,
      );
      return {
        ranAt,
        ok: true,
        signalCreated: true,
        signalId,
        signalStatus: "EXECUTED",
        rejectionReason: null,
        positionsClosed,
        gates: ruleEval.gates,
      };
    }

    // MANUAL mode: insert as PENDING for user approval
    await db.insert(traderSignalsTable).values({
      ...baseRecord,
      status: "PENDING",
    });
    await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
    return {
      ranAt,
      ok: true,
      signalCreated: true,
      signalId,
      signalStatus: "PENDING",
      rejectionReason: null,
      positionsClosed,
      gates: ruleEval.gates,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "trader.cycle.error");
    await recordCycleError(msg);
    return {
      ranAt,
      ok: false,
      signalCreated: false,
      signalId: null,
      signalStatus: null,
      rejectionReason: msg,
      positionsClosed: 0,
      gates: [],
    };
  }
}

export async function approveSignal(
  signalId: string,
): Promise<{ ok: boolean; positionId?: string; reason?: string }> {
  const [sig] = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.id, signalId))
    .limit(1);
  if (!sig) return { ok: false, reason: "not found" };
  if (sig.status !== "PENDING") return { ok: false, reason: `not pending (${sig.status})` };
  if (new Date(sig.expiresAt).getTime() < Date.now()) {
    await db
      .update(traderSignalsTable)
      .set({ status: "EXPIRED", decidedAt: new Date() })
      .where(eq(traderSignalsTable.id, signalId));
    return { ok: false, reason: "expired" };
  }
  const pos = await openPosition({
    signalId: sig.id,
    side: sig.direction as "BUY" | "SELL",
    entry: sig.entry,
    stopLoss: sig.stopLoss,
    takeProfit: sig.takeProfit,
    sizeUnits: sig.sizeUnits,
    riskAmount: sig.riskAmount,
  });
  await db
    .update(traderSignalsTable)
    .set({ status: "EXECUTED", positionId: pos.id, decidedAt: new Date() })
    .where(eq(traderSignalsTable.id, signalId));
  return { ok: true, positionId: pos.id };
}

export async function rejectSignal(
  signalId: string,
  reason: string,
): Promise<boolean> {
  const [sig] = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.id, signalId))
    .limit(1);
  if (!sig || sig.status !== "PENDING") return false;
  await db
    .update(traderSignalsTable)
    .set({
      status: "REJECTED",
      rejectionReason: reason || "user rejected",
      decidedAt: new Date(),
    })
    .where(eq(traderSignalsTable.id, signalId));
  return true;
}

export async function expireOldPendingSignals(): Promise<void> {
  const now = new Date();
  const pending = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.status, "PENDING"));
  for (const s of pending) {
    if (new Date(s.expiresAt).getTime() < now.getTime()) {
      await db
        .update(traderSignalsTable)
        .set({ status: "EXPIRED", decidedAt: now })
        .where(eq(traderSignalsTable.id, s.id));
    }
  }
}
