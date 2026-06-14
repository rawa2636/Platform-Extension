import { randomUUID } from "node:crypto";
import { db, traderSnapshotsTable } from "@workspace/db";
import { logger } from "../logger.js";
import {
  type NormalizedSnapshot,
  type SignalDirection,
} from "./types.js";
import { getGoldState } from "./gold-platform.js";

const GOLD_BASE = process.env.GOLD_PLATFORM_URL ?? "https://gold-platform--mohamadrawa.replit.app/api";
const FETCH_TIMEOUT_MS = 12_000;

export interface FetchSnapshotResult {
  snapshot: NormalizedSnapshot;
  snapshotId: string;
}

function asNumber(v: unknown, fallback: number | null = null): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function asString(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" ? v : fallback;
}

async function fetchJson<T>(path: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GOLD_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── ATR from 1-minute candles ────────────────────────────────────────────────
async function fetchAtr(spot: number): Promise<{ atrAbs: number | null; atrPct: number | null }> {
  type Candle = { open: number; high: number; low: number; close: number };
  const candles = await fetchJson<Candle[]>("/gold/candles?timeframe=1m&limit=20");
  if (!Array.isArray(candles) || candles.length < 2) return { atrAbs: null, atrPct: null };
  const trs = candles.map((c, i) => {
    const prevClose = i === 0 ? c.open : (candles[i - 1]?.close ?? c.open);
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const atrAbs = trs.reduce((a, b) => a + b, 0) / trs.length;
  return { atrAbs, atrPct: atrAbs / spot };
}

type ContextData = {
  dxy?: { value?: number };
  us10yYield?: { value?: number };
  session?: string;
};

type InstitutionalData = {
  overallConfidence?: number;
  marketPhase?: string;
  largeAbsorptionDetected?: boolean;
  hiddenAccumulation?: boolean;
  hiddenDistribution?: boolean;
  repeatedDefenseZone?: number;
  events?: Array<{ eventType?: string; description?: string; priceLevel?: number; confidence?: number }>;
};

// ── Main snapshot ─────────────────────────────────────────────────────────────
export async function fetchAndPersistSnapshot(): Promise<FetchSnapshotResult> {
  // Real-time data from in-memory gold platform state (10Hz SSE + 2s pollers)
  const goldState = getGoldState();
  const { latestTick, summary, orderFlow } = goldState;

  const spot = latestTick?.mid ?? latestTick?.bid ?? null;
  if (spot === null) {
    throw new Error("gold platform has no tick data yet — ensure the stream is connected");
  }

  // Fetch slower-moving data in parallel
  const [atr, ctx, inst] = await Promise.all([
    fetchAtr(spot),
    fetchJson<ContextData>("/gold/context"),
    fetchJson<InstitutionalData>("/gold/institutional"),
  ]);

  // ── Direction ─────────────────────────────────────────────────────────────
  const dominantFlow = (summary?.dominantFlow ?? "neutral").toLowerCase();
  let direction: SignalDirection = "NEUTRAL";
  if (dominantFlow === "buyers" || dominantFlow === "buy") direction = "BUY";
  else if (dominantFlow === "sellers" || dominantFlow === "sell") direction = "SELL";

  // Confirm with cumulative delta when neutral
  if (direction === "NEUTRAL" && orderFlow) {
    if (orderFlow.cumulativeDelta > 80) direction = "BUY";
    else if (orderFlow.cumulativeDelta < -80) direction = "SELL";
  }

  // ── Confidence ───────────────────────────────────────────────────────────
  const instScore  = asNumber(summary?.institutionalScore, 0.5) ?? 0.5;
  const instOverall = asNumber(inst?.overallConfidence, 0.5) ?? 0.5;
  const confidence = Math.min(instScore * 0.6 + instOverall * 0.4, 1.0);

  // ── Drivers ───────────────────────────────────────────────────────────────
  const drivers: string[] = [];
  if (inst?.largeAbsorptionDetected) drivers.push("large_absorption_detected");
  if (inst?.hiddenAccumulation) drivers.push("hidden_accumulation");
  if (inst?.hiddenDistribution) drivers.push("hidden_distribution");
  if (inst?.marketPhase) drivers.push(`market_phase:${inst.marketPhase}`);
  if (inst?.repeatedDefenseZone) drivers.push(`defense_zone:${inst.repeatedDefenseZone}`);
  (inst?.events ?? []).slice(0, 3).forEach((e) => {
    if (e.eventType) drivers.push(e.eventType);
  });
  if (summary?.liquidityState) drivers.push(`liquidity:${summary.liquidityState}`);

  // ── Macro ─────────────────────────────────────────────────────────────────
  const macroSummary: Record<string, unknown> = {
    dxy: asNumber(ctx?.dxy?.value),
    yield_10y: asNumber(ctx?.us10yYield?.value),
    vix: null,
    session: asString(ctx?.session ?? summary?.session, "unknown"),
  };

  const timingState = asString(ctx?.session ?? summary?.session, "unknown");
  const timingPressure = asNumber(orderFlow?.absorption);

  const snapshot: NormalizedSnapshot = {
    fetchedAt: new Date().toISOString(),
    sourceStatus: "LIVE",
    symbol: "XAUUSD",
    spot,
    atrPct: atr.atrPct,
    atrAbs: atr.atrAbs,
    signalDirection: direction,
    signalConfidence: confidence,
    signalScore: confidence,
    signalEntry: null,       // computed by executor via quant-math
    signalStopLoss: null,
    signalTakeProfits: [],
    signalRiskReward: null,
    timingState,
    timingPressure,
    macroSummary,
    cotTilt: null,
    newsHighImpactCount: 0,
    drivers,
    rawPayload: { tick: latestTick, summary, orderFlow, context: ctx, institutional: inst },
  };

  const id = randomUUID();
  await db.insert(traderSnapshotsTable).values({
    id,
    fetchedAt: new Date(snapshot.fetchedAt),
    sourceStatus: snapshot.sourceStatus,
    spot: snapshot.spot,
    payload: snapshot as unknown as Record<string, unknown>,
  });

  logger.info({ spot, direction, confidence: confidence.toFixed(3) }, "trader.snapshot.fetched");
  return { snapshot, snapshotId: id };
}

// Used by executor to price open positions without a full snapshot cycle
export async function getCurrentSpotPrice(): Promise<number> {
  const { latestTick } = getGoldState();
  const mid = latestTick?.mid ?? latestTick?.bid ?? null;
  if (mid !== null) return mid;

  // Fallback: direct REST if stream hasn't warmed up yet
  const data = await fetchJson<{ mid?: number; bid?: number }>("/gold/price");
  const spot = asNumber(data?.mid ?? data?.bid);
  if (spot === null) throw new Error("gold platform returned no spot price");
  return spot;
}
