import { logger } from "../logger";

export type LinkTestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
};

export type BenchmarkResult = {
  success: boolean;
  latencyMs: number;
  tps: number;
  quality: number;
  status: number;
  error?: string;
};

export async function healthCheck(url: string): Promise<LinkTestResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "model-orchestrator/0.1" },
    });
    return {
      ok: r.status >= 200 && r.status < 500,
      status: r.status,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const PROBE_PROMPT = "Reply with the single word: ping";
const APPROX_TOKENS = 8;

function buildProbePayload(
  type: string,
): { body: unknown; headers: Record<string, string> } {
  if (type === "embedding") {
    return {
      body: { input: "ping", model: "text-embedding-3-small" },
      headers: { "Content-Type": "application/json" },
    };
  }
  if (type === "image") {
    return {
      body: { prompt: "ping", n: 1, size: "256x256" },
      headers: { "Content-Type": "application/json" },
    };
  }
  if (type === "audio") {
    return {
      body: { input: "ping", model: "tts-1", voice: "alloy" },
      headers: { "Content-Type": "application/json" },
    };
  }
  return {
    body: {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: PROBE_PROMPT }],
      max_tokens: APPROX_TOKENS,
      stream: false,
    },
    headers: { "Content-Type": "application/json" },
  };
}

export async function benchmark(
  url: string,
  type: string,
): Promise<BenchmarkResult> {
  const { body, headers } = buildProbePayload(type);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { ...headers, "User-Agent": "model-orchestrator/0.1" },
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - t0;
    const text = await r.text().catch(() => "");
    const success = r.status >= 200 && r.status < 300;
    const quality = scoreQuality(text, success);
    const tps = success
      ? APPROX_TOKENS / Math.max(latencyMs / 1000, 0.001)
      : 0;
    return {
      success,
      latencyMs,
      tps,
      quality,
      status: r.status,
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - t0,
      tps: 0,
      quality: 0,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function scoreQuality(body: string, ok: boolean): number {
  if (!ok || !body) return 0;
  const lc = body.toLowerCase();
  let q = 0.5;
  if (lc.includes("ping")) q += 0.2;
  if (lc.includes('"choices"') || lc.includes("content")) q += 0.15;
  if (lc.includes('"data"') || lc.includes("embedding")) q += 0.1;
  if (lc.includes("error")) q -= 0.3;
  return Math.max(0, Math.min(q, 1));
}

export async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) break;
        try {
          results[idx] = await worker(items[idx]!);
        } catch (err) {
          logger.warn({ err, idx }, "worker error");
        }
        done += 1;
        onProgress?.(done, items.length);
      }
    });
  await Promise.all(workers);
  return results;
}
