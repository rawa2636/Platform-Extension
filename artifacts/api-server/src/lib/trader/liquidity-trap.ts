/**
 * Liquidity Trap Detector v2
 *
 * Computes, before any BUY/SELL is committed:
 *   - sweepProbability    0–1  (احتمال سحب السيولة)
 *   - expectedSweepDepth  {low, high} in USD
 *   - trapZone            {active, low, high}
 *   - entryAllowed        bool  (false when sweep > 70% or depth > SL distance)
 *   - recommendedEntry    adjusted entry price after expected sweep
 *   - nearestLiquidityPool { price, distance, pullStrength }
 *   - historicalAvgDepth  from sweep_log (ML Memory)
 *
 * Design constraint: purely additive, no existing file modified beyond
 * executor.ts (which calls this AFTER consensus and BEFORE the signal insert).
 */

import { randomUUID } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { db, traderSweepLogTable } from "@workspace/db";
import { logger } from "../logger.js";
import {
  fibonacciRetracements,
  pivotPoints,
  roundNumberLevels,
  type PriceLevel,
} from "./agents/quant-math.js";
import type { NormalizedSnapshot } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────

const SWEEP_HIGH_THRESHOLD = 0.70; // entry_allowed = false above this

// ATR fraction bands for sweep depth estimation
const DEPTH_LOW_ATR_FRAC  = 0.25;
const DEPTH_HIGH_ATR_FRAC = 0.65;

// Trap zone: price within this many $ of a key level
const TRAP_PROXIMITY_USD = 3.0;

// Pull strength weights per level type
const PULL_WEIGHT: Record<string, number> = {
  Fib_0:     0.55,
  Fib_0236:  0.65,
  Fib_0382:  0.90,
  Fib_050:   0.80,
  Fib_0618:  0.95,
  Fib_0786:  0.75,
  Fib_10:    0.55,
  PP:        0.92,
  R1: 0.88, R2: 0.82, R3: 0.70,
  S1: 0.88, S2: 0.82, S3: 0.70,
};

