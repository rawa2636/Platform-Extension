/**
 * Quantitative math primitives for XAU/USD institutional analysis.
 * Convention: 1 pip = $1.00 for XAU/USD (institutional large-move convention).
 * SL target ≤ 30 pips ($30), TP target 300–500 pips ($300–$500).
 */

export const GOLD_PIP = 1.0;
export const MAX_SL_PIPS = 30;
export const MIN_TP_PIPS = 300;
export const MAX_TP_PIPS = 500;
export const SL_LEVEL_BUFFER = 5; // pips of buffer inside the key level for SL placement

export interface PriceLevel {
  price: number;
  label: string;
  weight: number; // 0–1 importance
}

export interface EntryZone {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  slPips: number;
  tpPips: number;
  riskReward: number;
  levelType: string;
  confidence: number;
  source: string;
}

/** Fibonacci retracement levels from high to low (bullish = high is recent high). */
export function fibonacciRetracements(high: number, low: number): PriceLevel[] {
  const range = high - low;
  const ratios: Array<{ r: number; label: string; w: number }> = [
    { r: 0.0,   label: "Fib_0.0",   w: 0.55 },
    { r: 0.236, label: "Fib_0.236", w: 0.65 },
    { r: 0.382, label: "Fib_0.382", w: 0.90 },
    { r: 0.500, label: "Fib_0.500", w: 0.80 },
    { r: 0.618, label: "Fib_0.618", w: 0.95 },
    { r: 0.786, label: "Fib_0.786", w: 0.75 },
    { r: 1.000, label: "Fib_1.0",   w: 0.55 },
  ];
  return ratios.map(({ r, label, w }) => ({
    price: Math.round((high - range * r) * 100) / 100,
    label,
    weight: w,
  }));
}

/** Standard floor trader pivot points using proxy H/L/C. */
export function pivotPoints(high: number, low: number, close: number): PriceLevel[] {
  const PP = (high + low + close) / 3;
  const range = high - low;
  const r = (p: number) => Math.round(p * 100) / 100;
  return [
    { price: r(high + 2 * (PP - low)), label: "R3", weight: 0.70 },
    { price: r(PP + range),            label: "R2", weight: 0.82 },
    { price: r(2 * PP - low),          label: "R1", weight: 0.88 },
    { price: r(PP),                    label: "PP", weight: 0.92 },
    { price: r(2 * PP - high),         label: "S1", weight: 0.88 },
    { price: r(PP - range),            label: "S2", weight: 0.82 },
    { price: r(low - 2 * (high - PP)), label: "S3", weight: 0.70 },
  ];
}

/** Psychological round-number levels for gold (multiples of 25, 50, 100). */
export function roundNumberLevels(price: number, radiusPips = 400): PriceLevel[] {
  const radius = radiusPips * GOLD_PIP;
  const seen = new Set<number>();
  const levels: PriceLevel[] = [];

  const addLevel = (p: number, w: number) => {
    const pRound = Math.round(p * 100) / 100;
    if (Math.abs(pRound - price) <= radius && !seen.has(pRound)) {
      seen.add(pRound);
      levels.push({ price: pRound, label: `Psych_${pRound}`, weight: w });
    }
  };

  const b100 = Math.round(price / 100) * 100;
  for (let i = -6; i <= 6; i++) addLevel(b100 + i * 100, 0.95);

  const b50 = Math.round(price / 50) * 50;
  for (let i = -12; i <= 12; i++) addLevel(b50 + i * 50, 0.85);

  const b25 = Math.round(price / 25) * 25;
  for (let i = -24; i <= 24; i++) addLevel(b25 + i * 25, 0.65);

  return levels.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
}

/**
 * Scan key levels for valid entry zones:
 *   SL ≤ 30 pips, TP = 300–500 pips, minimum R:R ≥ 10.
 * For BUY: support levels at or below spot.
 * For SELL: resistance levels at or above spot.
 */
