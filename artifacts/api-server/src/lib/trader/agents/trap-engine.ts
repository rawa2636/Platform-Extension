/**
 * Trap Engine Agent — Mathematical trap detection.
 * Detects:
 *   - Liquidity sweep zones (stop hunts near round numbers)
 *   - False breakout probability from ATR + COT divergence
 *   - Volatility expansion traps (spike entry risk)
 *   - Timing reversal signals (BUILDING state before CONFIRMED)
 *   - COT extreme positioning → mean reversal probability
 * Returns a precise trapScore and the safest entry zone AWAY from traps.
 */
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  estimateAtr,
  roundNumberLevels,
  GOLD_PIP,
} from "./quant-math.js";

export interface TrapSignals {
  trapScore: number;
  liquiditySweepRisk: number;
  falseBreakoutRisk: number;
  volatilityTrapRisk: number;
  cotExtremeRisk: number;
  timingTrapRisk: number;
  trapType: string | null;
  safestEntryZone: EntryZone | null;
}

export async function runTrapEngineAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput & { trapScore: number }> {
  const t0 = Date.now();

  const atr = snapshot.atrAbs ?? estimateAtr(snapshot.spot);
  const spot = snapshot.spot;

  const traps = detectTraps(snapshot, atr, spot);

  // TrapEngine votes FOR the direction when environment is safe (trapScore ≤ maxTrapScore=0.30),
  // NEUTRAL in caution zone, AGAINST when heavily trapped.
  const SAFE_THRESHOLD    = 0.30; // matches consensus maxTrapScore
  const DANGER_THRESHOLD  = 0.50;

  let vote: AgentOutput["vote"] = "NEUTRAL";
  if (traps.trapScore <= SAFE_THRESHOLD) {
    // Safe or mildly cautious: vote WITH the structural signal
    if (snapshot.signalDirection === "BUY")  vote = "BUY";
    else if (snapshot.signalDirection === "SELL") vote = "SELL";
    else vote = "NEUTRAL";
  } else if (traps.trapScore <= DANGER_THRESHOLD) {
    // Moderate trap: stay neutral
    vote = "NEUTRAL";
  } else {
    // Heavy trap: vote opposite (trap fade)
    if (snapshot.signalDirection === "BUY")  vote = "SELL";
    else if (snapshot.signalDirection === "SELL") vote = "BUY";
    else vote = "NEUTRAL";
  }

  // Confidence: high confidence when clearly safe OR clearly trapped
  const polarization = Math.abs(traps.trapScore - 0.25); // distance from ambiguous midpoint
  const confidence = Math.min(0.45 + polarization * 1.8, 0.97);

  // Entry zone: only recommend if environment is clean, use safest level
  let entryZone: EntryZone | null = null;
  if (traps.trapScore <= 0.20 && vote !== "NEUTRAL") {
    const allLevels = buildAllLevels(spot, atr);
    const zones = scanEntryZones(spot, atr, vote as "BUY" | "SELL", allLevels, "trap_engine");
    // Prefer a zone NOT adjacent to a liquidity pool (round number)
    const roundLevels = roundNumberLevels(spot, 200);
    const safe = zones.find((z) =>
      roundLevels.every((r) => Math.abs(r.price - z.stopLoss) > 8 * GOLD_PIP),
    );
    entryZone = safe ?? zones[0] ?? null;
  }

  const reasoning = [
    `Trap score: ${traps.trapScore.toFixed(3)} | Type: ${traps.trapType ?? "none"}`,
    `Liquidity sweep risk: ${traps.liquiditySweepRisk.toFixed(3)} — round numbers within ${(atr * 0.5).toFixed(1)} pts of spot`,
    `False breakout risk: ${traps.falseBreakoutRisk.toFixed(3)} — COT vs signal divergence`,
    `Volatility trap risk: ${traps.volatilityTrapRisk.toFixed(3)} — ATR expansion indicator`,
    `COT extreme risk: ${traps.cotExtremeRisk.toFixed(3)} — positioning extreme = reversal risk`,
    `Timing trap risk: ${traps.timingTrapRisk.toFixed(3)} — BUILDING state = premature entry`,
    `Trap engine verdict: environment is ${traps.trapScore <= 0.20 ? "SAFE" : traps.trapScore <= 0.35 ? "CAUTION" : "TRAPPED"} → vote=${vote}`,
    entryZone
      ? `Safest entry: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit} (${entryZone.slPips}pp/${entryZone.tpPips}pp R:R=${entryZone.riskReward})`
      : "No safe entry identified",
  ].join(". ");

  return {
    agentId: "trap_engine",
    agentName: "Trap Engine",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: [
        "cot_extreme_positioning",
        "round_number_liquidity_map",
        "atr_volatility_regime",
        "timing_state_analysis",
        "signal_divergence_detector",
      ],
      features_used: [
        "spot",
        "atr_abs",
        "atr_pct",
        "cot.speculator_tilt",
        "timing.state",
        "timing.pressure",
        "signal.direction",
        "signal.confidence",
        "round_number_proximity",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning,
    signals: {
      trapScore: traps.trapScore,
      liquiditySweepRisk: traps.liquiditySweepRisk,
      falseBreakoutRisk: traps.falseBreakoutRisk,
      volatilityTrapRisk: traps.volatilityTrapRisk,
      cotExtremeRisk: traps.cotExtremeRisk,
      timingTrapRisk: traps.timingTrapRisk,
      trapType: traps.trapType,
      isSafe: traps.trapScore <= 0.20,
    },
    entryZone,
    trapScore: traps.trapScore,
    latencyMs: Date.now() - t0,
  };
}

function detectTraps(
  s: NormalizedSnapshot,
  atr: number,
  spot: number,
): TrapSignals {
  // ── 1. Liquidity sweep risk ───────────────────────────────────────────────
  // Primary: use SmartMoneyRadar data if injected into snapshot (much more accurate)
  const smr = s.smRadar;
  let liquiditySweepRisk = 0;

  if (smr) {
    // Radar already computed sweep probability from multi-layer algorithms
    // Translate directly: sweepProbability → liquiditySweepRisk
    liquiditySweepRisk = smr.sweepProbability * 0.85 + smr.fuelScore * 0.15;
    liquiditySweepRisk = Math.min(liquiditySweepRisk, 0.95);
  } else {
    // Fallback: round-number proximity heuristic (less accurate)
    const rounds = roundNumberLevels(spot, 200);
    for (const r of rounds.slice(0, 6)) {
      const dist = Math.abs(r.price - spot);
      if (dist < atr * 0.15) liquiditySweepRisk = Math.max(liquiditySweepRisk, 0.65);
      else if (dist < atr * 0.30) liquiditySweepRisk = Math.max(liquiditySweepRisk, 0.40);
      else if (dist < atr * 0.50) liquiditySweepRisk = Math.max(liquiditySweepRisk, 0.20);
    }
  }

  // ── 2. False breakout risk ────────────────────────────────────────────────
  // COT aligned with signal = retail crowded trade = setup for squeeze
  let falseBreakoutRisk = 0;
  const cotAlignedBull =
    (s.cotTilt === "EXTREME_LONG" || s.cotTilt === "LONG") && s.signalDirection === "BUY";
  const cotAlignedBear =
    (s.cotTilt === "EXTREME_SHORT" || s.cotTilt === "SHORT") && s.signalDirection === "SELL";
  if (cotAlignedBull || cotAlignedBear) {
    falseBreakoutRisk = s.cotTilt?.startsWith("EXTREME") ? 0.55 : 0.30;
  }
  // COT divergence = safer (smart money is with the signal)
  const cotDivergeBull =
    (s.cotTilt === "EXTREME_SHORT" || s.cotTilt === "SHORT") && s.signalDirection === "BUY";
  const cotDivergeBear =
    (s.cotTilt === "EXTREME_LONG" || s.cotTilt === "LONG") && s.signalDirection === "SELL";
  if (cotDivergeBull || cotDivergeBear) falseBreakoutRisk = Math.max(0, falseBreakoutRisk - 0.15);

  // ── 3. Volatility trap risk ───────────────────────────────────────────────
  // High ATR = price spike = trap. Very low ATR = compression = potential breakout trap.
  let volatilityTrapRisk = 0;
  if (s.atrPct !== null) {
    if (s.atrPct > 0.012) volatilityTrapRisk = 0.55; // extreme expansion = spike trap
    else if (s.atrPct > 0.009) volatilityTrapRisk = 0.35;
    else if (s.atrPct < 0.002) volatilityTrapRisk = 0.25; // extreme compression = breakout trap
  }

  // ── 4. COT extreme positioning risk ──────────────────────────────────────
  // Extreme COT = crowd positioned one way = mean reversion likely
  let cotExtremeRisk = 0;
  if (s.cotTilt === "EXTREME_LONG") cotExtremeRisk = 0.45;
  else if (s.cotTilt === "EXTREME_SHORT") cotExtremeRisk = 0.45;

  // ── 5. Timing trap risk ───────────────────────────────────────────────────
  // BUILDING = signal forming, entering early = trap
  let timingTrapRisk = 0;
  if (s.timingState === "BUILDING") timingTrapRisk = 0.35;
  // Very high pressure without confirmation = momentum exhaustion trap
  if (s.timingPressure !== null && Math.abs(s.timingPressure) > 0.85 && s.timingState !== "CONFIRMED") {
    timingTrapRisk = Math.max(timingTrapRisk, 0.40);
  }

  // ── 6. High news risk ────────────────────────────────────────────────────
  if (s.newsHighImpactCount >= 4) {
    falseBreakoutRisk = Math.max(falseBreakoutRisk, 0.40);
  }

  // ── Composite trap score ──────────────────────────────────────────────────
  const trapScore = Math.min(
    liquiditySweepRisk * 0.28 +
    falseBreakoutRisk  * 0.28 +
    volatilityTrapRisk * 0.18 +
    cotExtremeRisk     * 0.14 +
    timingTrapRisk     * 0.12,
    1.0,
  );

  // ── Dominant trap type ────────────────────────────────────────────────────
  let trapType: string | null = null;
  const components = [
    { label: "LIQUIDITY_SWEEP",  score: liquiditySweepRisk },
    { label: "FALSE_BREAKOUT",   score: falseBreakoutRisk },
    { label: "VOLATILITY_SPIKE", score: volatilityTrapRisk },
    { label: "COT_EXTREME",      score: cotExtremeRisk },
    { label: "TIMING_PREMATURE", score: timingTrapRisk },
  ];
  const dominant = components.reduce((a, b) => (b.score > a.score ? b : a));
  if (dominant.score > 0.20) trapType = dominant.label;

  return {
    trapScore: Math.round(trapScore * 1000) / 1000,
    liquiditySweepRisk: Math.round(liquiditySweepRisk * 1000) / 1000,
    falseBreakoutRisk:  Math.round(falseBreakoutRisk  * 1000) / 1000,
    volatilityTrapRisk: Math.round(volatilityTrapRisk * 1000) / 1000,
    cotExtremeRisk:     Math.round(cotExtremeRisk     * 1000) / 1000,
    timingTrapRisk:     Math.round(timingTrapRisk     * 1000) / 1000,
    trapType,
    safestEntryZone: null, // filled in caller
  };
}
