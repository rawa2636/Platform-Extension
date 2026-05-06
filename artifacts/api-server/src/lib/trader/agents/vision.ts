/**
 * Vision Agent — Bookmap/heatmap frame analysis + synthetic price cluster model.
 *
 * When frames ARE ingested: analyzes real buy/sell cluster intensity near spot.
 * When NO frames ingested: performs SYNTHETIC analysis using:
 *   - Psychological round-number cluster model
 *   - ATR-band density mapping
 *   - Price proximity scoring
 * This ensures the agent never ABSTAINs due to missing frames alone.
 */
import type { AgentOutput } from "./types.js";
import type { EntryZone } from "./quant-math.js";
import {
  buildAllLevels,
  scanEntryZones,
  estimateAtr,
  roundNumberLevels,
  GOLD_PIP,
} from "./quant-math.js";

export interface HeatZoneCluster {
  price: number;
  intensity: number;
  type: "buy" | "sell" | "neutral";
}

export interface IngestedFrame {
  clusters: HeatZoneCluster[];
  labels: string[];
  timestamp: string;
  sourceUrl?: string;
}

const FRAME_BUFFER_MAX = 10;
const FRAME_TTL_MS = 5 * 60 * 1000; // 5 minutes

const frameBuffer: IngestedFrame[] = [];

export function ingestFrame(frame: IngestedFrame): void {
  frameBuffer.push(frame);
  while (frameBuffer.length > FRAME_BUFFER_MAX) frameBuffer.shift();
}

export function getFrameBuffer(): IngestedFrame[] {
  return frameBuffer.slice();
}

export async function runVisionAgent(
  spot: number,
  signalDirection: string,
  atrAbsParam: number | null,
): Promise<AgentOutput> {
  const t0 = Date.now();
  const atr = atrAbsParam ?? estimateAtr(spot);

  const now = Date.now();
  const freshFrames = frameBuffer.filter(
    (f) => now - new Date(f.timestamp).getTime() < FRAME_TTL_MS,
  );

  // ── Real frame analysis ───────────────────────────────────────────────────
  if (freshFrames.length > 0) {
    return analyzeRealFrames(freshFrames, spot, atr, t0);
  }

  // ── Synthetic analysis (no frames available) ──────────────────────────────
  return analyzeSynthetic(spot, atr, signalDirection, t0);
}

// ────────────────────────────────────────────────────────────────────────────
// Real frame analysis
// ────────────────────────────────────────────────────────────────────────────
function analyzeRealFrames(
  frames: IngestedFrame[],
  spot: number,
  atr: number,
  t0: number,
): AgentOutput {
  let buyIntensity = 0;
  let sellIntensity = 0;
  let nearbyBuyZones = 0;
  let nearbySellZones = 0;
  const labelCounts: Record<string, number> = {};

  const proximity = atr * 0.40;
  const weightedClusters: Array<{ price: number; type: string; intensity: number }> = [];

  for (const frame of frames) {
    const ageFactor = 1 - (Date.now() - new Date(frame.timestamp).getTime()) / (5 * 60 * 1000) * 0.3;
    for (const c of frame.clusters) {
      const wIntensity = c.intensity * ageFactor;
      if (c.type === "buy") {
        buyIntensity += wIntensity;
        if (Math.abs(c.price - spot) <= proximity) nearbyBuyZones++;
      } else if (c.type === "sell") {
        sellIntensity += wIntensity;
        if (Math.abs(c.price - spot) <= proximity) nearbySellZones++;
      }
      weightedClusters.push({ price: c.price, type: c.type, intensity: wIntensity });
    }
    for (const l of frame.labels) labelCounts[l.toLowerCase()] = (labelCounts[l.toLowerCase()] ?? 0) + 1;
  }

  const total = buyIntensity + sellIntensity;
  const imbalance = total > 0 ? (buyIntensity - sellIntensity) / total : 0;
  const vote: AgentOutput["vote"] =
    imbalance > 0.15 ? "BUY" : imbalance < -0.15 ? "SELL" : "NEUTRAL";
  const confidence = Math.min(0.50 + Math.abs(imbalance) * 1.5, 0.92);

  // Find strongest cluster level and use as entry zone
  const sorted = weightedClusters
    .filter((c) => c.type === (vote === "BUY" ? "buy" : "sell"))
    .sort((a, b) => b.intensity - a.intensity);
  const topCluster = sorted[0] ?? null;

  let entryZone: EntryZone | null = null;
  if (vote !== "NEUTRAL" && topCluster) {
    const allLevels = buildAllLevels(spot, atr);
    const zones = scanEntryZones(spot, atr, vote as "BUY" | "SELL", allLevels, "vision_real");
    entryZone = zones[0] ?? null;
  }

  const dominantLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    agentId: "vision",
    agentName: "Vision Agent (Real Frames)",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: ["bookmap_heatmap_frames"],
      features_used: ["heat_zone_clusters", "buy_sell_intensity", "price_proximity", "frame_age_weighting"],
      timestamp: frames[frames.length - 1]!.timestamp,
    },
    reasoning: [
      `Analyzed ${frames.length} fresh Bookmap frames`,
      `Weighted buy intensity: ${buyIntensity.toFixed(2)}, sell intensity: ${sellIntensity.toFixed(2)}`,
      `Flow imbalance: ${imbalance > 0 ? "+" : ""}${imbalance.toFixed(3)}`,
      `Nearby buy zones: ${nearbyBuyZones}, nearby sell zones: ${nearbySellZones} (within ${proximity.toFixed(1)} pts)`,
      dominantLabel ? `Dominant label: "${dominantLabel}"` : "",
      entryZone ? `Visual entry: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit}` : "No visual entry zone",
    ].filter(Boolean).join(". "),
    signals: {
      source: "real_frames",
      frameCount: frames.length,
      buyIntensity, sellIntensity, imbalance,
      nearbyBuyZones, nearbySellZones, dominantLabel,
    },
    entryZone,
    latencyMs: Date.now() - t0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Synthetic analysis (no frames — compute from price structure)
