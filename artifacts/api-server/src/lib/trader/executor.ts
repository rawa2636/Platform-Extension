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
import { runConsensus } from "./consensus.js";
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
import type { ConsensusVerdict, GuardedAgent } from "./agents/types.js";
import { assessLiquidityTrap, persistSweepLog } from "./liquidity-trap.js";

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
  consensus?: ConsensusVerdict;
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

function serializeConsensusForStorage(cv: ConsensusVerdict): Record<string, unknown> {
  return {
    verdict: cv.verdict,
    direction: cv.direction,
    globalConfidence: cv.globalConfidence,
    trapScore: cv.trapScore,
    dataCompleteness: cv.dataCompleteness,
    deterministicAgreeCount: cv.deterministicAgreeCount,
    llmAgreeCount: cv.llmAgreeCount,
    blockReason: cv.blockReason,
    thresholds: cv.thresholds,
    computedAt: cv.computedAt,
    agents: cv.agents.map((a: GuardedAgent) => ({
      agentId: a.output.agentId,
      agentName: a.output.agentName,
      vote: a.output.vote,
      confidence: a.output.confidence,
      reasoning: a.output.reasoning,
      signals: a.output.signals,
      latencyMs: a.output.latencyMs,
      evidence: a.output.evidence,
      guard: a.guard,
    })),
  };
}

