export type TradingMode = "DAILY" | "MID";
export type ExecutionMode = "OFF" | "MANUAL" | "AUTO";
export type Direction = "BUY" | "SELL";
export type SignalDirection = Direction | "NEUTRAL";

export interface ModeConfig {
  name: TradingMode;
  timeframe: string;
  atrMult: number;
  rrTarget: number;
  updateIntervalSec: number;
}

export const MODE_CONFIGS: Record<TradingMode, ModeConfig> = {
  DAILY: {
    name: "DAILY",
    timeframe: "D1",
    atrMult: 1.8,
    rrTarget: 1.8,
    updateIntervalSec: 300,
  },
  MID: {
    name: "MID",
    timeframe: "H4",
    atrMult: 1.3,
    rrTarget: 1.5,
    updateIntervalSec: 180,
  },
};

export const SOURCE_BASE_URL =
  process.env.GOLD_SOURCE_URL ??
  "https://source-bootstrap-11--mohamthana.replit.app";

// Forward-declared type — filled by smart-money-radar.ts before consensus
export interface SmartMoneyRadar {
  // Herd stop clusters (retail stop positions — the "fuel")
  herdClustersBelow: HerdStopCluster[];
  herdClustersAbove: HerdStopCluster[];
  primarySweepTarget: HerdStopCluster | null;

  // Sweep mechanics
  sweepDirection: "DOWN_FIRST" | "UP_FIRST" | "UNCLEAR";
  sweepProbability: number;
  expectedSweepDepthLow: number;
  expectedSweepDepthHigh: number;
  fuelScore: number;

  // Post-sweep entry
  entryAllowed: boolean;
  recommendedEntry: number;
  blockReason: string | null;
  sweepZone: { low: number; high: number; label: string } | null;

  // Institutional equilibrium (the real TP target — where smart money unloads)
  institutionalEquilibrium: InstitutionalEquilibrium | null;

  // ML Memory
  historicalAvgDepth: number | null;

  computedAt: string;
}

export interface HerdStopCluster {
  price: number;
  label: string;
  density: number;
  distance: number;
  side: "above" | "below";
  fuelScore: number;
}

export interface InstitutionalEquilibrium {
  price: number;
  label: string;
  direction: "above" | "below";
  distanceFromSpot: number;
  confidence: number;
}

export interface NormalizedSnapshot {
  fetchedAt: string;
  sourceStatus: string;
  symbol: string;
  spot: number;
  atrPct: number | null;
  atrAbs: number | null;
  signalDirection: SignalDirection;
  signalConfidence: number;
  signalScore: number;
  signalEntry: number | null;
  signalStopLoss: number | null;
  signalTakeProfits: number[];
  signalRiskReward: number | null;
  timingState: string | null;
  timingPressure: number | null;
  macroSummary: Record<string, unknown>;
  cotTilt: string | null;
  newsHighImpactCount: number;
  drivers: string[];
  rawPayload: unknown;
  // Injected by smart-money-radar BEFORE consensus runs
  smRadar?: SmartMoneyRadar;
}

export interface GateDecision {
  gate: string;
  passed: boolean;
  reason: string;
  value?: number | null;
  threshold?: number | null;
}

export interface AiVote {
  modelId: string;
  modelName: string;
  direction: "BUY" | "SELL" | "NEUTRAL" | "ABSTAIN";
  rationale: string | null;
  latencyMs: number | null;
  agreed: boolean;
}
