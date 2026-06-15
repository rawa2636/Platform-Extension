/**
 * Smart Money Radar — ردار المال الذكي
 *
 * Detects WHERE retail (القطيع) stop losses cluster (the "fuel"),
 * identifies the likely sweep direction and depth, and pinpoints the
 * Institutional Equilibrium Zone — the price where smart money will
 * UNLOAD their position after the sweep completes.
 *
 * Architecture:
 *   - Runs BEFORE consensus so all agents receive radar data via snapshot.smRadar
 *   - Trap engine uses herdClusters directly → massively improves accuracy
 *   - TP is no longer a fixed $30–60 — it is the institutional equilibrium price
 *   - ML Memory: blends ATR-estimate with historical sweep depth from DB
 *
 * Quantum-layer algorithm stack:
 *   L1: Price-level geometry (Fib, Pivot, Psych rounds)
 *   L2: Stop cluster density scoring (distance decay × level weight)
 *   L3: Fuel aggregation per side
 *   L4: Sweep direction engine (COT + signal + imbalance)
 *   L5: Institutional equilibrium finder (highest-weight opposite level)
 *   L6: Historical depth blending (ML Memory from DB)
 */

import { randomUUID } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { db, traderSweepLogTable } from "@workspace/db";
import { logger } from "../logger.js";
import {
  buildAllLevels,
  fibonacciRetracements,
  pivotPoints,
  roundNumberLevels,
  estimateAtr,
  type PriceLevel,
} from "./agents/quant-math.js";
import type {
  NormalizedSnapshot,
  SmartMoneyRadar,
  HerdStopCluster,
  InstitutionalEquilibrium,
} from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Entry blocked when sweep probability exceeds this */
const SWEEP_BLOCK_THRESHOLD = 0.68;

/** ATR multiplier bands for sweep depth */
const DEPTH_LOW_MULT  = 0.22;
const DEPTH_HIGH_MULT = 0.60;

/** Cluster scan radius around spot */
const CLUSTER_RADIUS_MULT = 3.5; // × ATR

/** Institutional equilibrium search radius */
const EQUIL_RADIUS_MULT = 4.0; // × ATR

/** Minimum equilibrium distance from spot (avoid trivial targets) */
const EQUIL_MIN_USD = 6.0;

// ── L1: Price-Level Geometry ───────────────────────────────────────────────

function buildGeometry(spot: number, atr: number): PriceLevel[] {
  // Use a wider swing to capture more institutional levels
  const swing = atr * 3.0;
  const high  = spot + swing;
  const low   = spot - swing;
  const close = spot;

  const fibs   = fibonacciRetracements(high, low);
  const pivots = pivotPoints(high, low, close);
  const rounds = roundNumberLevels(spot, 500); // $500 radius

  const all = [...fibs, ...pivots, ...rounds];

  // Deduplicate within $0.50
  const deduped: PriceLevel[] = [];
  for (const lvl of all) {
    const clash = deduped.find((d) => Math.abs(d.price - lvl.price) < 0.50);
    if (clash) {
      if (lvl.weight > clash.weight) {
        clash.price  = lvl.price;
        clash.label  = lvl.label;
        clash.weight = lvl.weight;
      }
    } else {
      deduped.push({ ...lvl });
    }
  }

  return deduped;
}

// ── L2: Stop Cluster Density Scoring ──────────────────────────────────────
//
// Retail traders place stop losses:
//   LONG stops (below supports):  Round numbers, Fib 61.8/78.6/100%, S1/S2
//   SHORT stops (above resistances): Round numbers, Fib 0/23.6/38.2%, R1/R2
//
// Density = levelWeight × distanceDecay × sideMultiplier
//
// sideMultiplier encodes WHERE retail stops concentrate:
//   Supports (Fib_0.618, Fib_0.786, S1, S2, round below) → BELOW stops heavy
//   Resistances (Fib_0.0, Fib_0.236, R1, R2, round above) → ABOVE stops heavy

