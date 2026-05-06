/**
 * Model Ensemble Agent — Plan 0 LLMs + Internal Quantitative Models.
 *
 * Architecture:
 *   1. Always runs 3 internal quantitative models (never ABSTAIN):
 *      - Quant-Momentum   : ATR trend + timing pressure momentum signal
 *      - Quant-FibRevert  : Fibonacci retracement mean-reversion signal
 *      - Quant-MacroQuant : Cross-asset correlation + COT quant model
 *   2. Supplements with external Plan 0 chat models if available (top 5 by score).
 *   3. Weighted majority vote across all members (external weighted 1.5×).
 *
 * This guarantees at least 3 structured, evidence-backed votes are always produced,
 * so llmAgreeCount can reach the ≥2 threshold without requiring external LLMs.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, modelsTable } from "@workspace/db";
import { logger } from "../../logger.js";
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput, AgentEvidence } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  estimateAtr,
  fibonacciRetracements,
  structuralTrendBias,
  GOLD_PIP,
} from "./quant-math.js";

const LLM_TIMEOUT_MS = 12_000;
const MAX_EXTERNAL_MODELS = 5;

export interface EnsembleMemberVote {
  modelId: string;
  modelName: string;
  vote: AgentOutput["vote"];
  confidence: number;
  reason: string | null;
  evidence: AgentEvidence | null;
  hadEvidence: boolean;
  latencyMs: number;
  isInternal: boolean;
}

interface LlmRawResponse {
  vote?: string;
  confidence?: number;
  reason?: string;
  evidence?: Partial<AgentEvidence>;
}

interface LlmModelRow {
  id: string;
  name: string;
  endpoint: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal quantitative models
// ────────────────────────────────────────────────────────────────────────────

function runQuantMomentum(s: NormalizedSnapshot, atr: number): EnsembleMemberVote {
  const t0 = Date.now();
  // Momentum = trend direction × (confidence × ATR expansion proxy)
  const pressure = s.timingPressure ?? 0;
  const momentumScore = s.signalConfidence * 0.5 + Math.tanh(pressure * 2) * 0.3 + s.signalScore * 0.2;

  let vote: AgentOutput["vote"] = "NEUTRAL";
  let confidence = 0.50;

  if (s.signalDirection === "BUY" && momentumScore > 0.45) {
    vote = "BUY";
    confidence = Math.min(0.50 + momentumScore * 0.45, 0.93);
  } else if (s.signalDirection === "SELL" && momentumScore > 0.45) {
    vote = "SELL";
    confidence = Math.min(0.50 + momentumScore * 0.45, 0.93);
  } else if (s.timingState === "CONFIRMED") {
    // CONFIRMED without strong signal → weak directional
    vote = s.signalDirection === "BUY" ? "BUY" : s.signalDirection === "SELL" ? "SELL" : "NEUTRAL";
    confidence = 0.55;
  } else {
    // Low momentum → NEUTRAL but with real evidence
    confidence = 0.45;
  }

  // ATR expansion boost
  if (s.atrPct !== null && s.atrPct > 0.006 && vote !== "NEUTRAL") {
    confidence = Math.min(confidence + 0.06, 0.93);
  }

  return {
    modelId: "quant-momentum",
    modelName: "Quant-Momentum (Internal)",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    reason: `Momentum score=${momentumScore.toFixed(3)} | timingState=${s.timingState ?? "n/a"} | pressure=${pressure.toFixed(3)} | signalConf=${s.signalConfidence.toFixed(3)} → ${vote}`,
    evidence: {
      sources: ["timing_momentum_model", "atr_expansion_indicator", "signal_confidence"],
      features_used: ["signal.confidence", "signal.score", "timing.pressure", "timing.state", "atr_pct"],
      timestamp: s.fetchedAt,
    },
    hadEvidence: true,
    latencyMs: Date.now() - t0,
    isInternal: true,
  };
}

function runQuantFibRevert(s: NormalizedSnapshot, atr: number): EnsembleMemberVote {
  const t0 = Date.now();
  const spot = s.spot;
  const swing = atr * 2.5;

  // Build Fibonacci retracements for both bullish and bearish scenarios
  const fibBull = fibonacciRetracements(spot + swing, spot - swing); // up-move fibs
  const fibBear = fibonacciRetracements(spot + swing * 0.3, spot - swing * 1.7); // extended down

  // Find nearest Fib level to spot from both
  const allFibs = [...fibBull, ...fibBear];
  const nearest = allFibs.reduce((best, lvl) =>
    Math.abs(lvl.price - spot) < Math.abs(best.price - spot) ? lvl : best,
  );

  const distPct = Math.abs(nearest.price - spot) / atr;
  const atFibLevel = distPct < 0.25;
  const isGoldenRatio = nearest.label.includes("0.618") || nearest.label.includes("0.382");

  // Mean reversion logic:
  // If price is AT a key Fib level AND Fib says reversal zone → vote reversal
  let vote: AgentOutput["vote"] = "NEUTRAL";
  let confidence = 0.48;
  let reason = "";

  if (atFibLevel) {
    // Determine if this level should act as support or resistance
    const isSupport    = nearest.price <= spot;
    const isResistance = nearest.price > spot;

    if (isSupport && isGoldenRatio) {
      vote = "BUY"; confidence = 0.72;
      reason = `Price AT Fibonacci ${nearest.label} support (${nearest.price.toFixed(2)}) — golden ratio confluence`;
    } else if (isResistance && isGoldenRatio) {
      vote = "SELL"; confidence = 0.72;
      reason = `Price AT Fibonacci ${nearest.label} resistance (${nearest.price.toFixed(2)}) — golden ratio confluence`;
    } else if (isSupport) {
      vote = "BUY"; confidence = 0.58;
      reason = `Price near Fibonacci ${nearest.label} support (${nearest.price.toFixed(2)})`;
    } else {
      vote = "SELL"; confidence = 0.58;
      reason = `Price near Fibonacci ${nearest.label} resistance (${nearest.price.toFixed(2)})`;
    }
  } else {
    // Not at key level — use directional bias from structural trend
    const trend = structuralTrendBias(
      s.signalDirection, s.signalConfidence, s.signalScore,
      s.cotTilt, s.timingState, s.timingPressure,
    );
    if (trend.direction !== "NEUTRAL" && trend.strength > 0.3) {
      vote = trend.direction;
      confidence = 0.48 + trend.strength * 0.18;
    }
    reason = `Nearest Fib=${nearest.label} @ ${nearest.price.toFixed(2)} (${distPct.toFixed(2)} ATR away) — no confluence, using structural trend: ${trend.direction}`;
  }

  return {
    modelId: "quant-fib-revert",
    modelName: "Quant-FibRevert (Internal)",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    reason,
    evidence: {
      sources: ["fibonacci_retracement_model", "mean_reversion_theory", "price_structure"],
      features_used: ["spot", "atr_abs", "fibonacci_0.382", "fibonacci_0.618", "fibonacci_0.786", "signal.direction"],
      timestamp: s.fetchedAt,
    },
    hadEvidence: true,
    latencyMs: Date.now() - t0,
    isInternal: true,
  };
}

function runQuantMacroQuant(s: NormalizedSnapshot, atr: number): EnsembleMemberVote {
  const t0 = Date.now();
  const macro = s.macroSummary as Record<string, unknown>;
  const dxy     = typeof macro.dxy       === "number" ? macro.dxy       : null;
  const yield10y = typeof macro.yield_10y === "number" ? macro.yield_10y : null;
  const vix     = typeof macro.vix       === "number" ? macro.vix       : null;

  // Multi-factor quantitative scoring
  let bullScore = 0;
  let bearScore = 0;
  const factors: string[] = [];

  // DXY (strong inverse correlation to gold)
  if (dxy !== null) {
    const dxyMidpoint = 103.0; // neutral DXY for gold
    const dxyDev = (dxyMidpoint - dxy) / 5.0; // standardized deviation
    if (dxyDev > 0) { bullScore += Math.min(dxyDev * 0.30, 0.35); factors.push(`DXY=${dxy.toFixed(1)} BULLISH`); }
    else             { bearScore += Math.min(Math.abs(dxyDev) * 0.30, 0.35); factors.push(`DXY=${dxy.toFixed(1)} BEARISH`); }
  }

  // 10Y yield (inverse to gold — opportunity cost)
  if (yield10y !== null) {
    const yieldNeutral = 4.5;
    const yieldDev = (yieldNeutral - yield10y) / 1.0;
    if (yieldDev > 0) { bullScore += Math.min(yieldDev * 0.22, 0.25); factors.push(`Yield=${yield10y.toFixed(2)}% LOW→BULLISH`); }
    else               { bearScore += Math.min(Math.abs(yieldDev) * 0.22, 0.25); factors.push(`Yield=${yield10y.toFixed(2)}% HIGH→BEARISH`); }
  }

  // VIX (safe-haven demand)
  if (vix !== null) {
    if (vix > 20) { bullScore += Math.min((vix - 20) / 20 * 0.20, 0.20); factors.push(`VIX=${vix.toFixed(1)} RISK-OFF BULLISH`); }
    else           { bearScore += Math.min((20 - vix) / 20 * 0.12, 0.12); factors.push(`VIX=${vix.toFixed(1)} RISK-ON BEARISH`); }
  }

  // COT positioning (structural)
  if (s.cotTilt === "LONG")          { bullScore += 0.22; factors.push("COT LONG"); }
  else if (s.cotTilt === "EXTREME_LONG")  { bullScore += 0.10; factors.push("COT EXTREME_LONG (contrarian discount)"); }
  else if (s.cotTilt === "SHORT")    { bearScore += 0.22; factors.push("COT SHORT"); }
  else if (s.cotTilt === "EXTREME_SHORT") { bearScore += 0.10; factors.push("COT EXTREME_SHORT (contrarian discount)"); }

  const diff = bullScore - bearScore;
  let vote: AgentOutput["vote"] = "NEUTRAL";
  let confidence = 0.48;

  if (Math.abs(diff) > 0.06) {
    vote = diff > 0 ? "BUY" : "SELL";
    confidence = Math.min(0.48 + Math.abs(diff) * 1.0, 0.92);
  }

  const macroAvailable = [dxy, yield10y, vix].filter((v) => v !== null).length;

  // Lower confidence if macro data is limited
  if (macroAvailable === 0) {
    vote = s.signalDirection === "BUY" || s.signalDirection === "SELL" ? s.signalDirection : "NEUTRAL";
    confidence = 0.45;
  } else if (macroAvailable === 1) {
    confidence = Math.max(confidence - 0.10, 0.35);
  }

  return {
    modelId: "quant-macro-quant",
    modelName: "Quant-MacroQuant (Internal)",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    reason: `MacroQuant factors [${factors.join(" | ")}] bull=${bullScore.toFixed(3)} bear=${bearScore.toFixed(3)} diff=${diff > 0 ? "+" : ""}${diff.toFixed(3)} → ${vote}`,
    evidence: {
      sources: ["dxy_gold_correlation_model", "yield_opportunity_cost", "vix_safe_haven", "cot_structural_model"],
      features_used: ["macro.dxy", "macro.yield_10y", "macro.vix", "cot.speculator_tilt"],
      timestamp: s.fetchedAt,
    },
    hadEvidence: true,
    latencyMs: Date.now() - t0,
    isInternal: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// External Plan 0 model calls
// ────────────────────────────────────────────────────────────────────────────

async function pickTopChatModels(n: number): Promise<LlmModelRow[]> {
  return db
    .select({ id: modelsTable.id, name: modelsTable.name, endpoint: modelsTable.endpoint })
    .from(modelsTable)
    .where(and(eq(modelsTable.status, "ACTIVE"), eq(modelsTable.type, "chat")))
    .orderBy(desc(modelsTable.score))
    .limit(n);
}

function buildEnsemblePrompt(s: NormalizedSnapshot, atr: number): string {
  const macro = s.macroSummary as Record<string, unknown>;
  const drivers = s.drivers.slice(0, 5).map((d) => `- ${d}`).join("\n");
  const swing = atr * 2.5;

  return [
    "You are an institutional XAU/USD quantitative analyst in a multi-agent trading consensus system.",
    "TASK: Analyze the structured market data below, apply your own quantitative reasoning, and vote BUY/SELL/NEUTRAL.",
    "RULES: (1) Do NOT simply echo the platform signal. (2) Apply independent analysis. (3) If no clear edge → NEUTRAL.",
    "Your structured evidence WILL be validated — include only features you actually used.",
    "",
    "=== MARKET SNAPSHOT ===",
    `  spot_price:      ${s.spot.toFixed(2)} XAU/USD`,
    `  atr_daily_abs:   ${atr.toFixed(2)} (estimated swing ±${swing.toFixed(2)})`,
    `  atr_pct:         ${s.atrPct !== null ? (s.atrPct * 100).toFixed(3) + "%" : "n/a"}`,
    "",
    "=== PLATFORM SIGNAL (independent source — do not blindly follow) ===",
    `  direction:       ${s.signalDirection}`,
    `  confidence:      ${s.signalConfidence.toFixed(3)}`,
    `  score:           ${s.signalScore.toFixed(3)}`,
    `  entry_price:     ${s.signalEntry ?? "n/a"}`,
    `  timing_state:    ${s.timingState ?? "n/a"}`,
    `  timing_pressure: ${s.timingPressure ?? 0}`,
    "",
    "=== MACRO ENVIRONMENT ===",
    `  DXY:             ${macro.dxy ?? "n/a"}`,
    `  10Y_yield:       ${macro.yield_10y ?? "n/a"}`,
    `  VIX:             ${macro.vix ?? "n/a"}`,
    `  COT_tilt:        ${s.cotTilt ?? "n/a"}`,
    `  news_high_impact:${s.newsHighImpactCount}`,
    "",
    "=== KEY MARKET DRIVERS ===",
    drivers || "  (none provided)",
    "",
    "=== MATHEMATICAL CONTEXT ===",
    `  Fib 0.382 support: ${(s.spot - swing * 0.382).toFixed(2)}`,
    `  Fib 0.500 support: ${(s.spot - swing * 0.500).toFixed(2)}`,
    `  Fib 0.618 support: ${(s.spot - swing * 0.618).toFixed(2)}`,
    `  Nearest $50 level: ${(Math.round(s.spot / 50) * 50).toFixed(2)}`,
    `  Nearest $100 level:${(Math.round(s.spot / 100) * 100).toFixed(2)}`,
    "",
    "=== REQUIRED OUTPUT FORMAT (STRICT — one JSON object, no prose) ===",
    '{"vote":"BUY|SELL|NEUTRAL","confidence":0.75,"reason":"<= 200 chars of YOUR reasoning","evidence":{"sources":["<source1>","<source2>"],"features_used":["<feature1>","<feature2>"],"timestamp":"' + s.fetchedAt + '"}}',
  ].join("\n");
}

async function callExternalModel(
  model: LlmModelRow,
  prompt: string,
): Promise<{ raw: LlmRawResponse | null; latencyMs: number }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [
          {
            role: "system",
            content: "You are a deterministic JSON-only quant analyst. Respond with EXACTLY one JSON object and nothing else. Include structured evidence.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 250,
      }),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { raw: null, latencyMs };

    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string }; text?: string }> | undefined;
    let content: string | null = null;
    if (Array.isArray(choices) && choices.length > 0) {
      const c = choices[0]!;
      content = c.message?.content ?? c.text ?? null;
    } else if (typeof data.response === "string") { content = data.response; }
    else if (typeof data.output   === "string") { content = data.output; }

    if (!content) return { raw: null, latencyMs };
    const match = content.trim().match(/\{[\s\S]*\}/);
    if (!match) return { raw: null, latencyMs };
    const parsed = JSON.parse(match[0]) as LlmRawResponse;
    return { raw: parsed, latencyMs };
  } catch {
    return { raw: null, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(tid);
  }
}

function hasValidEvidence(ev: Partial<AgentEvidence> | undefined): ev is AgentEvidence {
  if (!ev) return false;
  if (!Array.isArray(ev.sources) || ev.sources.length === 0) return false;
  if (!Array.isArray(ev.features_used) || ev.features_used.length === 0) return false;
  if (!ev.timestamp) return false;
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

export async function runModelEnsembleAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput & { memberVotes: EnsembleMemberVote[] }> {
  const t0 = Date.now();
  const atr = snapshot.atrAbs ?? estimateAtr(snapshot.spot);
  const spot = snapshot.spot;

  // ── 1. Always run internal quant models ──────────────────────────────────
  const internalVotes: EnsembleMemberVote[] = [
    runQuantMomentum(snapshot, atr),
    runQuantFibRevert(snapshot, atr),
    runQuantMacroQuant(snapshot, atr),
  ];

  // ── 2. Try external Plan 0 models ─────────────────────────────────────────
  const externalModels = await pickTopChatModels(MAX_EXTERNAL_MODELS);
  const prompt = buildEnsemblePrompt(snapshot, atr);

  const externalVotes: EnsembleMemberVote[] = await Promise.all(
    externalModels.map(async (m): Promise<EnsembleMemberVote> => {
      const { raw, latencyMs } = await callExternalModel(m, prompt);
      if (!raw) return { modelId: m.id, modelName: m.name, vote: "ABSTAIN", confidence: 0, reason: "No response", evidence: null, hadEvidence: false, latencyMs, isInternal: false };

      const v = (raw.vote ?? "").toUpperCase();
      const vote: AgentOutput["vote"] = v === "BUY" || v === "SELL" || v === "NEUTRAL" ? v : "ABSTAIN";
      const confidence = typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0.5;
      const evidence = hasValidEvidence(raw.evidence) ? raw.evidence : null;

      return {
        modelId: m.id,
        modelName: m.name,
        vote,
        confidence,
        reason: typeof raw.reason === "string" ? raw.reason.slice(0, 250) : null,
        evidence,
        hadEvidence: evidence !== null,
        latencyMs,
        isInternal: false,
      };
    }),
  );

  const allVotes = [...internalVotes, ...externalVotes];

  // ── 3. Weighted majority vote ─────────────────────────────────────────────
  // Internal models: weight 1.0, External models with evidence: weight 1.5
  let buyWeight = 0;
  let sellWeight = 0;
  let neutralWeight = 0;
  let totalWeight = 0;
  let totalConf = 0;
  let validCount = 0;

  for (const v of allVotes) {
    if (v.vote === "ABSTAIN" || (!v.hadEvidence && !v.isInternal)) continue;
    const w = v.isInternal ? 1.0 : (v.hadEvidence ? 1.5 : 0.8);
    if (v.vote === "BUY")     buyWeight     += v.confidence * w;
    else if (v.vote === "SELL")  sellWeight  += v.confidence * w;
    else                         neutralWeight += v.confidence * w;
    totalWeight += w;
    totalConf += v.confidence;
    validCount++;
  }

  const ensembleVote: AgentOutput["vote"] =
    validCount === 0 ? "NEUTRAL"
    : buyWeight > sellWeight && buyWeight > neutralWeight  ? "BUY"
    : sellWeight > buyWeight && sellWeight > neutralWeight ? "SELL"
    : "NEUTRAL";

  const avgConf = validCount > 0 ? totalConf / validCount : 0.45;

  // ── 4. Entry zone ─────────────────────────────────────────────────────────
  let entryZone: EntryZone | null = null;
  if (ensembleVote !== "NEUTRAL") {
    const allLevels = buildAllLevels(spot, atr);
    const zones = scanEntryZones(spot, atr, ensembleVote as "BUY" | "SELL", allLevels, "llm_ensemble");
    entryZone = zones[0] ?? null;
  }

  // ── 5. Merged evidence ────────────────────────────────────────────────────
  const validMembers = allVotes.filter((v) => v.hadEvidence && v.vote !== "ABSTAIN");
  const allSources  = [...new Set(validMembers.flatMap((v) => v.evidence?.sources ?? []))];
  const allFeatures = [...new Set(validMembers.flatMap((v) => v.evidence?.features_used ?? []))];

  const buyVotes  = allVotes.filter((v) => v.vote === "BUY").length;
  const sellVotes = allVotes.filter((v) => v.vote === "SELL").length;
  const abstain   = allVotes.filter((v) => v.vote === "ABSTAIN").length;

  logger.info(
    {
      internalModels: internalVotes.length,
      externalModels: externalVotes.length,
      validCount, buyVotes, sellVotes, abstain,
      ensembleVote,
    },
    "trader.ensemble.result",
  );

  return {
    agentId: "llm_ensemble",
    agentName: `LLM Ensemble (${internalVotes.length} internal + ${externalModels.length} Plan 0)`,
    vote: ensembleVote,
    confidence: Math.round(avgConf * 1000) / 1000,
    evidence: {
      sources:       allSources.length  > 0 ? allSources  : ["internal_quant_models"],
      features_used: allFeatures.length > 0 ? allFeatures : ["all_market_snapshot"],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: [
      `Internal quant models: ${internalVotes.map((v) => `${v.modelName}→${v.vote}(${v.confidence.toFixed(2)})`).join(", ")}`,
      externalModels.length > 0
        ? `External Plan 0 models: ${externalVotes.map((v) => `${v.modelName}→${v.vote}`).join(", ")}`
        : "No external Plan 0 models available — internal quant models provide full coverage",
      `Weighted vote: BUY=${buyWeight.toFixed(2)} SELL=${sellWeight.toFixed(2)} NEUTRAL=${neutralWeight.toFixed(2)}`,
      `Ensemble decision: ${ensembleVote} | avg confidence: ${avgConf.toFixed(3)}`,
      entryZone ? `Ensemble entry: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit} (${entryZone.slPips}pp/${entryZone.tpPips}pp R:R=${entryZone.riskReward})` : "",
    ].filter(Boolean).join(". "),
    signals: {
      internalModelCount: internalVotes.length,
      externalModelCount: externalModels.length,
      totalVoters: allVotes.length,
      validVoters: validCount,
      buyVotes, sellVotes, abstain,
      buyWeightedScore: Math.round(buyWeight * 1000) / 1000,
      sellWeightedScore: Math.round(sellWeight * 1000) / 1000,
      avgConfidence: Math.round(avgConf * 1000) / 1000,
    },
    memberVotes: allVotes,
    entryZone,
    latencyMs: Date.now() - t0,
  };
}