export function scanEntryZones(
  spot: number,
  atrAbs: number,
  bias: "BUY" | "SELL",
  levels: PriceLevel[],
  source = "quant",
): EntryZone[] {
  const pip = GOLD_PIP;
  const buf = SL_LEVEL_BUFFER * pip;
  const results: EntryZone[] = [];

  for (const level of levels) {
    if (bias === "BUY") {
      // Support below current spot (or within 10 pips above = at-market entry)
      if (level.price > spot + 10 * pip) continue;
      // Must not be too far below (not more than 3 ATR)
      if (spot - level.price > atrAbs * 3) continue;

      // Entry just above the support level
      const dist = spot - level.price;
      const entry = dist < 5 * pip ? spot : level.price + buf;  // at-market if very close
      const sl = level.price - (MAX_SL_PIPS - SL_LEVEL_BUFFER * 2) * pip;
      const slPips = Math.round((entry - sl) / pip);
      if (slPips < 8 || slPips > MAX_SL_PIPS) continue;

      const tpPips = Math.max(MIN_TP_PIPS, Math.min(MAX_TP_PIPS, slPips * 14));
      const tp = entry + tpPips * pip;
      results.push({
        direction: "BUY",
        entry:     Math.round(entry * 100) / 100,
        stopLoss:  Math.round(sl * 100) / 100,
        takeProfit:Math.round(tp * 100) / 100,
        slPips,
        tpPips,
        riskReward: Math.round((tpPips / slPips) * 100) / 100,
        levelType: level.label,
        confidence: level.weight,
        source,
      });
    } else {
      // Resistance above current spot
      if (level.price < spot - 10 * pip) continue;
      if (level.price - spot > atrAbs * 3) continue;

      const dist = level.price - spot;
      const entry = dist < 5 * pip ? spot : level.price - buf;
      const sl = level.price + (MAX_SL_PIPS - SL_LEVEL_BUFFER * 2) * pip;
      const slPips = Math.round((sl - entry) / pip);
      if (slPips < 8 || slPips > MAX_SL_PIPS) continue;

      const tpPips = Math.max(MIN_TP_PIPS, Math.min(MAX_TP_PIPS, slPips * 14));
      const tp = entry - tpPips * pip;
      results.push({
        direction: "SELL",
        entry:     Math.round(entry * 100) / 100,
        stopLoss:  Math.round(sl * 100) / 100,
        takeProfit:Math.round(tp * 100) / 100,
        slPips,
        tpPips,
        riskReward: Math.round((tpPips / slPips) * 100) / 100,
        levelType: level.label,
        confidence: level.weight,
        source,
      });
    }
  }

  return results
    .sort((a, b) => b.confidence * b.riskReward - a.confidence * a.riskReward)
    .slice(0, 8);
}

/** Estimate ATR when unavailable: 0.45% of price is typical gold intraday ATR. */
export function estimateAtr(price: number): number {
  return Math.round(price * 0.0045 * 100) / 100;
}

/**
 * Determine structural trend bias from available signal data.
 * Returns direction and strength [0,1].
 */
export function structuralTrendBias(
  signalDirection: string,
  signalConfidence: number,
  signalScore: number,
  cotTilt: string | null,
  timingState: string | null,
  timingPressure: number | null,
): { direction: "BUY" | "SELL" | "NEUTRAL"; strength: number } {
  let bull = 0;
  let bear = 0;

  // Platform signal (independent weight)
  if (signalDirection === "BUY")  bull += signalConfidence * 0.35 + signalScore * 0.15;
  if (signalDirection === "SELL") bear += signalConfidence * 0.35 + signalScore * 0.15;

  // COT positioning (structural money flow)
  if (cotTilt === "EXTREME_LONG") bull += 0.12;  // slight contrarian discount
  else if (cotTilt === "LONG")    bull += 0.18;
  else if (cotTilt === "SHORT")   bear += 0.18;
  else if (cotTilt === "EXTREME_SHORT") bear += 0.12;

  // Timing state
  if (timingState === "CONFIRMED") {
    if (signalDirection === "BUY")  bull += 0.12;
    if (signalDirection === "SELL") bear += 0.12;
  } else if (timingState === "BUILDING") {
    bull *= 0.80; bear *= 0.80; // uncertainty discount
  }

  // Timing pressure (momentum proxy)
  if (timingPressure !== null) {
    const p = Math.tanh(timingPressure);
    if (p > 0) bull += p * 0.10;
    else        bear += Math.abs(p) * 0.10;
  }

  const diff = bull - bear;
  const strength = Math.min(Math.abs(diff) / 0.5, 1.0);

  if (diff > 0.06)  return { direction: "BUY",     strength };
  if (diff < -0.06) return { direction: "SELL",    strength };
  return               { direction: "NEUTRAL", strength };
}

/** Compute all price levels for a given spot + ATR. */
export function buildAllLevels(spot: number, atrAbs: number): PriceLevel[] {
  const swing = atrAbs * 2.5;
  const high  = spot + swing;
  const low   = spot - swing;
  const close = spot;

  const fibs   = fibonacciRetracements(high, low);
  const pivots = pivotPoints(high, low, close);
  const rounds = roundNumberLevels(spot, 450);

  const all = [...fibs, ...pivots, ...rounds];
  // deduplicate levels within 1 pip
  const deduped: PriceLevel[] = [];
  for (const lvl of all) {
    const clash = deduped.find((d) => Math.abs(d.price - lvl.price) < GOLD_PIP);
    if (clash) {
      // keep the heavier weight
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