const STOP_SIDE_WEIGHT: Record<string, { below: number; above: number }> = {
  // Fibonacci — retail loves 61.8 / 78.6 for long stops
  "Fib_0.0":   { below: 0.40, above: 0.90 }, // swing high → SELL stop cluster above
  "Fib_0.236": { below: 0.45, above: 0.80 },
  "Fib_0.382": { below: 0.65, above: 0.70 },
  "Fib_0.500": { below: 0.70, above: 0.70 }, // 50% — symmetric
  "Fib_0.618": { below: 0.90, above: 0.55 }, // golden ratio → BUY stop cluster below
  "Fib_0.786": { below: 0.85, above: 0.45 },
  "Fib_1.0":   { below: 0.90, above: 0.35 }, // swing low → BUY stop cluster below
  // Pivots
  "R1": { below: 0.30, above: 0.88 },
  "R2": { below: 0.25, above: 0.82 },
  "R3": { below: 0.20, above: 0.70 },
  "PP": { below: 0.60, above: 0.60 }, // symmetric pivot
  "S1": { below: 0.88, above: 0.30 },
  "S2": { below: 0.82, above: 0.25 },
  "S3": { below: 0.70, above: 0.20 },
};

function stopSideWeight(label: string, side: "above" | "below"): number {
  const entry = STOP_SIDE_WEIGHT[label];
  if (entry) return entry[side];
  // Psychological round numbers — symmetric but heavy on both sides
  if (label.startsWith("Psych_")) {
    const price = parseFloat(label.replace("Psych_", ""));
    // $100 multiples → very heavy (0.95), $50 → heavy (0.85), $25 → moderate (0.65)
    if (price % 100 === 0) return 0.95;
    if (price % 50  === 0) return 0.85;
    return 0.65;
  }
  return 0.50;
}

function buildHerdClusters(
  spot: number,
  atr: number,
  levels: PriceLevel[],
  side: "above" | "below",
): HerdStopCluster[] {
  const radius = atr * CLUSTER_RADIUS_MULT;

  return levels
    .filter((l) => {
      const aboveSpot = l.price > spot;
      return side === "above" ? aboveSpot : !aboveSpot;
    })
    .filter((l) => Math.abs(l.price - spot) <= radius)
    .map((l) => {
      const distance = Math.abs(l.price - spot);
      // Distance decay: exponential — closer stops are denser
      const distanceDecay = Math.exp(-distance / (atr * 1.2));
      const sideW = stopSideWeight(l.label, side);
      const density = Math.min(l.weight * sideW * (0.5 + 0.5 * distanceDecay), 1.0);
      // Fuel score = how much liquidity this cluster provides to smart money
      // High density + close distance = more fuel
      const fuelScore = Math.min(density * distanceDecay * 1.5, 1.0);
      return {
        price:     Math.round(l.price * 100) / 100,
        label:     l.label,
        density:   Math.round(density * 1000) / 1000,
        distance:  Math.round(distance * 100) / 100,
        side,
        fuelScore: Math.round(fuelScore * 1000) / 1000,
      } satisfies HerdStopCluster;
    })
    .sort((a, b) => b.fuelScore - a.fuelScore); // hottest clusters first
}

// ── L3: Fuel Aggregation ───────────────────────────────────────────────────

function aggregateFuel(clusters: HerdStopCluster[]): number {
  if (clusters.length === 0) return 0;
  // Top-3 clusters dominate (law of concentration)
  const top3 = clusters.slice(0, 3);
  const weights = [0.55, 0.30, 0.15];
  let total = 0;
  for (let i = 0; i < top3.length; i++) {
    total += (top3[i]?.fuelScore ?? 0) * (weights[i] ?? 0.10);
  }
  return Math.min(Math.round(total * 1000) / 1000, 1.0);
}

// ── L4: Sweep Direction Engine ─────────────────────────────────────────────
//
// Smart money needs fuel (retail stops) to execute large positions.
// For a BUY:  smart money first sweeps DOWN (takes out long stops below)
//             then reverses UP — "DOWN_FIRST"
// For a SELL: smart money first sweeps UP (takes out short stops above)
//             then reverses DOWN — "UP_FIRST"
//
// Confidence is modulated by:
//   - COT divergence (smart money opposite to retail = strong sweep signal)
//   - Absorption in order flow (high absorption = accumulation in progress)
//   - Timing state (CONFIRMED sweep = stronger signal)

