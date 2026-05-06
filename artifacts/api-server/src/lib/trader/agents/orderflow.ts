/**
 * Order Flow Agent — Quantitative institutional flow analysis.
 * Analyzes:
 *   - COT net positioning (structural smart money)
 *   - Price vs key level displacement (order absorption proxy)
 *   - ATR-normalized volatility regime
 *   - Timing pressure as a momentum indicator
 *   - Bid/ask imbalance model
 *   - Entry zone based on flow reversal math
 */
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  estimateAtr,
  GOLD_PIP,
} from "./quant-math.js";

interface FlowMetrics {
  // COT structural positioning [-1,+1]
  cotDelta: number;
  // Price displacement from nearest key level (normalized by ATR)
  levelDisplacement: number;
  // Volatility regime: 0=compressed, 1=expanded
  volatilityRegime: number;
  // Timing momentum [-1,+1]
  timingMomentum: number;
  // Bid/ask imbalance proxy [-1,+1]
  bidAskImbalance: number;
  // Composite flow delta [-1,+1]
  compositeDelta: number;
  // Nearest key level
  nearestLevel: number;
  nearestLevelLabel: string;
}

export async function runOrderFlowAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const atr = snapshot.atrAbs ?? estimateAtr(snapshot.spot);
  const spot = snapshot.spot;
  const allLevels = buildAllLevels(spot, atr);

  const metrics = computeFlowMetrics(snapshot, atr, allLevels, spot);

  // Vote — lower threshold for institutional flow (even 0.04 delta is significant)
  const threshold = 0.04;
  const vote: AgentOutput["vote"] =
    metrics.compositeDelta > threshold  ? "BUY"  :
    metrics.compositeDelta < -threshold ? "SELL" :
    "NEUTRAL";

  // Confidence based on signal magnitude and consistency
  const magnitude = Math.abs(metrics.compositeDelta);
  let confidence = 0.40 + magnitude * 0.55;

  // Boost if COT and timing agree
  const cotAgrees =
    (metrics.cotDelta > 0 && vote === "BUY") ||
    (metrics.cotDelta < 0 && vote === "SELL");
  if (cotAgrees) confidence = Math.min(confidence + 0.08, 0.97);

  // Reduce if high news (uncertainty)
  if (snapshot.newsHighImpactCount >= 4)
    confidence = Math.max(confidence - 0.10, 0.20);

  confidence = Math.round(confidence * 1000) / 1000;

  // Entry zone
  let entryZone: EntryZone | null = null;
  const biasDire = vote === "NEUTRAL" ? null : vote;
  if (biasDire) {
    const zones = scanEntryZones(spot, atr, biasDire, allLevels, "orderflow");
    entryZone = zones[0] ?? null;
  }

  const reasoning = [
    `COT positioning delta: ${metrics.cotDelta > 0 ? "+" : ""}${metrics.cotDelta.toFixed(3)} (${snapshot.cotTilt ?? "n/a"})`,
    `Price displacement from nearest level (${metrics.nearestLevelLabel}=${metrics.nearestLevel.toFixed(2)}): ${(metrics.levelDisplacement * atr).toFixed(2)} pts = ${metrics.levelDisplacement.toFixed(2)} ATR`,
    `Volatility regime: ${metrics.volatilityRegime > 0.6 ? "EXPANDED" : metrics.volatilityRegime < 0.3 ? "COMPRESSED" : "NORMAL"} (${metrics.volatilityRegime.toFixed(2)})`,
    `Timing momentum: ${metrics.timingMomentum.toFixed(3)}`,
    `Bid/ask imbalance proxy: ${metrics.bidAskImbalance.toFixed(3)}`,
    `Composite flow delta: ${metrics.compositeDelta > 0 ? "+" : ""}${metrics.compositeDelta.toFixed(3)} → vote=${vote} conf=${confidence}`,
    entryZone ? `Entry zone: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit} (${entryZone.slPips}pp/${entryZone.tpPips}pp, R:R=${entryZone.riskReward})` : "No tight-SL entry zone found",
  ].join(". ");

  return {
    agentId: "orderflow",
    agentName: "Order Flow",
    vote,
    confidence,
    evidence: {
      sources: [
        "cot_positioning",
        "price_level_displacement",
        "atr_volatility_regime",
        "timing_momentum",
        "bid_ask_model",
      ],
      features_used: [
        "spot",
        "atr_abs",
        "atr_pct",
        "cot.speculator_tilt",
        "timing.pressure",
        "timing.state",
        "signal.confidence",
        "signal.direction",
        "pivot_levels",
        "round_numbers",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning,
    signals: {
      cotDelta: metrics.cotDelta,
      levelDisplacement: metrics.levelDisplacement,
      nearestLevel: metrics.nearestLevel,
      nearestLevelLabel: metrics.nearestLevelLabel,
      volatilityRegime: metrics.volatilityRegime,
      timingMomentum: metrics.timingMomentum,
      bidAskImbalance: metrics.bidAskImbalance,
      compositeDelta: metrics.compositeDelta,
      atr,
    },
    entryZone,
    latencyMs: Date.now() - t0,
  };
}

function computeFlowMetrics(
  s: NormalizedSnapshot,
  atr: number,
  allLevels: Array<{ price: number; label: string; weight: number }>,
  spot: number,
): FlowMetrics {
  // ── COT structural delta ──────────────────────────────────────────────────
  let cotDelta = 0;
  if (s.cotTilt === "EXTREME_LONG") cotDelta =  0.22;  // slightly contrarian
  else if (s.cotTilt === "LONG")    cotDelta =  0.35;
  else if (s.cotTilt === "SHORT")   cotDelta = -0.35;
  else if (s.cotTilt === "EXTREME_SHORT") cotDelta = -0.22;

  // ── Nearest key level displacement ───────────────────────────────────────
  let nearestLevel = spot;
  let nearestLevelLabel = "spot";
  let minDist = Infinity;
  for (const lvl of allLevels) {
    const d = Math.abs(lvl.price - spot);
    if (d < minDist) { minDist = d; nearestLevel = lvl.price; nearestLevelLabel = lvl.label; }
  }
  // Normalized displacement (positive = above level = selling pressure at resistance)
  const rawDisp = (spot - nearestLevel) / atr;
  // High displacement from level = potential mean reversion signal
  const levelDisplacement = Math.tanh(rawDisp * 2);

  // ── Volatility regime ─────────────────────────────────────────────────────
  let volatilityRegime = 0.5;
  if (s.atrPct !== null) {
    // Gold typical daily ATR% = 0.5-0.8%. >1% = expanded, <0.3% = compressed
    if (s.atrPct > 0.010) volatilityRegime = 1.0;
    else if (s.atrPct > 0.007) volatilityRegime = 0.75;
    else if (s.atrPct > 0.004) volatilityRegime = 0.5;
    else if (s.atrPct > 0.002) volatilityRegime = 0.3;
    else volatilityRegime = 0.1;
  }

  // ── Timing momentum ───────────────────────────────────────────────────────
  const rawPressure = s.timingPressure ?? 0;
  const timingMomentum = Math.tanh(rawPressure * 1.5);

  // ── Bid/ask imbalance proxy ───────────────────────────────────────────────
  // Derived from: price vs signalEntry + confidence direction
  let bidAskImbalance = 0;
  if (s.signalEntry !== null) {
    const rawImbalance = (spot - s.signalEntry) / (atr * 0.5);
    bidAskImbalance = Math.tanh(rawImbalance);
  } else {
    // Proxy: direction bias × confidence
    bidAskImbalance =
      s.signalDirection === "BUY"  ?  s.signalConfidence * 0.5 :
      s.signalDirection === "SELL" ? -s.signalConfidence * 0.5 : 0;
  }

  // ── Composite flow delta ──────────────────────────────────────────────────
  // Weights: COT(0.30), bidAsk(0.25), timing(0.20), levelDisp(0.15), vol(0.10)
  // Level displacement: if above level = sell pressure, below = buy pressure → negate
  const compositeDelta =
    cotDelta          * 0.30 +
    bidAskImbalance   * 0.25 +
    timingMomentum    * 0.20 +
    (-levelDisplacement) * 0.15 +  // mean reversion signal
    (volatilityRegime - 0.5) * 0.10 * Math.sign(cotDelta || 1);

  return {
    cotDelta,
    levelDisplacement,
    volatilityRegime,
    timingMomentum,
    bidAskImbalance,
    compositeDelta: Math.max(-1, Math.min(1, compositeDelta)),
    nearestLevel,
    nearestLevelLabel,
  };
}
