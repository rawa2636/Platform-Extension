import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";

export async function runOrderFlowAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const metrics = deriveOrderFlowMetrics(snapshot);
  const vote = metrics.delta > 0.1 ? "BUY" : metrics.delta < -0.1 ? "SELL" : "NEUTRAL";
  const confidence = Math.min(Math.abs(metrics.delta) * 1.2 + 0.3, 1);

  return {
    agentId: "orderflow",
    agentName: "Order Flow",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: ["price_action_proxy", "cot_positioning", "atr_volatility"],
      features_used: [
        "spot",
        "signal.entry",
        "atr_pct",
        "cot.speculator_tilt",
        "signal.confidence",
        "timing.pressure",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: buildReasoning(snapshot, metrics, vote),
    signals: {
      delta: metrics.delta,
      imbalance: metrics.imbalance,
      priceVsEntry: metrics.priceVsEntry,
      atrNorm: metrics.atrNorm,
      cotBias: metrics.cotBias,
      pressureBoost: metrics.pressureBoost,
    },
    latencyMs: Date.now() - t0,
  };
}

interface OrderFlowMetrics {
  delta: number;
  imbalance: number;
  priceVsEntry: number;
  atrNorm: number;
  cotBias: number;
  pressureBoost: number;
}

function deriveOrderFlowMetrics(s: NormalizedSnapshot): OrderFlowMetrics {
  // Price vs signalled entry — positive = above entry = buy pressure
  const priceVsEntry =
    s.signalEntry !== null
      ? Math.tanh((s.spot - s.signalEntry) / (s.atrAbs ?? 1) * 2)
      : 0;

  // ATR normalised: low volatility => cleaner flow signal
  const atrNorm = s.atrPct !== null ? Math.max(0, 1 - s.atrPct * 20) : 0.5;

  // COT bias: structural money flow
  let cotBias = 0;
  if (s.cotTilt === "EXTREME_LONG" || s.cotTilt === "LONG") cotBias = 0.3;
  if (s.cotTilt === "EXTREME_SHORT" || s.cotTilt === "SHORT") cotBias = -0.3;

  // Timing pressure as momentum proxy
  const pressureBoost = s.timingPressure !== null ? Math.tanh(s.timingPressure) * 0.2 : 0;

  // Direction bias from platform signal
  const dirBias =
    s.signalDirection === "BUY" ? 0.25 : s.signalDirection === "SELL" ? -0.25 : 0;

  // Composite delta
  const delta = priceVsEntry * 0.4 + cotBias * 0.3 + dirBias * 0.2 + pressureBoost * 0.1;

  // Imbalance = unsigned magnitude of flow
  const imbalance = Math.abs(delta);

  return { delta, imbalance, priceVsEntry, atrNorm, cotBias, pressureBoost };
}

function buildReasoning(
  s: NormalizedSnapshot,
  m: OrderFlowMetrics,
  vote: string,
): string {
  const parts: string[] = [];
  parts.push(`Price-vs-entry delta: ${m.priceVsEntry.toFixed(3)}`);
  parts.push(`COT structural bias: ${m.cotBias > 0 ? "bullish" : m.cotBias < 0 ? "bearish" : "neutral"} (${s.cotTilt ?? "n/a"})`);
  parts.push(`Timing pressure boost: ${m.pressureBoost.toFixed(3)}`);
  parts.push(`Composite flow delta: ${m.delta.toFixed(3)} → vote ${vote}`);
  return parts.join(". ");
}
