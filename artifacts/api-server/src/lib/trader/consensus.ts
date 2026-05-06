import { logger } from "../logger.js";
import type { NormalizedSnapshot } from "./types.js";
import type { AgentOutput, GuardedAgent, ConsensusVerdict } from "./agents/types.js";
import { guardValidate } from "./guard.js";
import { runPlatformAnalyzerAgent } from "./agents/platform-analyzer.js";
import { runOrderFlowAgent } from "./agents/orderflow.js";
import { runTrapEngineAgent } from "./agents/trap-engine.js";
import { runMacroAgent } from "./agents/macro.js";
import { runVisionAgent } from "./agents/vision.js";
import { runModelEnsembleAgent } from "./agents/model-ensemble.js";

// ── Consensus thresholds ─────────────────────────────────────────────────────
const THRESHOLDS = {
  minDeterministicAgents: 3,
  minLlmAgents: 2,
  minGlobalConfidence: 0.8,
  maxTrapScore: 0.2,
  minDataCompleteness: 0.9,
} as const;

// Deterministic agent IDs (excludes llm_ensemble)
const DETERMINISTIC_IDS = new Set([
  "platform_analyzer",
  "orderflow",
  "trap_engine",
  "macro",
  "vision",
]);

function resolveDirection(agents: GuardedAgent[]): "BUY" | "SELL" | null {
  const validVoters = agents.filter(
    (a) => a.guard.passed && (a.output.vote === "BUY" || a.output.vote === "SELL"),
  );
  if (validVoters.length === 0) return null;
  const buys = validVoters.filter((a) => a.output.vote === "BUY").length;
  const sells = validVoters.filter((a) => a.output.vote === "SELL").length;
  if (buys === sells) return null;
  return buys > sells ? "BUY" : "SELL";
}

function computeGlobalConfidence(agents: GuardedAgent[], direction: "BUY" | "SELL" | null): number {
  const contributing = agents.filter(
    (a) => a.guard.passed && a.output.vote !== "ABSTAIN",
  );
  if (contributing.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const a of contributing) {
    // Higher weight for agents that agree with final direction
    const weight = a.output.vote === direction ? 1.2 : 0.7;
    weightedSum += a.guard.adjustedConfidence * weight;
    totalWeight += weight;
  }

  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

function computeDataCompleteness(agents: GuardedAgent[]): number {
  const deterministic = agents.filter((a) => DETERMINISTIC_IDS.has(a.output.agentId));
  const llm = agents.filter((a) => a.output.agentId === "llm_ensemble");

  // Completeness = fraction of deterministic agents that are not ABSTAIN
  const detActive = deterministic.filter((a) => a.output.vote !== "ABSTAIN").length;
  const detScore = deterministic.length > 0 ? detActive / deterministic.length : 0;

  // LLM: either has valid ensemble vote or not
  const llmScore = llm.some((a) => a.guard.passed && a.output.vote !== "ABSTAIN") ? 1 : 0;

  return Math.round((detScore * 0.7 + llmScore * 0.3) * 1000) / 1000;
}

function extractTrapScore(agents: GuardedAgent[]): number {
  const trapAgent = agents.find((a) => a.output.agentId === "trap_engine");
  if (!trapAgent) return 0;
  const sigs = trapAgent.output.signals as Record<string, unknown>;
  return typeof sigs.trapScore === "number" ? sigs.trapScore : 0;
}

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

function countLlmAgreement(agents: GuardedAgent[], direction: "BUY" | "SELL" | null): number {
  if (!direction) return 0;
  const ensembleAgent = agents.find((a) => a.output.agentId === "llm_ensemble");
  if (!ensembleAgent || !ensembleAgent.guard.passed) return 0;

  // Check individual member votes from signals
  const sigs = ensembleAgent.output.signals as Record<string, unknown>;
  const memberVotes = ensembleAgent.output as AgentOutput & { memberVotes?: Array<{ vote: string; hadEvidence: boolean }> };
  if (!Array.isArray(memberVotes.memberVotes)) {
    // Fallback: count ensemble as 1 or 2 based on vote
    return ensembleAgent.output.vote === direction ? 2 : 0;
  }
  return memberVotes.memberVotes.filter(
    (v) => v.hadEvidence && v.vote === direction,
  ).length;
}

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
      runVisionAgent(snapshot.spot),
      runModelEnsembleAgent(snapshot),
    ]);

  const rawAgents: AgentOutput[] = [
    platformOut,
    orderflowOut,
    trapOut,
    macroOut,
    visionOut,
    ensembleOut,
  ];

  // Guard validation for every agent
  const agents: GuardedAgent[] = rawAgents.map((output) => ({
    output,
    guard: guardValidate(output),
  }));

  // Compute metrics
  const direction = resolveDirection(agents);
  const globalConfidence = computeGlobalConfidence(agents, direction);
  const trapScore = extractTrapScore(agents);
  const dataCompleteness = computeDataCompleteness(agents);
  const deterministicAgreeCount = countDeterministicAgreement(agents, direction);
  const llmAgreeCount = countLlmAgreement(agents, direction);

  // Apply strict consensus gate
  const blockReasons: string[] = [];

  if (!direction) {
    blockReasons.push("no dominant direction from guarded agents");
  }
  if (deterministicAgreeCount < THRESHOLDS.minDeterministicAgents) {
    blockReasons.push(
      `deterministic agent agreement ${deterministicAgreeCount} < ${THRESHOLDS.minDeterministicAgents} required`,
    );
  }
  if (llmAgreeCount < THRESHOLDS.minLlmAgents) {
    blockReasons.push(
      `LLM agreement ${llmAgreeCount} < ${THRESHOLDS.minLlmAgents} required`,
    );
  }
  if (globalConfidence < THRESHOLDS.minGlobalConfidence) {
    blockReasons.push(
      `global confidence ${globalConfidence.toFixed(3)} < ${THRESHOLDS.minGlobalConfidence}`,
    );
  }
  if (trapScore > THRESHOLDS.maxTrapScore) {
    blockReasons.push(
      `trap score ${trapScore.toFixed(3)} > ${THRESHOLDS.maxTrapScore} maximum`,
    );
  }
  if (dataCompleteness < THRESHOLDS.minDataCompleteness) {
    blockReasons.push(
      `data completeness ${dataCompleteness.toFixed(3)} < ${THRESHOLDS.minDataCompleteness}`,
    );
  }

  const verdict = blockReasons.length === 0 ? "ALLOW" : "BLOCK";

  logger.info(
    {
      verdict,
      direction,
      globalConfidence,
      trapScore,
      dataCompleteness,
      deterministicAgreeCount,
      llmAgreeCount,
      blockReasons,
      elapsedMs: Date.now() - t0,
    },
    "trader.consensus.result",
  );

  return {
    verdict,
    direction,
    globalConfidence,
    trapScore,
    dataCompleteness,
    deterministicAgreeCount,
    llmAgreeCount,
    agents,
    blockReason: blockReasons.length > 0 ? blockReasons.join("; ") : null,
    thresholds: { ...THRESHOLDS },
    computedAt: new Date().toISOString(),
  };
}
