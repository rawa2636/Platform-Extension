import type { AgentOutput } from "./types.js";

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
): Promise<AgentOutput> {
  const t0 = Date.now();

  const now = Date.now();
  const freshFrames = frameBuffer.filter(
    (f) => now - new Date(f.timestamp).getTime() < FRAME_TTL_MS,
  );

  if (freshFrames.length === 0) {
    return {
      agentId: "vision",
      agentName: "Vision Agent",
      vote: "ABSTAIN",
      confidence: 0,
      evidence: {
        sources: [],
        features_used: [],
        timestamp: new Date().toISOString(),
      },
      reasoning: "No fresh frames ingested. POST to /api/trader/ingest/frame to supply Bookmap/heatmap data.",
      signals: { frameCount: 0, freshFrameCount: 0 },
      latencyMs: Date.now() - t0,
    };
  }

  const analysis = analyzeFrames(freshFrames, spot);
  const vote =
    analysis.imbalance > 0.15 ? "BUY"
    : analysis.imbalance < -0.15 ? "SELL"
    : "NEUTRAL";
  const confidence = Math.min(0.4 + Math.abs(analysis.imbalance) * 1.5, 0.9);

  return {
    agentId: "vision",
    agentName: "Vision Agent",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: ["bookmap_heatmap_frames"],
      features_used: ["heat_zone_clusters", "buy_sell_intensity", "price_proximity"],
      timestamp: freshFrames[freshFrames.length - 1]!.timestamp,
    },
    reasoning: buildReasoning(analysis, vote, freshFrames.length),
    signals: {
      frameCount: frameBuffer.length,
      freshFrameCount: freshFrames.length,
      totalBuyIntensity: analysis.buyIntensity,
      totalSellIntensity: analysis.sellIntensity,
      imbalance: analysis.imbalance,
      nearbyBuyZones: analysis.nearbyBuyZones,
      nearbySellZones: analysis.nearbySellZones,
      dominantLabel: analysis.dominantLabel,
    },
    latencyMs: Date.now() - t0,
  };
}

interface FrameAnalysis {
  buyIntensity: number;
  sellIntensity: number;
  imbalance: number;
  nearbyBuyZones: number;
  nearbySellZones: number;
  dominantLabel: string | null;
}

function analyzeFrames(frames: IngestedFrame[], spot: number): FrameAnalysis {
  let buyIntensity = 0;
  let sellIntensity = 0;
  let nearbyBuyZones = 0;
  let nearbySellZones = 0;
  const labelCounts: Record<string, number> = {};

  const proximity = spot * 0.003; // within 0.3% of spot

  for (const frame of frames) {
    for (const cluster of frame.clusters) {
      if (cluster.type === "buy") {
        buyIntensity += cluster.intensity;
        if (Math.abs(cluster.price - spot) <= proximity) nearbyBuyZones++;
      } else if (cluster.type === "sell") {
        sellIntensity += cluster.intensity;
        if (Math.abs(cluster.price - spot) <= proximity) nearbySellZones++;
      }
    }
    for (const label of frame.labels) {
      const key = label.toLowerCase();
      labelCounts[key] = (labelCounts[key] ?? 0) + 1;
    }
  }

  const totalIntensity = buyIntensity + sellIntensity;
  const imbalance = totalIntensity > 0
    ? (buyIntensity - sellIntensity) / totalIntensity
    : 0;

  const dominantLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { buyIntensity, sellIntensity, imbalance, nearbyBuyZones, nearbySellZones, dominantLabel };
}

function buildReasoning(a: FrameAnalysis, vote: string, frameCount: number): string {
  const parts: string[] = [];
  parts.push(`Analyzed ${frameCount} fresh Bookmap frames`);
  parts.push(`Buy intensity: ${a.buyIntensity.toFixed(2)}, sell intensity: ${a.sellIntensity.toFixed(2)}`);
  parts.push(`Flow imbalance: ${a.imbalance > 0 ? "+" : ""}${a.imbalance.toFixed(3)}`);
  parts.push(`Nearby buy zones: ${a.nearbyBuyZones}, nearby sell zones: ${a.nearbySellZones}`);
  if (a.dominantLabel) parts.push(`Dominant label: "${a.dominantLabel}"`);
  parts.push(`Vision vote: ${vote}`);
  return parts.join(". ");
}
