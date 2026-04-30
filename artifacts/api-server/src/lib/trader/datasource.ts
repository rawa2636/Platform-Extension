import { randomUUID } from "node:crypto";
import { db, traderSnapshotsTable } from "@workspace/db";
import { logger } from "../logger.js";
import {
  SOURCE_BASE_URL,
  type NormalizedSnapshot,
  type SignalDirection,
} from "./types.js";

const FETCH_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`source ${url} -> HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function asNumber(v: unknown, fallback: number | null = null): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function asString(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" ? v : fallback;
}

export interface FetchSnapshotResult {
  snapshot: NormalizedSnapshot;
  snapshotId: string;
}

export async function fetchAndPersistSnapshot(): Promise<FetchSnapshotResult> {
  const url = `${SOURCE_BASE_URL.replace(/\/$/, "")}/intelligence`;
  const raw = (await fetchWithTimeout(url, FETCH_TIMEOUT_MS)) as Record<
    string,
    unknown
  >;

  const market = (raw.market as Record<string, unknown> | undefined) ?? {};
  const signal = (raw.signal as Record<string, unknown> | undefined) ?? {};
  const timing = (raw.timing as Record<string, unknown> | undefined) ?? {};
  const macro = (raw.macro as Record<string, unknown> | undefined) ?? {};
  const cot = (raw.cot as Record<string, unknown> | undefined) ?? {};
  const newsArr = Array.isArray(raw.news) ? (raw.news as unknown[]) : [];

  const spot = asNumber(market.xauusd) ?? asNumber(signal.price);
  if (spot === null) {
    throw new Error("source returned no usable spot price");
  }

  const atrPct = asNumber(market.atr_pct);
  const atrAbs = atrPct !== null ? spot * atrPct : null;

  const dirRaw = asString(signal.direction, "NEUTRAL")?.toUpperCase() ?? "NEUTRAL";
  const direction: SignalDirection =
    dirRaw === "BUY" || dirRaw === "SELL" ? dirRaw : "NEUTRAL";

  const tps = Array.isArray(signal.take_profit)
    ? (signal.take_profit as unknown[])
        .map((x) => asNumber(x))
        .filter((x): x is number => x !== null)
    : [];

  const drivers = Array.isArray(signal.drivers)
    ? (signal.drivers as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  const newsHighImpact = newsArr.filter((n) => {
    if (typeof n !== "object" || n === null) return false;
    const rec = n as Record<string, unknown>;
    return rec.impact === "high";
  }).length;

  const macroSummary: Record<string, unknown> = {
    yield_10y: macro.yield_10y ?? null,
    vix: macro.vix ?? null,
    dxy: macro.dxy_yahoo ?? null,
    gold_ohlc: macro.gold_ohlc ?? null,
  };

  const snapshot: NormalizedSnapshot = {
    fetchedAt: new Date().toISOString(),
    sourceStatus: asString(market.status, "unknown") ?? "unknown",
    symbol: "XAUUSD",
    spot,
    atrPct,
    atrAbs,
    signalDirection: direction,
    signalConfidence: asNumber(signal.confidence, 0) ?? 0,
    signalScore: asNumber(signal.score, 0) ?? 0,
    signalEntry: asNumber(signal.entry),
    signalStopLoss: asNumber(signal.stop_loss),
    signalTakeProfits: tps,
    signalRiskReward: asNumber(signal.risk_reward),
    timingState: asString(timing.state),
    timingPressure: asNumber(timing.pressure),
    macroSummary,
    cotTilt: asString(cot.speculator_tilt),
    newsHighImpactCount: newsHighImpact,
    drivers,
    rawPayload: raw,
  };

  const id = randomUUID();
  await db.insert(traderSnapshotsTable).values({
    id,
    fetchedAt: new Date(snapshot.fetchedAt),
    sourceStatus: snapshot.sourceStatus,
    spot: snapshot.spot,
    payload: snapshot as unknown as Record<string, unknown>,
  });

  logger.info(
    {
      spot: snapshot.spot,
      direction,
      confidence: snapshot.signalConfidence,
    },
    "trader.snapshot.fetched",
  );

  return { snapshot, snapshotId: id };
}

export async function getCurrentSpotPrice(): Promise<number> {
  const url = `${SOURCE_BASE_URL.replace(/\/$/, "")}/intelligence`;
  const raw = (await fetchWithTimeout(url, FETCH_TIMEOUT_MS)) as Record<
    string,
    unknown
  >;
  const market = (raw.market as Record<string, unknown> | undefined) ?? {};
  const spot = asNumber(market.xauusd);
  if (spot === null) throw new Error("source returned no spot price");
  return spot;
}
