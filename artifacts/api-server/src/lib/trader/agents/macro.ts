/**
 * Macro Agent — Quantitative macro regime analysis for XAU/USD.
 * Computes:
 *   - DXY inverse correlation scoring with non-linear zones
 *   - 10Y yield opportunity-cost model
 *   - VIX risk-regime classification
 *   - COT structural positioning with mean-reversion adjustment
 *   - Real rates proxy (yield - implied inflation)
 *   - Composite macro bias with entry zone recommendation
 */
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  estimateAtr,
} from "./quant-math.js";

interface MacroRegime {
  dxy: number | null;
  yield10y: number | null;
  vix: number | null;
  // Bias components in [-1,+1]
  dxyBias: number;
  yieldBias: number;
  vixBias: number;
  cotBias: number;
  realRateBias: number;
  // Composite
  compositeBias: number;
  // Regime label
  regime: "RISK_OFF_BULLISH" | "RISK_ON_BULLISH" | "RISK_OFF_BEARISH" | "RISK_ON_BEARISH" | "NEUTRAL";
}

export async function runMacroAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const atr = snapshot.atrAbs ?? estimateAtr(snapshot.spot);
  const spot = snapshot.spot;
  const regime = computeMacroRegime(snapshot);

  // When macro data is unavailable, supplement with structural trend from COT + signal
  let effectiveBias = regime.compositeBias;
  const macroDataPoints = [regime.dxy, regime.yield10y, regime.vix].filter(v => v !== null).length;
  if (macroDataPoints === 0) {
    // No macro data: use COT + signal as proxy (reduced weight)
    const cotSign = snapshot.cotTilt === "LONG" || snapshot.cotTilt === "EXTREME_LONG" ? 1
      : snapshot.cotTilt === "SHORT" || snapshot.cotTilt === "EXTREME_SHORT" ? -1 : 0;
    const sigSign = snapshot.signalDirection === "BUY" ? 1 : snapshot.signalDirection === "SELL" ? -1 : 0;
    effectiveBias = cotSign * 0.15 + sigSign * snapshot.signalConfidence * 0.10;
  }

  const vote: AgentOutput["vote"] =
    effectiveBias > 0.04  ? "BUY"  :
    effectiveBias < -0.04 ? "SELL" :
    "NEUTRAL";

  // Confidence: how clear the macro signal is
  const clarity = Math.abs(effectiveBias);
  let confidence = 0.38 + clarity * 0.60;

  // Reduce confidence when no real macro data
  if (macroDataPoints === 0) confidence = Math.min(confidence, 0.60);
  else if (macroDataPoints === 1) confidence = Math.min(confidence, 0.72);

  // Boost for strong regime clarity
  if (regime.regime === "RISK_OFF_BULLISH" && vote === "BUY")  confidence = Math.min(confidence + 0.10, 0.95);
  if (regime.regime === "RISK_ON_BEARISH"  && vote === "SELL") confidence = Math.min(confidence + 0.10, 0.95);

  // Reduce if news event risk
  if (snapshot.newsHighImpactCount >= 4) confidence = Math.max(confidence - 0.08, 0.20);

  confidence = Math.round(confidence * 1000) / 1000;

  // Entry zone: macro sets the direction, math sets the level
  let entryZone: EntryZone | null = null;
  const biasDire = vote === "NEUTRAL" ? null : vote;
  if (biasDire) {
    const allLevels = buildAllLevels(spot, atr);
    const zones = scanEntryZones(spot, atr, biasDire, allLevels, "macro");
    entryZone = zones[0] ?? null;
  }

  const reasoning = [
    `Macro regime: ${regime.regime}`,
    regime.dxy !== null ? `DXY=${regime.dxy.toFixed(2)} → bias=${sign(regime.dxyBias)} (inverse gold correlation)` : "DXY: unavailable",
    regime.yield10y !== null ? `10Y yield=${regime.yield10y.toFixed(3)}% → bias=${sign(regime.yieldBias)} (opportunity cost)` : "10Y: unavailable",
    regime.vix !== null ? `VIX=${regime.vix.toFixed(2)} → bias=${sign(regime.vixBias)} (safe-haven demand)` : "VIX: unavailable",
    `COT tilt: ${snapshot.cotTilt ?? "n/a"} → bias=${sign(regime.cotBias)} (structural positioning)`,
    `Real rate proxy bias: ${sign(regime.realRateBias)}`,
    `Composite macro bias: ${sign(regime.compositeBias)} → vote=${vote} conf=${confidence}`,
    entryZone ? `Macro-aligned entry: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit}` : "No macro-aligned entry zone found",
  ].join(". ");

  return {
    agentId: "macro",
    agentName: "Macro Agent",
    vote,
    confidence,
    evidence: {
      sources: [
        "macro_data_feed",
        "cot_positioning",
        "dxy_correlation_model",
        "yield_opportunity_cost_model",
        "vix_risk_regime",
      ],
      features_used: [
        "macro.dxy",
        "macro.yield_10y",
        "macro.vix",
        "cot.speculator_tilt",
        "news.high_impact_count",
        "real_rate_proxy",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning,
    signals: {
      regime: regime.regime,
      dxy: regime.dxy,
      yield10y: regime.yield10y,
      vix: regime.vix,
      dxyBias: regime.dxyBias,
      yieldBias: regime.yieldBias,
      vixBias: regime.vixBias,
      cotBias: regime.cotBias,
      realRateBias: regime.realRateBias,
      compositeBias: regime.compositeBias,
    },
    entryZone,
    latencyMs: Date.now() - t0,
  };
}

function computeMacroRegime(s: NormalizedSnapshot): MacroRegime {
  const macro = s.macroSummary as Record<string, unknown>;
  const dxy     = typeof macro.dxy       === "number" ? macro.dxy       : null;
  const yield10y = typeof macro.yield_10y === "number" ? macro.yield_10y : null;
  const vix     = typeof macro.vix       === "number" ? macro.vix       : null;
  const cpi     = typeof macro.cpi       === "number" ? macro.cpi       : null; // inflation proxy

  // ── DXY bias (non-linear zones) ──────────────────────────────────────────
  let dxyBias = 0;
  if (dxy !== null) {
    if      (dxy < 98)   dxyBias =  0.45;  // very weak dollar = strong gold
    else if (dxy < 100)  dxyBias =  0.30;
    else if (dxy < 102)  dxyBias =  0.15;
    else if (dxy < 104)  dxyBias =  0.00;  // neutral zone
    else if (dxy < 106)  dxyBias = -0.15;
    else if (dxy < 108)  dxyBias = -0.30;
    else                 dxyBias = -0.45;  // strong dollar = bearish gold
  }

  // ── 10Y yield bias (opportunity cost model) ───────────────────────────────
  let yieldBias = 0;
  if (yield10y !== null) {
    if      (yield10y < 3.5)  yieldBias =  0.35;
    else if (yield10y < 4.0)  yieldBias =  0.18;
    else if (yield10y < 4.3)  yieldBias =  0.05;
    else if (yield10y < 4.7)  yieldBias = -0.10;
    else if (yield10y < 5.2)  yieldBias = -0.25;
    else                      yieldBias = -0.38;
  }

  // ── VIX risk-regime ───────────────────────────────────────────────────────
  let vixBias = 0;
  if (vix !== null) {
    if      (vix > 40)  vixBias =  0.40;  // extreme fear = strong safe haven
    else if (vix > 30)  vixBias =  0.28;
    else if (vix > 22)  vixBias =  0.14;
    else if (vix > 15)  vixBias =  0.03;
    else if (vix > 12)  vixBias = -0.05;
    else                vixBias = -0.12;  // complacency = risk-on = gold bearish
  }

  // ── COT structural positioning ────────────────────────────────────────────
  let cotBias = 0;
  if (s.cotTilt === "LONG")          cotBias =  0.22;
  else if (s.cotTilt === "EXTREME_LONG")  cotBias =  0.10;  // extreme → mean reversion discount
  else if (s.cotTilt === "SHORT")    cotBias = -0.22;
  else if (s.cotTilt === "EXTREME_SHORT") cotBias = -0.10;

  // ── Real rates proxy ──────────────────────────────────────────────────────
  // Real rate = yield - CPI. Negative real rates = very bullish gold.
  let realRateBias = 0;
  if (yield10y !== null && cpi !== null) {
    const realRate = yield10y - cpi;
    if      (realRate < -1.0)  realRateBias =  0.35;
    else if (realRate < -0.5)  realRateBias =  0.20;
    else if (realRate < 0.0)   realRateBias =  0.08;
    else if (realRate < 0.5)   realRateBias = -0.05;
    else if (realRate < 1.0)   realRateBias = -0.15;
    else                       realRateBias = -0.28;
  } else if (yield10y !== null) {
    // Without CPI, use yield alone as proxy
    realRateBias = yieldBias * 0.4;
  }

  // ── Composite bias ────────────────────────────────────────────────────────
  const compositeBias =
    dxyBias      * 0.32 +
    yieldBias    * 0.25 +
    vixBias      * 0.18 +
    cotBias      * 0.15 +
    realRateBias * 0.10;

  // ── Regime classification ─────────────────────────────────────────────────
  const riskOff  = (vix ?? 16) > 20;
  const bullishMacro = compositeBias > 0;
  const regime =
    riskOff && bullishMacro   ? "RISK_OFF_BULLISH"  :
    !riskOff && bullishMacro  ? "RISK_ON_BULLISH"   :
    riskOff && !bullishMacro  ? "RISK_OFF_BEARISH"  :
    !riskOff && !bullishMacro ? "RISK_ON_BEARISH"   :
    "NEUTRAL";

  return {
    dxy, yield10y, vix,
    dxyBias: round3(dxyBias),
    yieldBias: round3(yieldBias),
    vixBias: round3(vixBias),
    cotBias: round3(cotBias),
    realRateBias: round3(realRateBias),
    compositeBias: round3(compositeBias),
    regime,
  };
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function sign(n: number): string { return (n >= 0 ? "+" : "") + n.toFixed(3); }