function pullWeight(label: string): number {
  // Normalise label key
  const key = label.replace(/[^a-zA-Z0-9]/g, "");
  for (const [k, v] of Object.entries(PULL_WEIGHT)) {
    if (key.includes(k)) return v;
  }
  // Psych levels
  if (label.startsWith("Psych_")) return 0.75;
  return 0.50;
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface LiquidityPool {
  price: number;
  distance: number;      // $ from spot
  pullStrength: number;  // 0–1
  label: string;
  side: "above" | "below";
}

export interface TrapZone {
  active: boolean;
  low: number | null;
  high: number | null;
  nearestLevel: string | null;
}

export interface SweepAssessment {
  sweepProbability: number;       // 0–1
  expectedSweepDepthLow: number;  // $
  expectedSweepDepthHigh: number; // $
  trapZone: TrapZone;
  entryAllowed: boolean;
  recommendedEntry: number;
  nearestPool: LiquidityPool | null;
  allPools: LiquidityPool[];
  historicalAvgDepth: number | null;
  blockReason: string | null;
  computedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildLevels(snap: NormalizedSnapshot): PriceLevel[] {
  const spot = snap.spot;
  const atr  = snap.atrAbs ?? 12;

  // Approximate session H/L/C from spot ± ATR
  const high  = spot + atr * 0.6;
  const low   = spot - atr * 0.6;
  const close = spot;

  return [
    ...fibonacciRetracements(high, low),
    ...pivotPoints(high, low, close),
    ...roundNumberLevels(spot, 200),
  ];
}

function buildPools(spot: number, levels: PriceLevel[]): LiquidityPool[] {
  return levels
    .filter((l) => Math.abs(l.price - spot) < 30) // within $30
    .map((l) => ({
      price: l.price,
      distance: Math.abs(l.price - spot),
      pullStrength: pullWeight(l.label) * l.weight,
      label: l.label,
      side: l.price > spot ? "above" : "below",
    } satisfies LiquidityPool))
    .sort((a, b) => a.distance - b.distance);
}

/** Load the last N resolved sweep records for ML Memory */
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

// ── Core computation ──────────────────────────────────────────────────────

export async function assessLiquidityTrap(
  snap: NormalizedSnapshot,
  direction: "BUY" | "SELL",
  stopLossDistance: number,        // $ distance from entry to SL
): Promise<SweepAssessment> {
  const spot = snap.spot;
  const atr  = snap.atrAbs ?? 12;

  // 1. Build price levels + pools
  const levels = buildLevels(snap);
  const pools  = buildPools(spot, levels);

  // 2. Nearest pool in the sweep direction
  //    BUY: sweeps happen DOWN (nearest pool below)
  //    SELL: sweeps happen UP (nearest pool above)
  const sweepSide: "below" | "above" = direction === "BUY" ? "below" : "above";
  const directionalPools = pools.filter((p) => p.side === sweepSide);
  const nearestPool = directionalPools[0] ?? pools[0] ?? null;

  // 3. Expected sweep depth (ATR-based, adjusted by ML Memory)
  const histAvg = await loadHistoricalDepths();
  const baseDepthLow  = atr * DEPTH_LOW_ATR_FRAC;
  const baseDepthHigh = atr * DEPTH_HIGH_ATR_FRAC;

  // Blend with historical if available (weight 30% hist, 70% current)
  const depthLow  = histAvg ? baseDepthLow  * 0.70 + histAvg * 0.30 : baseDepthLow;
  const depthHigh = histAvg ? baseDepthHigh * 0.70 + histAvg * 0.30 : baseDepthHigh;

  // Round to $0.50 steps for clean display
  const sweepDepthLow  = Math.round(depthLow  * 2) / 2;
  const sweepDepthHigh = Math.round(depthHigh * 2) / 2;

  // 4. Sweep Probability
  //    Component A: proximity to nearest pool (closer → higher probability)
  const proxFrac = nearestPool
    ? Math.max(0, 1 - nearestPool.distance / (atr * 1.5))
    : 0;

  //    Component B: pull strength of nearest pool
  const pullFrac = nearestPool ? nearestPool.pullStrength : 0;

  //    Component C: order book imbalance (if OrderFlow available)
  //    High absorption (> 60%) near current price = likely sweep ahead
  const orderFlowSnap = snap.rawPayload as Record<string, unknown> | null;
  let imbalanceFrac = 0;
  if (orderFlowSnap && typeof orderFlowSnap === "object") {
    const absorption = orderFlowSnap["absorption"] as number | undefined;
    if (typeof absorption === "number") {
      imbalanceFrac = Math.min(absorption / 100, 1) * 0.4;
    }
  }

  //    Weighted probability
  const sweepProb = Math.min(
    0.95,
    proxFrac * 0.45 + pullFrac * 0.35 + imbalanceFrac * 0.20,
  );

  // 5. Trap zone detection
  //    Price is "inside" a trap if it's within TRAP_PROXIMITY_USD of a high-weight level
  const nearHighWeightLevel = levels.find(
    (l) => l.weight >= 0.80 && Math.abs(l.price - spot) <= TRAP_PROXIMITY_USD,
  );

  const trapZone: TrapZone = nearHighWeightLevel
    ? {
        active: true,
        low:  Math.round((nearHighWeightLevel.price - TRAP_PROXIMITY_USD) * 100) / 100,
        high: Math.round((nearHighWeightLevel.price + TRAP_PROXIMITY_USD) * 100) / 100,
        nearestLevel: nearHighWeightLevel.label,
      }
    : { active: false, low: null, high: null, nearestLevel: null };

  // 6. Entry permission
  const depthExceedsSL = sweepDepthHigh >= stopLossDistance;
  const entryAllowed   = sweepProb <= SWEEP_HIGH_THRESHOLD && !depthExceedsSL;

  let blockReason: string | null = null;
  if (!entryAllowed) {
    if (sweepProb > SWEEP_HIGH_THRESHOLD && depthExceedsSL) {
      blockReason = `احتمال السحب ${(sweepProb * 100).toFixed(0)}% وعمق التصفية يتجاوز وقف الخسارة`;
    } else if (sweepProb > SWEEP_HIGH_THRESHOLD) {
      blockReason = `احتمال سحب السيولة مرتفع: ${(sweepProb * 100).toFixed(0)}%`;
    } else {
      blockReason = `عمق التصفية المتوقع (${sweepDepthHigh.toFixed(1)}$) يتجاوز وقف الخسارة (${stopLossDistance.toFixed(1)}$)`;
    }
  }

  // 7. Recommended entry (dynamic entry after sweep)
  //    BUY:  wait for price to sweep DOWN by expected depth mid-point, then enter
  //    SELL: wait for price to sweep UP
  const sweepMid = (sweepDepthLow + sweepDepthHigh) / 2;
  const recommendedEntry =
    direction === "BUY"
      ? Math.round((spot - sweepMid) * 100) / 100
      : Math.round((spot + sweepMid) * 100) / 100;

  const result: SweepAssessment = {
    sweepProbability: Math.round(sweepProb * 1000) / 1000,
    expectedSweepDepthLow:  sweepDepthLow,
    expectedSweepDepthHigh: sweepDepthHigh,
    trapZone,
    entryAllowed,
    recommendedEntry,
    nearestPool,
    allPools: pools.slice(0, 8),
    historicalAvgDepth: histAvg ? Math.round(histAvg * 100) / 100 : null,
    blockReason,
    computedAt: new Date().toISOString(),
  };

  logger.info(
    {
      direction,
      spot,
      sweepProb: result.sweepProbability,
      depthRange: `${sweepDepthLow}–${sweepDepthHigh}`,
      trapActive: trapZone.active,
      entryAllowed,
    },
    "trader.sweep.assessed",
  );

  return result;
}

// ── Persistence ───────────────────────────────────────────────────────────

export async function persistSweepLog(
  snap: NormalizedSnapshot,
  direction: "BUY" | "SELL",
  assessment: SweepAssessment,
  positionId?: string,
): Promise<string> {
  const id = randomUUID();
  try {
    await db.insert(traderSweepLogTable).values({
      id,
      signalDirection: direction,
      signalPrice: snap.spot,
      sweepProbability: assessment.sweepProbability,
      expectedSweepDepthLow: assessment.expectedSweepDepthLow,
      expectedSweepDepthHigh: assessment.expectedSweepDepthHigh,
      recommendedEntry: assessment.recommendedEntry,
      nearestPoolPrice: assessment.nearestPool?.price ?? null,
      nearestPoolDistance: assessment.nearestPool?.distance ?? null,
      positionId: positionId ?? null,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.sweep.persist.error",
    );
  }
  return id;
}
