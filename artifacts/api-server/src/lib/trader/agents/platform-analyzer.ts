/**
 * Platform Analyzer Agent — Full quantitative analysis.
 * Does NOT simply echo the source signal. Computes:
 *   - Fibonacci retracements from ATR-estimated swing range
 *   - Standard floor-trader pivot points
 *   - Psychological round-number levels
 *   - Structural trend bias from all available dimensions
 *   - Best entry zone with SL ≤ 30 pips / TP 300-500 pips
 */
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  structuralTrendBias,
  estimateAtr,
  fibonacciRetracements,
  pivotPoints,
  roundNumberLevels,
} from "./quant-math.js";

export async function runPlatformAnalyzerAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const atr = snapshot.atrAbs ?? estimateAtr(snapshot.spot);
  const spot = snapshot.spot;

  // ── 1. Structural trend bias ──────────────────────────────────────────────
  const trend = structuralTrendBias(
    snapshot.signalDirection,
    snapshot.signalConfidence,
    snapshot.signalScore,
    snapshot.cotTilt,
    snapshot.timingState,
    snapshot.timingPressure,
  );

  // ── 2. Compute all key levels ─────────────────────────────────────────────
  const allLevels = buildAllLevels(spot, atr);

  // ── 3. Fibonacci confluence analysis ─────────────────────────────────────
  const swing = atr * 2.5;
  const fibHigh = spot + swing;
  const fibLow  = spot - swing;
  const fibs = fibonacciRetracements(fibHigh, fibLow);

  // Find nearest Fib level to spot
  const nearestFib = fibs.reduce((best, lvl) =>
    Math.abs(lvl.price - spot) < Math.abs(best.price - spot) ? lvl : best,
  );
  const fibProximityPct = Math.abs(nearestFib.price - spot) / atr;
  const nearFibLevel = fibProximityPct < 0.3;

  // ── 4. Pivot point confluence ─────────────────────────────────────────────
  const pivots = pivotPoints(fibHigh, fibLow, spot);
  const ppLevel = pivots.find((p) => p.label === "PP")!;
  const priceVsPP = (spot - ppLevel.price) / atr; // normalized
  const abovePP = priceVsPP > 0;

  // ── 5. Round number proximity ─────────────────────────────────────────────
  const rounds = roundNumberLevels(spot, 100);
  const nearestRound = rounds[0];
  const nearRound = nearestRound ? Math.abs(nearestRound.price - spot) <= 15 : false;

  // ── 6. Determine vote and confidence ─────────────────────────────────────
  // Base vote from structural trend
  const vote: AgentOutput["vote"] =
    trend.direction === "NEUTRAL" ? "NEUTRAL" : trend.direction;

  // Confidence: trend strength × (Fib confluence bonus) × (Round number bonus)
  let confidence = 0.42 + trend.strength * 0.38;
  if (nearFibLevel) confidence = Math.min(confidence + 0.12, 0.97);
  if (nearRound)    confidence = Math.min(confidence + 0.08, 0.97);
  if (snapshot.timingState === "CONFIRMED") confidence = Math.min(confidence + 0.05, 0.97);
  if (snapshot.timingState === "BUILDING")  confidence = Math.max(confidence - 0.06, 0.20);
  if (snapshot.newsHighImpactCount >= 4)    confidence = Math.max(confidence - 0.08, 0.20);

  confidence = Math.round(confidence * 1000) / 1000;

  // ── 7. Entry zone hunting ─────────────────────────────────────────────────
  let entryZone: EntryZone | null = null;
  const biasDire = vote === "NEUTRAL" ? null : vote;
  if (biasDire) {
    const zones = scanEntryZones(spot, atr, biasDire, allLevels, "platform_analyzer");
    entryZone = zones[0] ?? null;
  }

  // ── 8. Reasoning ─────────────────────────────────────────────────────────
  const reasoning = [
    `Structural bias: ${trend.direction} (strength=${trend.strength.toFixed(2)})`,
    `Swing range: ${fibLow.toFixed(2)}–${fibHigh.toFixed(2)} | ATR=${atr.toFixed(2)}`,
    `Nearest Fib: ${nearestFib.label} @ ${nearestFib.price} (${fibProximityPct.toFixed(2)} ATR away)${nearFibLevel ? " — CONFLUENCE" : ""}`,
    `Pivot PP=${ppLevel.price.toFixed(2)}, price is ${abovePP ? "ABOVE" : "BELOW"} PP (${priceVsPP.toFixed(2)} ATR)`,
    nearestRound ? `Nearest round: ${nearestRound.price}${nearRound ? " — CONFLUENCE" : ""}` : "",
    entryZone
      ? `Entry zone: ${entryZone.direction} @ ${entryZone.entry} | SL=${entryZone.stopLoss} (${entryZone.slPips}pp) | TP=${entryZone.takeProfit} (${entryZone.tpPips}pp) | R:R=${entryZone.riskReward} | Level=${entryZone.levelType}`
      : "No valid entry zone found with SL ≤ 30 pips",
    `Agent vote: ${vote} | confidence=${confidence}`,
  ].filter(Boolean).join(". ");

  return {
    agentId: "platform_analyzer",
    agentName: "Platform Analyzer",
    vote,
    confidence,
    evidence: {
      sources: [
        "fibonacci_levels",
        "pivot_points",
        "round_numbers",
        "structural_trend_bias",
        "source_platform_intelligence",
      ],
      features_used: [
        "spot",
        "atr_abs",
        "signal.direction",
        "signal.confidence",
        "signal.score",
        "cot.tilt",
        "timing.state",
        "timing.pressure",
        "fibonacci_retracements",
        "floor_pivot_points",
        "psychological_levels",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning,
    signals: {
      trendDirection: trend.direction,
      trendStrength: trend.strength,
      nearestFibLevel: nearestFib.label,
      nearestFibPrice: nearestFib.price,
      nearFibConfluence: nearFibLevel,
      pivotPP: ppLevel.price,
      priceVsPP,
      nearestRound: nearestRound?.price ?? null,
      nearRoundConfluence: nearRound,
      atr,
      swing,
    },
    entryZone,
    latencyMs: Date.now() - t0,
  };
}
