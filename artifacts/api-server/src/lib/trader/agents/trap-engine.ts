import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput } from "./types.js";

export interface TrapEngineSignals {
  trapScore: number;
  fakeBreakoutRisk: number;
  sweepRisk: number;
  absorptionHint: number;
  trapType: string | null;
}

export async function runTrapEngineAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput & { trapScore: number }> {
  const t0 = Date.now();

  const traps = detectTraps(snapshot);
  const isSafe = traps.trapScore <= 0.2;

  // TrapEngine votes in the OPPOSITE of platform signal when it detects a trap
  let vote: AgentOutput["vote"] = "NEUTRAL";
  if (isSafe) {
    if (snapshot.signalDirection === "BUY") vote = "BUY";
    else if (snapshot.signalDirection === "SELL") vote = "SELL";
  } else {
    // Trapped: vote opposite or NEUTRAL depending on severity
    if (traps.trapScore > 0.5) {
      vote = snapshot.signalDirection === "BUY" ? "SELL" : "BUY";
    } else {
      vote = "NEUTRAL";
    }
  }

  const confidence = isSafe
    ? Math.max(0.5, 1 - traps.trapScore * 2)
    : Math.max(0.3, traps.trapScore);

  return {
    agentId: "trap_engine",
    agentName: "Trap Engine",
    vote,
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: {
      sources: ["cot_positioning", "timing_state", "atr_volatility", "news_sentiment"],
      features_used: [
        "cot.speculator_tilt",
        "timing.state",
        "timing.pressure",
        "atr_pct",
        "news.high_impact_count",
        "signal.direction",
        "signal.confidence",
      ],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: buildReasoning(traps, vote, snapshot),
    signals: {
      trapScore: traps.trapScore,
      fakeBreakoutRisk: traps.fakeBreakoutRisk,
      sweepRisk: traps.sweepRisk,
      absorptionHint: traps.absorptionHint,
      trapType: traps.trapType,
      isSafe,
    },
    trapScore: traps.trapScore,
    latencyMs: Date.now() - t0,
  };
}

function detectTraps(s: NormalizedSnapshot): TrapEngineSignals {
  let fakeBreakoutRisk = 0;
  let sweepRisk = 0;
  let absorptionHint = 0;
  let trapType: string | null = null;

  // Fake breakout: COT aligned with platform signal but EXTREME
  if (
    (s.cotTilt === "EXTREME_LONG" && s.signalDirection === "BUY") ||
    (s.cotTilt === "EXTREME_SHORT" && s.signalDirection === "SELL")
  ) {
    fakeBreakoutRisk = 0.6;
    trapType = "FAKE_BREAKOUT";
  }

  // Sweep risk: timing pressure extreme without confirmation
  if (s.timingPressure !== null && Math.abs(s.timingPressure) > 0.8) {
    sweepRisk = 0.4;
    if (!trapType) trapType = "SWEEP";
  }

  // Building state = data not settled = potential trap entry
  if (s.timingState === "BUILDING") {
    absorptionHint = 0.3;
    if (!trapType) trapType = "ABSORPTION";
  }

  // High news impact = potential liquidity grab
  if (s.newsHighImpactCount >= 4) {
    fakeBreakoutRisk = Math.max(fakeBreakoutRisk, 0.35);
    if (!trapType) trapType = "NEWS_TRAP";
  }

  // ATR spike: volatility expansion can mask traps
  if (s.atrPct !== null && s.atrPct > 0.007) {
    sweepRisk = Math.max(sweepRisk, 0.25);
  }

  // COT long + platform sell or vice versa = divergence = safe
  if (
    (s.cotTilt === "EXTREME_LONG" && s.signalDirection === "SELL") ||
    (s.cotTilt === "EXTREME_SHORT" && s.signalDirection === "BUY")
  ) {
    fakeBreakoutRisk = Math.max(0, fakeBreakoutRisk - 0.2);
  }

  const trapScore = Math.min(
    fakeBreakoutRisk * 0.5 + sweepRisk * 0.3 + absorptionHint * 0.2,
    1,
  );

  return { trapScore, fakeBreakoutRisk, sweepRisk, absorptionHint, trapType };
}

function buildReasoning(t: TrapEngineSignals, vote: string, s: NormalizedSnapshot): string {
  const parts: string[] = [];
  if (t.trapType) parts.push(`Detected trap type: ${t.trapType}`);
  parts.push(`Trap score: ${t.trapScore.toFixed(3)} (threshold=0.20)`);
  parts.push(`Fake breakout risk: ${t.fakeBreakoutRisk.toFixed(2)}, sweep risk: ${t.sweepRisk.toFixed(2)}, absorption: ${t.absorptionHint.toFixed(2)}`);
  if (s.cotTilt) parts.push(`COT tilt: ${s.cotTilt}`);
  parts.push(`Trap engine vote: ${vote}`);
  return parts.join(". ");
}
