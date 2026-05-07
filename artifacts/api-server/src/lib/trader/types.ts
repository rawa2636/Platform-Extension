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
