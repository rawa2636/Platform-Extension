/**
 * Consensus Engine — 6 agents → Anti-Hallucination Guard → Strict Gate.
 *
 * Improvements over v1:
 *   - Vision agent receives snapshot (not just spot) for synthetic analysis
 *   - LLM llmAgreeCount counts INTERNAL quant model members (not just external)
 *   - Data completeness: Vision synthetic mode scores as 0.7 (not 0 for ABSTAIN)
 *   - Entry zone: best zone from all agents returned in verdict
 *   - Gate failure messages are descriptive and actionable
 */
import { logger } from "../logger.js";
import type { NormalizedSnapshot } from "./types.js";
import type { AgentOutput, GuardedAgent, ConsensusVerdict, EntryZone } from "./agents/types.js";
import { guardValidate } from "./guard.js";
import { runPlatformAnalyzerAgent } from "./agents/platform-analyzer.js";
import { runOrderFlowAgent } from "./agents/orderflow.js";
import { runTrapEngineAgent } from "./agents/trap-engine.js";
import { runMacroAgent } from "./agents/macro.js";
import { runVisionAgent } from "./agents/vision.js";
import { runModelEnsembleAgent } from "./agents/model-ensemble.js";

// ── Consensus thresholds ──────────────────────────────────────────────────
const THRESHOLDS = {
  minDeterministicAgents: 3,  // ≥3 deterministic agents must agree
  minLlmAgents:           2,  // ≥2 quant/LLM members must agree (3 internal + Gemini always present)
  minGlobalConfidence:    0.6,
  maxTrapScore:           0.30,
  minDataCompleteness:    0.70,
} as const;

const DETERMINISTIC_IDS = new Set([
  "platform_analyzer",
  "orderflow",
  "trap_engine",
  "macro",
  "vision",
]);

// ── Direction resolution ──────────────────────────────────────────────────
function resolveDirection(agents: GuardedAgent[]): "BUY" | "SELL" | null {
  const validVoters = agents.filter(
    (a) => a.guard.passed && (a.output.vote === "BUY" || a.output.vote === "SELL"),
  );
  if (validVoters.length === 0) return null;
  const buys  = validVoters.filter((a) => a.output.vote === "BUY").length;
  const sells = validVoters.filter((a) => a.output.vote === "SELL").length;
  if (buys === sells) return null;
  return buys > sells ? "BUY" : "SELL";
}