function consensusToAiVotes(cv: ConsensusVerdict): AiVote[] {
  const votes: AiVote[] = [];
  for (const ga of cv.agents) {
    // For LLM ensemble, expand individual member votes if available
    const ext = ga.output as typeof ga.output & { memberVotes?: Array<{ modelId: string; modelName: string; vote: string; confidence: number; reason: string | null; latencyMs: number; hadEvidence: boolean }> };
    if (ga.output.agentId === "llm_ensemble" && Array.isArray(ext.memberVotes)) {
      for (const mv of ext.memberVotes) {
        const v = mv.vote as AiVote["direction"];
        votes.push({
          modelId: mv.modelId,
          modelName: mv.modelName,
          direction: (v === "BUY" || v === "SELL" || v === "NEUTRAL") ? v : "ABSTAIN",
          rationale: mv.reason,
          latencyMs: mv.latencyMs,
          agreed: mv.vote === cv.direction,
        });
      }
    } else {
      const v = ga.output.vote as AiVote["direction"];
      votes.push({
        modelId: ga.output.agentId,
        modelName: ga.output.agentName,
        direction: (v === "BUY" || v === "SELL" || v === "NEUTRAL") ? v : "ABSTAIN",
        rationale: ga.output.reasoning.slice(0, 200),
        latencyMs: ga.output.latencyMs,
        agreed: ga.output.vote === cv.direction && ga.guard.passed,
      });
    }
  }
  return votes;
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

    // 4. Pre-flight: gate 1 (exec mode on)
    const execOn = settings.executionMode !== "OFF";
    if (!execOn) {
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: "executionMode=OFF", positionsClosed,
        gates: [{ gate: "execution_mode_on", passed: false, reason: "executionMode=OFF, trading disabled" }],
      };
    }

    // 5. Pre-flight: source live
    if (snapshot.sourceStatus !== "live") {
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: `source status: ${snapshot.sourceStatus}`, positionsClosed,
        gates: [
          { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
          { gate: "source_live", passed: false, reason: `source status: ${snapshot.sourceStatus}` },
        ],
      };
    }

    // 6. Pre-flight: directional signal
    const hasDir = snapshot.signalDirection === "BUY" || snapshot.signalDirection === "SELL";
    if (!hasDir) {
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: "no directional signal (NEUTRAL)", positionsClosed,
        gates: [
          { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
          { gate: "source_live", passed: true, reason: "data source live" },
          { gate: "directional_signal", passed: false, reason: "no directional signal (NEUTRAL)" },
        ],
      };
    }

    // 7. ── MULTI-AGENT CONSENSUS ENGINE ──────────────────────────────────────
    //    Run all 6 agents (platform, orderflow, trap, macro, vision, LLM ensemble)
    //    through the anti-hallucination guard and strict consensus gate.
    const consensusResult = await runConsensus(snapshot);

    if (consensusResult.verdict === "BLOCK") {
      logger.info(
        { blockReason: consensusResult.blockReason, direction: consensusResult.direction },
        "trader.cycle.consensus_blocked",
      );
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: `CONSENSUS BLOCK: ${consensusResult.blockReason}`,
        positionsClosed,
        gates: [
          { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
          { gate: "source_live", passed: true, reason: "data source live" },
          { gate: "directional_signal", passed: true, reason: `direction=${snapshot.signalDirection}` },
          { gate: "consensus_engine", passed: false, reason: consensusResult.blockReason ?? "consensus blocked" },
        ],
        consensus: consensusResult,
      };
    }

    // 8. Risk rules (ATR, timing, COT, RR, daily cap, max positions, max trades, no dup)
    const ruleEval = await evaluateRules(snapshot, settings, equity);

    if (!ruleEval.passed) {
      const lastFail = ruleEval.gates.find((g) => !g.passed);
      const reason = lastFail?.reason ?? "risk rule rejected";
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      logger.info({ reason }, "trader.cycle.rules_rejected");
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: reason, positionsClosed,
        gates: [
          { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
          { gate: "source_live", passed: true, reason: "data source live" },
          { gate: "directional_signal", passed: true, reason: `direction=${snapshot.signalDirection}` },
          { gate: "consensus_engine", passed: true, reason: `consensus ALLOW: conf=${consensusResult.globalConfidence.toFixed(3)}, agents=${consensusResult.deterministicAgreeCount}, llms=${consensusResult.llmAgreeCount}` },
          ...ruleEval.gates,
        ],
        consensus: consensusResult,
      };
    }

    // Use consensus direction (most recent agreement)
    const direction = consensusResult.direction ?? ruleEval.direction!;

    // 9. Liquidity Trap Detector v2 — assess sweep risk before sizing/entry
    const slDistance = Math.abs(ruleEval.entry! - ruleEval.stopLoss!);
    const sweepAssessment = await assessLiquidityTrap(snapshot, direction as "BUY" | "SELL", slDistance);

    if (!sweepAssessment.entryAllowed) {
      logger.info(
        { sweepProb: sweepAssessment.sweepProbability, blockReason: sweepAssessment.blockReason },
        "trader.cycle.sweep_blocked",
      );
      void persistSweepLog(snapshot, direction as "BUY" | "SELL", sweepAssessment);
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: false, signalId: null, signalStatus: null,
        rejectionReason: `SWEEP BLOCK: ${sweepAssessment.blockReason}`,
        positionsClosed,
        gates: [
          { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
          { gate: "source_live", passed: true, reason: "data source live" },
          { gate: "directional_signal", passed: true, reason: `direction=${snapshot.signalDirection}` },
          { gate: "consensus_engine", passed: true, reason: `ALLOW: conf=${consensusResult.globalConfidence.toFixed(3)}` },
          ...ruleEval.gates,
          {
            gate: "liquidity_trap",
            passed: false,
            reason: sweepAssessment.blockReason ?? "sweep blocked",
            value: sweepAssessment.sweepProbability,
            threshold: 0.70,
          },
        ],
        consensus: consensusResult,
      };
    }

    // 10. Sizing
    const sizing = computePositionSize(ruleEval.entry!, ruleEval.stopLoss!, settings, equity);

    // Persist sweep assessment (allowed path — for ML Memory)
    void persistSweepLog(snapshot, direction as "BUY" | "SELL", sweepAssessment);

    // Serialize agents for audit trail storage
    const allGates: GateDecision[] = [
      { gate: "execution_mode_on", passed: true, reason: `executionMode=${settings.executionMode}` },
      { gate: "source_live", passed: true, reason: "data source live" },
      { gate: "directional_signal", passed: true, reason: `direction=${snapshot.signalDirection}` },
      {
        gate: "consensus_engine",
        passed: true,
        reason: `ALLOW: conf=${consensusResult.globalConfidence.toFixed(3)}, trap=${consensusResult.trapScore.toFixed(3)}, det=${consensusResult.deterministicAgreeCount}, llm=${consensusResult.llmAgreeCount}, complete=${consensusResult.dataCompleteness.toFixed(3)}`,
      },
      {
        gate: "liquidity_trap",
        passed: true,
        reason: `sweep_prob=${(sweepAssessment.sweepProbability * 100).toFixed(0)}%, depth=${sweepAssessment.expectedSweepDepthLow}–${sweepAssessment.expectedSweepDepthHigh}$, recommended_entry=${sweepAssessment.recommendedEntry}`,
        value: sweepAssessment.sweepProbability,
        threshold: 0.70,
      },
      ...ruleEval.gates,
    ];

    const aiVotes = consensusToAiVotes(consensusResult);
    const agreeCount = aiVotes.filter((v) => v.agreed).length;

    const signalId = randomUUID();
    const now = new Date();
    const baseRecord = {
      id: signalId,
      createdAt: now,
      tradingMode: settings.tradingMode,
      executionMode: settings.executionMode,
      direction,
      confidence: consensusResult.globalConfidence,
      sourceScore: snapshot.signalScore,
      entry: ruleEval.entry!,
      stopLoss: ruleEval.stopLoss!,
      takeProfit: ruleEval.takeProfit!,
      riskReward: ruleEval.riskReward,
      atrAbs: ruleEval.atrAbs,
      sizeUnits: sizing.sizeUnits,
      riskAmount: sizing.riskAmount,
      rulesPassed: true,
      aiPassed: true,
      aiVotersCount: aiVotes.length,
      aiAgreeCount: agreeCount,
      snapshotId,
      gates: serializeConsensusForStorage(consensusResult) as unknown as Record<string, unknown>,
      aiVotes: aiVotes as unknown as Record<string, unknown>,
      expiresAt: new Date(now.getTime() + settings.signalExpirySec * 1000),
    };

    if (sizing.sizeUnits <= 0) {
      await db.insert(traderSignalsTable).values({
        ...baseRecord,
        status: "REJECTED",
        rejectionReason: "computed position size is zero",
        decidedAt: now,
      });
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: true, signalId, signalStatus: "REJECTED",
        rejectionReason: "size=0", positionsClosed, gates: allGates, consensus: consensusResult,
      };
    }

    // 10. Execute
    if (settings.executionMode === "AUTO") {
      const pos = await openPosition({
        signalId,
        side: direction as "BUY" | "SELL",
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
      await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
      return {
        ranAt, ok: true, signalCreated: true, signalId, signalStatus: "EXECUTED",
        rejectionReason: null, positionsClosed, gates: allGates, consensus: consensusResult,
      };
    }

    // MANUAL: insert as PENDING
    await db.insert(traderSignalsTable).values({ ...baseRecord, status: "PENDING" });
    await recordCycleTimes(settings.tradingMode === "DAILY" ? 300 : 180);
    return {
      ranAt, ok: true, signalCreated: true, signalId, signalStatus: "PENDING",
      rejectionReason: null, positionsClosed, gates: allGates, consensus: consensusResult,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "trader.cycle.error");
    await recordCycleError(msg);
    return {
      ranAt, ok: false, signalCreated: false, signalId: null, signalStatus: null,
      rejectionReason: msg, positionsClosed: 0, gates: [],
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