type SweepDir = "DOWN_FIRST" | "UP_FIRST" | "UNCLEAR";

function resolveSweepDirection(
  snap: NormalizedSnapshot,
  belowFuel: number,
  aboveFuel: number,
): { dir: SweepDir; probability: number } {
  const direction = snap.signalDirection;
  if (direction === "NEUTRAL") return { dir: "UNCLEAR", probability: 0.30 };

  // Primary: fuel asymmetry
  const fuelAsymmetry = Math.abs(belowFuel - aboveFuel);
  let baseProb = 0.35 + fuelAsymmetry * 0.40;

  // COT boost: when COT diverges from signal, smart money is accumulating
  let cotBoost = 0;
  const cotBullishWithSell = (snap.cotTilt === "LONG" || snap.cotTilt === "EXTREME_LONG") && direction === "SELL";
  const cotBearishWithBuy  = (snap.cotTilt === "SHORT" || snap.cotTilt === "EXTREME_SHORT") && direction === "BUY";
  if (cotBullishWithSell || cotBearishWithBuy) {
    cotBoost = snap.cotTilt?.startsWith("EXTREME") ? 0.14 : 0.09;
  }

  // Timing boost
  let timingBoost = 0;
  if (snap.timingState === "CONFIRMED") timingBoost = 0.08;
  else if (snap.timingState === "BUILDING") timingBoost = 0.03;

  // Order flow imbalance
  let imbalanceBoost = 0;
  const raw = snap.rawPayload as Record<string, unknown> | null;
  if (raw && typeof raw === "object") {
    const abs = raw["absorption"] as number | undefined;
    if (typeof abs === "number" && abs > 60) {
      imbalanceBoost = Math.min((abs - 60) / 100, 0.10);
    }
  }

  const finalProb = Math.min(baseProb + cotBoost + timingBoost + imbalanceBoost, 0.94);

  // Direction: BUY signal → sweep DOWN first (take out longs below)
  const dir: SweepDir = direction === "BUY" ? "DOWN_FIRST" : "UP_FIRST";

  return { dir, probability: Math.round(finalProb * 1000) / 1000 };
}

// ── L5: Institutional Equilibrium Finder ──────────────────────────────────
//
// After smart money sweeps retail stops, they run price to a zone where
// they can unload their position to retail buyers (for BUY runs) or sellers.
// This is the Institutional Equilibrium — the highest-weight level in the
// DIRECTION of trade beyond the entry.
//
// For BUY (after DOWN sweep): equilibrium = strongest resistance ABOVE spot
// For SELL (after UP sweep):  equilibrium = strongest support BELOW spot
//
// Prioritizes: R1/S1 pivot > Fib 0.0/1.0 > Round $100/$50 > Fib 0.382/0.618

