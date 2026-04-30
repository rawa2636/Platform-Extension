export type ScoreInputs = {
  ok: boolean;
  latencyMs: number;
  tps: number;
  success: boolean;
  quality: number;
};

export function computeScore(x: ScoreInputs): number {
  if (!x.ok) return 0;
  const latNorm = 1 / Math.max(x.latencyMs, 1);
  const tpsNorm = Math.min(x.tps, 100) / 100;
  const succ = x.success ? 1 : 0;
  const q = x.quality;
  const raw =
    0.35 * (latNorm * 200) +
    0.3 * tpsNorm +
    0.2 * succ +
    0.15 * q;
  return Math.max(0, Math.min(raw, 1));
}

export function classify(
  score: number,
  ok: boolean,
  latencyMs: number,
): "ACTIVE" | "SLOW" | "FAIL" {
  if (!ok) return "FAIL";
  if (latencyMs > 3000 || score < 0.25) return "SLOW";
  return "ACTIVE";
}
