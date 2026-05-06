import type { AgentOutput, GuardResult, AgentId } from "./agents/types.js";

const BUY_KEYWORDS = ["bullish", "support", "oversold", "buy", "long", "upward", "breakout", "accumulation", "demand", "bullish momentum"];
const SELL_KEYWORDS = ["bearish", "resistance", "overbought", "sell", "short", "downward", "breakdown", "distribution", "supply", "bearish momentum"];

const MIN_CONFIDENCE_THRESHOLD = 0.35;

function countKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function crossCheckConsistency(output: AgentOutput): { consistent: boolean; penalty: number; reason: string } {
  if (output.vote === "NEUTRAL" || output.vote === "ABSTAIN") {
    return { consistent: true, penalty: 0, reason: "" };
  }

  const text = output.reasoning;
  const buyCount = countKeywords(text, BUY_KEYWORDS);
  const sellCount = countKeywords(text, SELL_KEYWORDS);
  const totalKeywords = buyCount + sellCount;

  if (totalKeywords === 0) {
    return { consistent: true, penalty: 0.05, reason: "reasoning contains no directional keywords" };
  }

  const buyRatio = buyCount / totalKeywords;

  if (output.vote === "BUY" && buyRatio < 0.3) {
    const penalty = (0.5 - buyRatio) * 0.4;
    return {
      consistent: false,
      penalty,
      reason: `vote=BUY but reasoning has ${sellCount} bearish vs ${buyCount} bullish keywords`,
    };
  }

  if (output.vote === "SELL" && buyRatio > 0.7) {
    const penalty = (buyRatio - 0.5) * 0.4;
    return {
      consistent: false,
      penalty,
      reason: `vote=SELL but reasoning has ${buyCount} bullish vs ${sellCount} bearish keywords`,
    };
  }

  return { consistent: true, penalty: 0, reason: "" };
}

function validateEvidence(output: AgentOutput): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const ev = output.evidence;

  if (!ev) {
    reasons.push("missing evidence object entirely");
    return { valid: false, reasons };
  }

  if (!Array.isArray(ev.sources) || ev.sources.length === 0) {
    reasons.push("evidence.sources is empty");
  }

  if (!Array.isArray(ev.features_used) || ev.features_used.length === 0) {
    reasons.push("evidence.features_used is empty");
  }

  if (!ev.timestamp || typeof ev.timestamp !== "string") {
    reasons.push("evidence.timestamp is missing");
  }

  return { valid: reasons.length === 0, reasons };
}

export function guardValidate(output: AgentOutput): GuardResult {
  const reasons: string[] = [];
  let penaltyScore = 0;
  let passed = true;

  // Rule 1: Must have evidence
  const evidenceCheck = validateEvidence(output);
  if (!evidenceCheck.valid) {
    reasons.push(...evidenceCheck.reasons);
    penaltyScore += 0.5;
    passed = false;
  }

  // Rule 2: Confidence threshold (relaxed for ABSTAIN)
  if (output.vote !== "ABSTAIN" && output.confidence < MIN_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence ${output.confidence.toFixed(3)} below minimum ${MIN_CONFIDENCE_THRESHOLD}`,
    );
    penaltyScore += 0.3;
    passed = false;
  }

  // Rule 3: Cross-check reasoning vs vote direction
  const consistency = crossCheckConsistency(output);
  if (!consistency.consistent) {
    reasons.push(consistency.reason);
    penaltyScore += consistency.penalty;
    // Inconsistency degrades but does not hard-fail unless severe
    if (consistency.penalty >= 0.2) passed = false;
  } else if (consistency.penalty > 0) {
    reasons.push(consistency.reason);
    penaltyScore += consistency.penalty;
  }

  // Rule 4: ABSTAIN agents don't get penalised for missing evidence (vision without frames)
  if (output.vote === "ABSTAIN" && reasons.length === 0) {
    passed = true; // Explicit ABSTAIN with explanation is legitimate
  }

  penaltyScore = Math.min(penaltyScore, 1);
  const adjustedConfidence = Math.max(output.confidence - penaltyScore * 0.5, 0);

  return {
    agentId: output.agentId as AgentId,
    passed: passed || output.vote === "ABSTAIN",
    reasons,
    penaltyScore,
    adjustedConfidence: Math.round(adjustedConfidence * 1000) / 1000,
  };
}
