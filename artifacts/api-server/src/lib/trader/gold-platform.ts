import { EventEmitter } from "node:events";
import { logger } from "../logger.js";

const GOLD_BASE = process.env.GOLD_PLATFORM_URL ?? "https://gold-platform--mohamadrawa.replit.app/api";
const TICK_BUFFER = 500;

export interface GoldTick {
  bid: number;
  ask: number;
  mid: number;
  ts: number;
  size?: number;
  side?: string;
}

export interface GoldOrderBook {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  updatedAt: number;
}

export interface GoldSummary {
  dominantFlow: string;
  liquidityState: string;
  institutionalScore: number;
  session: string;
  updatedAt: number;
}

export interface GoldOrderFlow {
  delta: number;
  cumulativeDelta: number;
  absorption: number;
  exhaustion: number;
  updatedAt: number;
}

export interface GoldLiquidityZone {
  priceLevel: number;
  zoneType: string;
  strength: number;
  description: string;
}

export interface GoldState {
  connected: boolean;
  lastTickAt: number | null;
  latestTick: GoldTick | null;
  ticks: GoldTick[];
  orderBook: GoldOrderBook | null;
  summary: GoldSummary | null;
  orderFlow: GoldOrderFlow | null;
  liquidityZones: GoldLiquidityZone[];
}

export const goldEvents = new EventEmitter();
goldEvents.setMaxListeners(500);

const _state: GoldState = {
  connected: false,
  lastTickAt: null,
  latestTick: null,
  ticks: [],
  orderBook: null,
  summary: null,
  orderFlow: null,
  liquidityZones: [],
};

export function getGoldState(): Readonly<GoldState> {
  return _state;
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

async function fetchRest<T>(path: string, ms = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${GOLD_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── SSE stream ───────────────────────────────────────────────────────────────
async function connectStream(): Promise<void> {
  for (;;) {
    try {
      const ctrl = new AbortController();
      const res = await fetch(`${GOLD_BASE}/gold/stream`, {
        signal: ctrl.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        _state.connected = false;
        await sleep(3000);
        continue;
      }

      _state.connected = true;
      logger.info({ base: GOLD_BASE }, "gold-platform.stream.connected");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const bid = asNum(d.bid);
              const ask = asNum(d.ask);
              const tick: GoldTick = {
                bid,
                ask,
                mid: asNum(d.mid) || (bid + ask) / 2,
                ts: asNum(d.ts) || Date.now(),
                size: d.size !== undefined ? asNum(d.size) : undefined,
                side: asStr(d.side) || undefined,
              };
              _state.latestTick = tick;
              _state.lastTickAt = Date.now();
              _state.ticks.push(tick);
              if (_state.ticks.length > TICK_BUFFER) _state.ticks.shift();
              goldEvents.emit("tick", tick);
            } catch { /* malformed */ }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, "gold-platform.stream.error");
    }
    _state.connected = false;
    await sleep(2000);
  }
}

// ── REST pollers ─────────────────────────────────────────────────────────────
async function pollOrderBook() {
  const raw = await fetchRest<Record<string, unknown>>("/gold/orderbook?depth=20");
  if (!raw) return;
  const mapLevels = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).map((x: unknown) => {
      const r = x as Record<string, unknown>;
      return { price: asNum(r.price), size: asNum(r.size) };
    });
  _state.orderBook = {
    bids: mapLevels(raw.bids),
    asks: mapLevels(raw.asks),
    updatedAt: Date.now(),
  };
  goldEvents.emit("orderbook", _state.orderBook);
}

async function pollSummary() {
  const raw = await fetchRest<Record<string, unknown>>("/gold/summary");
  if (!raw) return;
  _state.summary = {
    dominantFlow: asStr(raw.dominantFlow, "neutral"),
    liquidityState: asStr(raw.liquidityState, "normal"),
    institutionalScore: asNum(raw.institutionalScore),
    session: asStr(raw.session, "unknown"),
    updatedAt: Date.now(),
  };
}

async function pollOrderFlow() {
  const raw = await fetchRest<Record<string, unknown>>("/gold/orderflow");
  if (!raw) return;
  _state.orderFlow = {
    delta: asNum(raw.delta),
    cumulativeDelta: asNum(raw.cumulativeDelta),
    absorption: asNum(raw.absorption),
    exhaustion: asNum(raw.exhaustion),
    updatedAt: Date.now(),
  };
}

async function pollLiquidityZones() {
  const raw = await fetchRest<unknown[]>("/gold/liquidity/zones");
  if (!Array.isArray(raw)) return;
  _state.liquidityZones = raw.map((z) => {
    const zone = z as Record<string, unknown>;
    return {
      priceLevel: asNum(zone.priceLevel),
      zoneType: asStr(zone.zoneType, "unknown"),
      strength: asNum(zone.strength),
      description: asStr(zone.description),
    };
  });
}

async function runPollers() {
  await Promise.allSettled([pollOrderBook(), pollSummary(), pollOrderFlow(), pollLiquidityZones()]);
  setInterval(() => pollOrderBook().catch(() => {}), 2000);
  setInterval(() => pollSummary().catch(() => {}), 5000);
  setInterval(() => pollOrderFlow().catch(() => {}), 2000);
  setInterval(() => pollLiquidityZones().catch(() => {}), 10_000);
}

export function initGoldPlatform(): void {
  connectStream().catch((err) => logger.error({ err }, "gold-platform.stream.fatal"));
  runPollers().catch((err) => logger.error({ err }, "gold-platform.pollers.fatal"));
  logger.info({ base: GOLD_BASE }, "gold-platform.initialized");
}
