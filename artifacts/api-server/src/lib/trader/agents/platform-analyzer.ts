import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";

export async function runPlatformAnalyzerAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput> {
  const t0 = Date.now();

  const vote = resolveVote(snapshot);
  const confidence = computeConfidence(snapshot);

  return {
    agentId: "platform_analyzer",
    agentName: "Platform Analyzer",
    vote,
    confidence,
    evidence: {
      sources: ["source_platform_intelligence"],
      features_used: [
        "signal.direction",
        "signal.confidence",
        "signal.score",
        "timing.state",
        "timing.pressure",
        "news.high_impact_count",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: buildReasoning(snapshot, vote, confidence),
    signals: {
      direction: snapshot.signalDirection,
      platformConfidence: snapshot.signalConfidence,
      platformScore: snapshot.signalScore,
      timingState: snapshot.timingState,
      timingPressure: snapshot.timingPressure,
      newsHighImpact: snapshot.newsHighImpactCount,
      sourceStatus: snapshot.sourceStatus,
    },
    latencyMs: Date.now() - t0,
  };
}

function resolveVote(s: NormalizedSnapshot): AgentOutput["vote"] {
  if (s.sourceStatus !== "live") return "ABSTAIN";
  if (s.signalDirection === "BUY") return "BUY";
  if (s.signalDirection === "SELL") return "SELL";
  return "NEUTRAL";
}

function computeConfidence(s: NormalizedSnapshot): number {
  if (s.sourceStatus !== "live") return 0;
  let conf = s.signalConfidence * 0.6 + s.signalScore * 0.4;
  if (s.timingState === "CONFIRMED") conf = Math.min(conf + 0.05, 1);
  if (s.timingState === "BUILDING") conf = Math.max(conf - 0.1, 0);
  if (s.newsHighImpactCount >= 3) conf = Math.max(conf - 0.08, 0);
  return Math.round(conf * 1000) / 1000;
}

function buildReasoning(
  s: NormalizedSnapshot,
  vote: AgentOutput["vote"],
  conf: number,
): string {
  const parts: string[] = [];
  parts.push(`Platform signal: ${s.signalDirection} (conf=${s.signalConfidence.toFixed(2)}, score=${s.signalScore.toFixed(2)})`);
  if (s.timingState) parts.push(`Timing: ${s.timingState} pressure=${s.timingPressure ?? 0}`);
  if (s.newsHighImpactCount > 0) parts.push(`High-impact news: ${s.newsHighImpactCount}`);
  parts.push(`Agent vote: ${vote} at adjusted confidence ${conf.toFixed(3)}`);
  return parts.join(". ");
}
