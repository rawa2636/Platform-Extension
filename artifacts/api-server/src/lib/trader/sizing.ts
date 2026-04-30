import type { SettingsState, EquityBreakdown } from "./account.js";

export interface SizingResult {
  sizeUnits: number;
  riskAmount: number;
}

export function computePositionSize(
  entry: number,
  stopLoss: number,
  settings: SettingsState,
  equity: EquityBreakdown,
): SizingResult {
  const slDist = Math.abs(entry - stopLoss);
  if (!Number.isFinite(slDist) || slDist <= 0) {
    return { sizeUnits: 0, riskAmount: 0 };
  }
  const riskAmount = (settings.riskPerTradePct / 100) * equity.equity;
  const sizeUnits = riskAmount / slDist;
  return {
    sizeUnits: Math.round(sizeUnits * 10000) / 10000,
    riskAmount: Math.round(riskAmount * 100) / 100,
  };
}