function findInstitutionalEquilibrium(
  spot: number,
  atr: number,
  levels: PriceLevel[],
  direction: "BUY" | "SELL",
): InstitutionalEquilibrium | null {
  const radius = atr * EQUIL_RADIUS_MULT;

  const candidates = levels
    .filter((l) => {
      const isAbove = l.price > spot;
      // BUY: target is ABOVE (smart money unloads longs there)
      // SELL: target is BELOW (smart money covers shorts there)
      const correctSide = direction === "BUY" ? isAbove : !isAbove;
      const withinRadius = Math.abs(l.price - spot) <= radius;
      const minDist = Math.abs(l.price - spot) >= EQUIL_MIN_USD;
      return correctSide && withinRadius && minDist;
    })
    // Score = weight × proximity bonus
    .map((l) => {
      const dist = Math.abs(l.price - spot);
      // Proximity bonus: levels closer to spot score higher but must clear minimum
      const proximityBonus = Math.max(0, 1 - dist / (atr * 3));
      const score = l.weight * 0.70 + proximityBonus * 0.30;
      return { lvl: l, dist, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) return null;

  return {
    price:            Math.round(best.lvl.price * 100) / 100,
    label:            best.lvl.label,
    direction:        direction === "BUY" ? "above" : "below",
    distanceFromSpot: Math.round(best.dist * 100) / 100,
    confidence:       Math.round(Math.min(best.score, 1.0) * 1000) / 1000,
  };
}

// ── L6: ML Memory ─────────────────────────────────────────────────────────

async function loadHistoricalDepths(n = 30): Promise<number | null> {
  try {
    const rows = await db
      .select({ actualSweepDepth: traderSweepLogTable.actualSweepDepth })
      .from(traderSweepLogTable)
      .where(isNotNull(traderSweepLogTable.actualSweepDepth))
      .orderBy(desc(traderSweepLogTable.createdAt))
      .limit(n);

    const depths = rows
      .map((r) => r.actualSweepDepth)
      .filter((d): d is number => d !== null && d > 0);

    if (depths.length === 0) return null;
    return depths.reduce((a, b) => a + b, 0) / depths.length;
  } catch {
    return null;
  }
}

// ── Main: assessSmartMoneyRadar ────────────────────────────────────────────

export async function assessSmartMoneyRadar(
  snap: NormalizedSnapshot,
  direction: "BUY" | "SELL",
  slDistance: number, // $ distance entry → SL
): Promise<SmartMoneyRadar> {
  const spot = snap.spot;
  const atr  = snap.atrAbs ?? estimateAtr(spot);

  // L1: geometry
  const levels = buildGeometry(spot, atr);

  // L2: herd stop clusters on each side
  const herdBelow = buildHerdClusters(spot, atr, levels, "below");
  const herdAbove = buildHerdClusters(spot, atr, levels, "above");

  // L3: fuel aggregation
  const belowFuel = aggregateFuel(herdBelow);
  const aboveFuel = aggregateFuel(herdAbove);

  // L4: sweep direction + probability
  const sweep = resolveSweepDirection(snap, belowFuel, aboveFuel);

  // Primary sweep target: the densest cluster in the sweep direction
  const sweepSideClusters = sweep.dir === "DOWN_FIRST" ? herdBelow : herdAbove;
  const primarySweepTarget = sweepSideClusters[0] ?? null;

  // Sweep zone (the band that will be swept)
  let sweepZone: SmartMoneyRadar["sweepZone"] = null;
  if (primarySweepTarget) {
    const padding = atr * 0.15;
    const zLow  = Math.round((primarySweepTarget.price - padding) * 100) / 100;
    const zHigh = Math.round((primarySweepTarget.price + padding) * 100) / 100;
    sweepZone = { low: zLow, high: zHigh, label: primarySweepTarget.label };
  }

  // L6: ML Memory — historical sweep depth
  const histAvg = await loadHistoricalDepths();
  const baseDepthLow  = atr * DEPTH_LOW_MULT;
  const baseDepthHigh = atr * DEPTH_HIGH_MULT;

  // Blend 70% current ATR-based + 30% historical (L6)
  const depthLow  = histAvg ? baseDepthLow  * 0.70 + histAvg * 0.30 : baseDepthLow;
  const depthHigh = histAvg ? baseDepthHigh * 0.70 + histAvg * 0.30 : baseDepthHigh;

  // If primary target exists, use its distance as the low estimate (actual measured level)
  const measuredDepthLow  = primarySweepTarget
    ? Math.min(primarySweepTarget.distance, depthLow)
    : depthLow;
  const measuredDepthHigh = primarySweepTarget
    ? Math.max(primarySweepTarget.distance + atr * 0.15, depthHigh)
    : depthHigh;

  const sweepDepthLow  = Math.round(measuredDepthLow  * 100) / 100;
  const sweepDepthHigh = Math.round(measuredDepthHigh * 100) / 100;

  // Recommended entry: post-sweep price (enter AFTER sweep exhausts)
  const sweepMid = (sweepDepthLow + sweepDepthHigh) / 2;
  const recommendedEntry =
    direction === "BUY"
      ? Math.round((spot - sweepMid) * 100) / 100  // swept DOWN, enter below spot
      : Math.round((spot + sweepMid) * 100) / 100; // swept UP,   enter above spot

  // L5: Institutional Equilibrium — real TP target
  const instEquil = findInstitutionalEquilibrium(spot, atr, levels, direction);

  // Entry permission engine
  // Block if sweep probability is too high AND depth threatens SL
  const depthExceedsSL = sweepDepthHigh >= slDistance * 0.85; // 85% threshold (cautious)
  const entryAllowed   = sweep.probability < SWEEP_BLOCK_THRESHOLD && !depthExceedsSL;

  let blockReason: string | null = null;
  if (!entryAllowed) {
    if (sweep.probability >= SWEEP_BLOCK_THRESHOLD && depthExceedsSL) {
      blockReason = `احتمال تصفية القطيع ${(sweep.probability * 100).toFixed(0)}% وعمق السحب يُهدد وقف الخسارة`;
    } else if (sweep.probability >= SWEEP_BLOCK_THRESHOLD) {
      blockReason = `ردار المال الذكي: تجمع وقود قوي — احتمال التصفية ${(sweep.probability * 100).toFixed(0)}%`;
    } else {
      blockReason = `عمق التصفية المتوقع (${sweepDepthHigh.toFixed(1)}$) يتجاوز وقف الخسارة (${slDistance.toFixed(1)}$)`;
    }
  }

  const result: SmartMoneyRadar = {
    herdClustersBelow: herdBelow.slice(0, 6),
    herdClustersAbove: herdAbove.slice(0, 6),
    primarySweepTarget,
    sweepDirection:      sweep.dir,
    sweepProbability:    sweep.probability,
    expectedSweepDepthLow:  sweepDepthLow,
    expectedSweepDepthHigh: sweepDepthHigh,
    fuelScore: sweep.dir === "DOWN_FIRST" ? belowFuel : aboveFuel,
    entryAllowed,
    recommendedEntry,
    blockReason,
    sweepZone,
    institutionalEquilibrium: instEquil,
    historicalAvgDepth: histAvg ? Math.round(histAvg * 100) / 100 : null,
    computedAt: new Date().toISOString(),
  };

  logger.info(
    {
      direction,
      spot,
      sweepDir: sweep.dir,
      sweepProb: sweep.probability,
      fuelScore: result.fuelScore,
      sweepDepth: `${sweepDepthLow}–${sweepDepthHigh}$`,
      primaryTarget: primarySweepTarget?.label ?? "none",
      equilibrium: instEquil ? `${instEquil.label} @ ${instEquil.price}` : "none",
      entryAllowed,
    },
    "trader.smradar.assessed",
  );

  return result;
}

// ── Persistence ────────────────────────────────────────────────────────────

export async function persistSweepLog(
  snap: NormalizedSnapshot,
  direction: "BUY" | "SELL",
  radar: SmartMoneyRadar,
  positionId?: string,
): Promise<string> {
  const id = randomUUID();
  try {
    await db.insert(traderSweepLogTable).values({
      id,
      signalDirection:        direction,
      signalPrice:            snap.spot,
      sweepProbability:       radar.sweepProbability,
      expectedSweepDepthLow:  radar.expectedSweepDepthLow,
      expectedSweepDepthHigh: radar.expectedSweepDepthHigh,
      recommendedEntry:       radar.recommendedEntry,
      nearestPoolPrice:       radar.primarySweepTarget?.price ?? null,
      nearestPoolDistance:    radar.primarySweepTarget?.distance ?? null,
      positionId:             positionId ?? null,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.smradar.persist.error",
    );
  }
  return id;
}

// ── Route handler helper ───────────────────────────────────────────────────
// Called by GET /api/trader/sweep — uses the current snapshot direction

export async function runRadarForRoute(snap: NormalizedSnapshot): Promise<SmartMoneyRadar> {
  const direction: "BUY" | "SELL" =
    snap.signalDirection === "SELL" ? "SELL" : "BUY";
  const slDistance = (snap.atrAbs ?? estimateAtr(snap.spot)) * 0.25;
  return assessSmartMoneyRadar(snap, direction, slDistance);
}
