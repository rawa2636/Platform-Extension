import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";

export async function runMacroAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const analysis = analyzeMacro(snapshot);
  const vote = analysis.bias > 0.08 ? "BUY" : analysis.bias < -0.08 ? "SELL" : "NEUTRAL";
  const confidence = Math.min(0.4 + Math.abs(analysis.bias) * 2, 0.95);

  return {
    agentId: "macro",
    agentName: "Macro Agent",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: ["macro_data_feed", "cot_positioning"],
      features_used: [
        "macro.dxy",
        "macro.yield_10y",
        "macro.vix",
        "cot.speculator_tilt",
        "news.high_impact_count",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: buildReasoning(analysis, vote, snapshot),
    signals: {
      dxy: analysis.dxy,
      yield10y: analysis.yield10y,
      vix: analysis.vix,
      dxyBias: analysis.dxyBias,
      yieldBias: analysis.yieldBias,
      vixBias: analysis.vixBias,
      cotBias: analysis.cotBias,
      compositeBias: analysis.bias,
    },
    latencyMs: Date.now() - t0,
  };
}

interface MacroAnalysis {
  dxy: number | null;
  yield10y: number | null;
  vix: number | null;
  dxyBias: number;
  yieldBias: number;
  vixBias: number;
  cotBias: number;
  bias: number;
}

function analyzeMacro(s: NormalizedSnapshot): MacroAnalysis {
  const macro = s.macroSummary as Record<string, unknown>;
  const dxy = typeof macro.dxy === "number" ? macro.dxy : null;
  const yield10y = typeof macro.yield_10y === "number" ? macro.yield_10y : null;
  const vix = typeof macro.vix === "number" ? macro.vix : null;

  // DXY: inverse relationship with gold
  // DXY > 104 = bearish gold, < 100 = bullish gold
  let dxyBias = 0;
  if (dxy !== null) {
    if (dxy < 100) dxyBias = 0.3;
    else if (dxy < 102) dxyBias = 0.15;
    else if (dxy > 106) dxyBias = -0.3;
    else if (dxy > 104) dxyBias = -0.15;
  }

  // 10Y yield: higher yield = bearish gold (opportunity cost)
  let yieldBias = 0;
  if (yield10y !== null) {
    if (yield10y < 3.8) yieldBias = 0.2;
    else if (yield10y < 4.2) yieldBias = 0.05;
    else if (yield10y > 5.0) yieldBias = -0.25;
    else if (yield10y > 4.5) yieldBias = -0.1;
  }

  // VIX: risk-off = gold bullish (safe haven)
  let vixBias = 0;
  if (vix !== null) {
    if (vix > 30) vixBias = 0.25;
    else if (vix > 22) vixBias = 0.12;
    else if (vix < 12) vixBias = -0.1;
  }

  // COT structural positioning
  let cotBias = 0;
  if (s.cotTilt === "LONG") cotBias = 0.15;
  else if (s.cotTilt === "EXTREME_LONG") cotBias = 0.1; // extreme = mean reversal risk, lower
  else if (s.cotTilt === "SHORT") cotBias = -0.15;
  else if (s.cotTilt === "EXTREME_SHORT") cotBias = -0.1;

  const bias = dxyBias * 0.35 + yieldBias * 0.3 + vixBias * 0.2 + cotBias * 0.15;

  return { dxy, yield10y, vix, dxyBias, yieldBias, vixBias, cotBias, bias };
}

function buildReasoning(m: MacroAnalysis, vote: string, s: NormalizedSnapshot): string {
  const parts: string[] = [];
  if (m.dxy !== null) parts.push(`DXY=${m.dxy.toFixed(2)} (bias=${m.dxyBias > 0 ? "+" : ""}${m.dxyBias.toFixed(2)})`);
  if (m.yield10y !== null) parts.push(`10Y yield=${m.yield10y.toFixed(2)}% (bias=${m.yieldBias > 0 ? "+" : ""}${m.yieldBias.toFixed(2)})`);
  if (m.vix !== null) parts.push(`VIX=${m.vix.toFixed(2)} (risk-${m.vixBias >= 0 ? "off" : "on"} bias=${m.vixBias > 0 ? "+" : ""}${m.vixBias.toFixed(2)})`);
  parts.push(`COT: ${s.cotTilt ?? "n/a"} (bias=${m.cotBias > 0 ? "+" : ""}${m.cotBias.toFixed(2)})`);
  parts.push(`Composite macro bias: ${m.bias > 0 ? "+" : ""}${m.bias.toFixed(3)} → ${vote}`);
  return parts.join(". ");
}
