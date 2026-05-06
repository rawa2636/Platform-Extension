/**
 * Quantitative math primitives for XAU/USD institutional analysis.
 * Convention: 1 pip = $1.00 for XAU/USD.
 *
 * Trade geometry:
 *   - Entry AT the key level (support or resistance)
 *   - SL placed $2–4 BEYOND the level (not $30+)
 *   - TP = $30–60 from entry
 *   - Minimum R:R = 10 (e.g. $3 SL → $30 TP = 10:1)
 */

export const GOLD_PIP = 1.0;          // $1 per pip
export const MAX_SL_PIPS = 4;         // $4 max stop loss beyond level
export const MIN_SL_PIPS = 1.5;       // $1.50 min stop loss
export const MIN_TP_PIPS = 30;        // $30 minimum target
export const MAX_TP_PIPS = 60;        // $60 maximum target
export const SL_LEVEL_BUFFER = 0.30;  // $0.30 inside the level for entry
export const SL_BEYOND_LEVEL = 2.50;  // $2.50 beyond the level for SL
export const MIN_RR = 10;             // minimum risk-reward ratio

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
 * Institutional entry zone scanner.
 *
 * Geometry (matching user requirement):
 *   BUY  at support: entry = level + $0.30 buffer
 *                    SL    = level − $2.50           → slPips ≈ $2.80
 *                    TP    = entry + $30–60           → R:R ≈ 10–20:1
 *
 *   SELL at resistance: entry = level − $0.30
 *                       SL    = level + $2.50
 *                       TP    = entry − $30–60
 *
 * Scans levels within 1.5×ATR of spot so the panel shows
 * the NEAREST actionable level (may be slightly above/below spot —
 * price will reach it naturally, and the trade is pre-planned).
 */
export function scanEntryZones(
  spot: number,
  atrAbs: number,
  bias: "BUY" | "SELL",
  levels: PriceLevel[],
  source = "quant",
): EntryZone[] {
  const results: EntryZone[] = [];
  // Search window: 1.5× ATR each side (gold ATR ~$12, window ±$18)
  const window = Math.max(atrAbs * 1.5, 20);

  for (const level of levels) {
    const dist = level.price - spot; // positive = above spot

    if (bias === "BUY") {
      // Support: must be AT or BELOW spot (±$1 tolerance for at-market)
      if (dist > 1.0) continue;
      // Not too far below
      if (spot - level.price > window) continue;

      // Entry just inside (above) the support level
      const entry = level.price + SL_LEVEL_BUFFER;
      // SL beyond (below) the level — $2.50 below the level
      const sl    = level.price - SL_BEYOND_LEVEL;
      const slPips = Math.round((entry - sl) * 10) / 10; // keep 1dp

      if (slPips < MIN_SL_PIPS || slPips > MAX_SL_PIPS) continue;

      // TP: aim for R:R 13–20, clamped to $30–$60
      const rawTp = Math.round(slPips * 15);
      const tpPips = Math.max(MIN_TP_PIPS, Math.min(MAX_TP_PIPS, rawTp));
      const tp     = entry + tpPips;
      const rr     = Math.round((tpPips / slPips) * 10) / 10;
      if (rr < MIN_RR) continue;

      results.push({
        direction:  "BUY",
        entry:      Math.round(entry * 100) / 100,
        stopLoss:   Math.round(sl * 100) / 100,
        takeProfit: Math.round(tp * 100) / 100,
        slPips:     Math.round(slPips * 10) / 10,
        tpPips,
        riskReward: rr,
        levelType:  level.label,
        confidence: level.weight,
        source,
      });

    } else {
      // Resistance: AT or ABOVE spot
      if (dist < -1.0) continue;
      if (level.price - spot > window) continue;

      const entry = level.price - SL_LEVEL_BUFFER;
      const sl    = level.price + SL_BEYOND_LEVEL;
      const slPips = Math.round((sl - entry) * 10) / 10;

      if (slPips < MIN_SL_PIPS || slPips > MAX_SL_PIPS) continue;

      const rawTp  = Math.round(slPips * 15);
      const tpPips = Math.max(MIN_TP_PIPS, Math.min(MAX_TP_PIPS, rawTp));
      const tp     = entry - tpPips;
      const rr     = Math.round((tpPips / slPips) * 10) / 10;
      if (rr < MIN_RR) continue;

      results.push({
        direction:  "SELL",
        entry:      Math.round(entry * 100) / 100,
        stopLoss:   Math.round(sl * 100) / 100,
        takeProfit: Math.round(tp * 100) / 100,
        slPips:     Math.round(slPips * 10) / 10,
        tpPips,
        riskReward: rr,
        levelType:  level.label,
        confidence: level.weight,
        source,
      });
    }
  }

  // Best zone = highest confidence × R:R
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