// ────────────────────────────────────────────────────────────────────────────
function analyzeSynthetic(
  spot: number,
  atr: number,
  signalDirection: string,
  t0: number,
): AgentOutput {
  // Model synthetic buy/sell pressure at each level using proximity and weight
  const rounds = roundNumberLevels(spot, 300);
  const allLevels = buildAllLevels(spot, atr);

  let syntheticBuy = 0;
  let syntheticSell = 0;
  const proximity = atr * 0.6;

  for (const r of rounds) {
    const dist = Math.abs(r.price - spot);
    if (dist > proximity) continue;
    const proximity_factor = Math.max(0, 1 - dist / proximity);
    const intensity = r.weight * proximity_factor;

    // Below spot = likely support/buy zone; above spot = likely resistance/sell zone
    if (r.price < spot) syntheticBuy  += intensity;
    else                syntheticSell += intensity;
  }

  // ATR band model: if price is in upper half of daily range, sell pressure
  // Signal direction adds directional bias
  const dirBias =
    signalDirection === "BUY"  ?  0.15 :
    signalDirection === "SELL" ? -0.15 : 0;

  const total = syntheticBuy + syntheticSell;
  let imbalance = total > 0 ? (syntheticBuy - syntheticSell) / total + dirBias : dirBias;
  imbalance = Math.max(-1, Math.min(1, imbalance));

  // In synthetic mode, vote is directional but conservative
  const vote: AgentOutput["vote"] =
    imbalance > 0.10 ? "BUY"  :
    imbalance < -0.10 ? "SELL" :
    "NEUTRAL";

  // Lower confidence in synthetic mode
  const confidence = Math.min(0.38 + Math.abs(imbalance) * 0.80, 0.72);

  let entryZone: EntryZone | null = null;
  if (vote !== "NEUTRAL") {
    const zones = scanEntryZones(spot, atr, vote as "BUY" | "SELL", allLevels, "vision_synthetic");
    entryZone = zones[0] ?? null;
  }

  // Find nearest round number cluster
  const nearestRound = rounds[0];
  const distToRound = nearestRound ? Math.abs(nearestRound.price - spot) : Infinity;

  return {
    agentId: "vision",
    agentName: "Vision Agent (Synthetic Analysis)",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: [
        "round_number_cluster_model",
        "atr_band_density",
        "price_proximity_scoring",
      ],
      features_used: [
        "spot",
        "atr_abs",
        "psychological_levels",
        "price_level_proximity",
        "signal_direction",
      ],
      timestamp: new Date().toISOString(),
    },
    reasoning: [
      "No real frames available — using synthetic price cluster analysis",
      `Round-number support cluster model: buy pressure=${syntheticBuy.toFixed(3)}, sell pressure=${syntheticSell.toFixed(3)}`,
      nearestRound ? `Nearest psychological level: ${nearestRound.price} (${distToRound.toFixed(1)} pts away)` : "",
      `Directional bias from signal: ${signalDirection} (+${dirBias.toFixed(2)})`,
      `Synthetic imbalance: ${imbalance > 0 ? "+" : ""}${imbalance.toFixed(3)} → vote=${vote} (synthetic, conservative confidence)`,
      entryZone ? `Synthetic entry zone: ${entryZone.direction} @ ${entryZone.entry} SL=${entryZone.stopLoss} TP=${entryZone.takeProfit} (${entryZone.slPips}pp/${entryZone.tpPips}pp R:R=${entryZone.riskReward})` : "No entry zone found",
      "POST /api/trader/ingest/frame with Bookmap data for real heatmap analysis",
    ].filter(Boolean).join(". "),
    signals: {
      source: "synthetic",
      syntheticBuyPressure: Math.round(syntheticBuy * 1000) / 1000,
      syntheticSellPressure: Math.round(syntheticSell * 1000) / 1000,
      imbalance: Math.round(imbalance * 1000) / 1000,
      nearestRound: nearestRound?.price ?? null,
      distToNearestRound: nearestRound ? Math.round(distToRound * 100) / 100 : null,
    },
    entryZone,
    latencyMs: Date.now() - t0,
  };
}