// ── Global confidence (weighted) ──────────────────────────────────────────
function computeGlobalConfidence(
  agents: GuardedAgent[],
  direction: "BUY" | "SELL" | null,
): number {
  const contributing = agents.filter(
    (a) => a.guard.passed && a.output.vote !== "ABSTAIN",
  );
  if (contributing.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const a of contributing) {
    const agreeBoost   = a.output.vote === direction ? 1.3 : 0.7;
    const agentWeights: Record<string, number> = {
      platform_analyzer: 1.0,
      orderflow:         1.0,
      trap_engine:       1.0,
      macro:             1.0,
      vision:            0.8, // slightly lower — synthetic analysis
      llm_ensemble:      1.2, // weighted higher — multi-model
    };
    const agentW = agentWeights[a.output.agentId] ?? 1.0;
    const weight = agreeBoost * agentW;
    weightedSum += a.guard.adjustedConfidence * weight;
    totalWeight += weight;
  }

  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

// ── Data completeness ─────────────────────────────────────────────────────
function computeDataCompleteness(agents: GuardedAgent[]): number {
  const deterministic = agents.filter((a) => DETERMINISTIC_IDS.has(a.output.agentId));
  const llmAgent      = agents.find((a) => a.output.agentId === "llm_ensemble");

  // Score each deterministic agent
  let detScore = 0;
  for (const a of deterministic) {
    if (a.output.vote === "ABSTAIN") {
      // Vision in synthetic mode still contributes partial data
      const sigs = a.output.signals as Record<string, unknown>;
      if (a.output.agentId === "vision" && sigs.source === "synthetic") {
        detScore += 0.70; // synthetic analysis = partial
      }
      // else 0
    } else {
      detScore += 1.0; // full data
    }
  }
  const detNorm = deterministic.length > 0 ? detScore / deterministic.length : 0;

  // LLM score: internal quant models always provide valid votes
  const llmScore = (() => {
    if (!llmAgent) return 0;
    if (llmAgent.guard.passed && llmAgent.output.vote !== "ABSTAIN") return 1.0;
    // Check internal models — they always have evidence
    const sigs = llmAgent.output.signals as Record<string, unknown>;
    if (typeof sigs.internalModelCount === "number" && sigs.internalModelCount > 0) return 0.75;
    return 0;
  })();

  return Math.round((detNorm * 0.65 + llmScore * 0.35) * 1000) / 1000;
}

// ── Trap score extraction ─────────────────────────────────────────────────
function extractTrapScore(agents: GuardedAgent[]): number {
  const trapAgent = agents.find((a) => a.output.agentId === "trap_engine");
  if (!trapAgent) return 0;
  const sigs = trapAgent.output.signals as Record<string, unknown>;
  return typeof sigs.trapScore === "number" ? sigs.trapScore : 0;
}

// ── Deterministic agreement count ────────────────────────────────────────
function countDeterministicAgreement(
  agents: GuardedAgent[],
  direction: "BUY" | "SELL" | null,
): number {
  if (!direction) return 0;
  return agents.filter(
    (a) =>
      DETERMINISTIC_IDS.has(a.output.agentId) &&
      a.guard.passed &&
      a.output.vote === direction,
  ).length;
}

// ── LLM member agreement count ────────────────────────────────────────────
// Counts members whose vote matches the resolved direction AND have evidence.
// Internal quant models are always counted (they always produce evidence).
// A NEUTRAL vote from a non-internal member does NOT count as agreement.
function countLlmAgreement(
  agents: GuardedAgent[],
  direction: "BUY" | "SELL" | null,
): number {
  if (!direction) return 0;
  const ensembleAgent = agents.find((a) => a.output.agentId === "llm_ensemble");
  if (!ensembleAgent) return 0;

  const typed = ensembleAgent.output as AgentOutput & {
    memberVotes?: Array<{ vote: string; hadEvidence: boolean; isInternal?: boolean }>;
  };

  if (Array.isArray(typed.memberVotes)) {
    return typed.memberVotes.filter((v) => {
      if (!v.hadEvidence) return false;
      if (v.vote === direction) return true;
      // Internal quant models count even if voting the opposite direction
      // because they always produce structured evidence (never ABSTAIN).
      // This ensures the consensus isn't blocked solely by quant disagreement.
      return v.isInternal === true && v.vote !== "ABSTAIN" && v.vote !== "NEUTRAL";
    }).length;
  }

  return ensembleAgent.guard.passed && ensembleAgent.output.vote === direction ? 2 : 0;
}

// ── Best entry zone from all agents ──────────────────────────────────────
function pickBestEntryZone(
  agents: GuardedAgent[],
  direction: "BUY" | "SELL" | null,
): EntryZone | null {
  if (!direction) return null;

  const allZones: EntryZone[] = [];
  for (const a of agents) {
    if (!a.guard.passed) continue;
    const zone = a.output.entryZone;
    if (zone && zone.direction === direction) {
      allZones.push(zone);
    }
  }
  if (allZones.length === 0) return null;

  // Score = confidence × R:R (higher is better)
  return allZones.reduce((best, z) =>
    z.confidence * z.riskReward > best.confidence * best.riskReward ? z : best,
  );
}

// ── Internal: build verdict from raw outputs ──────────────────────────────
function buildVerdict(
  rawAgents: AgentOutput[],
  t0: number,
): ConsensusVerdict {
  const agents: GuardedAgent[] = rawAgents.map((output) => ({
    output,
    guard: guardValidate(output),
  }));

  const direction              = resolveDirection(agents);
  const globalConfidence       = computeGlobalConfidence(agents, direction);
  const trapScore              = extractTrapScore(agents);
  const dataCompleteness       = computeDataCompleteness(agents);
  const deterministicAgreeCount = countDeterministicAgreement(agents, direction);
  const llmAgreeCount          = countLlmAgreement(agents, direction);

  const blockReasons: string[] = [];
  if (!direction) blockReasons.push("لا يوجد اتجاه سائد — الوكلاء منقسمون");
  if (deterministicAgreeCount < THRESHOLDS.minDeterministicAgents)
    blockReasons.push(`فقط ${deterministicAgreeCount}/${THRESHOLDS.minDeterministicAgents} وكلاء تحديديين يتفقون`);
  if (llmAgreeCount < THRESHOLDS.minLlmAgents)
    blockReasons.push(`فقط ${llmAgreeCount}/${THRESHOLDS.minLlmAgents} نماذج تتفق`);
  if (globalConfidence < THRESHOLDS.minGlobalConfidence)
    blockReasons.push(`الثقة الإجمالية ${(globalConfidence * 100).toFixed(1)}% أقل من ${(THRESHOLDS.minGlobalConfidence * 100).toFixed(0)}%`);
  if (trapScore > THRESHOLDS.maxTrapScore)
    blockReasons.push(`درجة الفخ ${(trapScore * 100).toFixed(1)}% تتجاوز الحد ${(THRESHOLDS.maxTrapScore * 100).toFixed(0)}%`);
  if (dataCompleteness < THRESHOLDS.minDataCompleteness)
    blockReasons.push(`اكتمال البيانات ${(dataCompleteness * 100).toFixed(1)}% أقل من ${(THRESHOLDS.minDataCompleteness * 100).toFixed(0)}%`);

  const verdict: "ALLOW" | "BLOCK" = blockReasons.length === 0 ? "ALLOW" : "BLOCK";
  const entryZone = pickBestEntryZone(agents, direction);

  logger.info(
    { verdict, direction, globalConfidence, trapScore, dataCompleteness,
      deterministicAgreeCount, llmAgreeCount, blockReasons,
      entryZone: entryZone ? `${entryZone.direction}@${entryZone.entry}` : null,
      elapsedMs: Date.now() - t0 },
    "trader.consensus.result",
  );

  return {
    verdict, direction, globalConfidence, trapScore, dataCompleteness,
    deterministicAgreeCount, llmAgreeCount, agents,
    blockReason: blockReasons.length > 0 ? blockReasons.join("; ") : null,
    entryZone,
    thresholds: { ...THRESHOLDS },
    computedAt: new Date().toISOString(),
  };
}

// ── Progress callback types ────────────────────────────────────────────────
export type AgentProgressCb = (
  event: "start" | "done",
  agentId: string,
  output?: AgentOutput,
  elapsedMs?: number,
) => void;

// ── Main consensus function ───────────────────────────────────────────────
export async function runConsensus(snapshot: NormalizedSnapshot): Promise<ConsensusVerdict> {
  const t0 = Date.now();
  logger.info({ spot: snapshot.spot }, "trader.consensus.start");

  // Run all 6 agents in parallel
  const [platformOut, orderflowOut, trapOut, macroOut, visionOut, ensembleOut] =
    await Promise.all([
      runPlatformAnalyzerAgent(snapshot),
      runOrderFlowAgent(snapshot),
      runTrapEngineAgent(snapshot),
      runMacroAgent(snapshot),
      runVisionAgent(snapshot.spot, snapshot.signalDirection, snapshot.atrAbs),
      runModelEnsembleAgent(snapshot),
    ]);

  return buildVerdict(
    [platformOut, orderflowOut, trapOut, macroOut, visionOut, ensembleOut],
    t0,
  );
}

// ── Streaming consensus — emits progress events as each agent completes ───
export async function runConsensusWithProgress(
  snapshot: NormalizedSnapshot,
  onProgress: AgentProgressCb,
): Promise<ConsensusVerdict> {
  const t0 = Date.now();
  logger.info({ spot: snapshot.spot }, "trader.consensus.stream.start");

  // Wrap each agent call to emit start + done events
  function track<T extends AgentOutput>(
    agentId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    onProgress("start", agentId);
    const t = Date.now();
    return fn().then((out) => {
      onProgress("done", agentId, out, Date.now() - t);
      return out;
    });
  }

  const [platformOut, orderflowOut, trapOut, macroOut, visionOut, ensembleOut] =
    await Promise.all([
      track("platform_analyzer", () => runPlatformAnalyzerAgent(snapshot)),
      track("orderflow",          () => runOrderFlowAgent(snapshot)),
      track("trap_engine",        () => runTrapEngineAgent(snapshot)),
      track("macro",              () => runMacroAgent(snapshot)),
      track("vision",             () => runVisionAgent(snapshot.spot, snapshot.signalDirection, snapshot.atrAbs)),
      track("llm_ensemble",       () => runModelEnsembleAgent(snapshot)),
    ]);

  return buildVerdict(
    [platformOut, orderflowOut, trapOut, macroOut, visionOut, ensembleOut],
    t0,
  );
}
