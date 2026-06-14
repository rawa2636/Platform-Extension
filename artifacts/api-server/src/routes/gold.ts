import { Router } from "express";
import { getGoldState, goldEvents } from "../lib/trader/gold-platform.js";

const router = Router();

router.get("/gold/price", (_req, res) => {
  const { latestTick } = getGoldState();
  if (!latestTick) {
    res.status(503).json({ error: "no price data yet" });
    return;
  }
  res.json({
    bid: latestTick.bid,
    ask: latestTick.ask,
    mid: latestTick.mid,
    spread: +(latestTick.ask - latestTick.bid).toFixed(4),
    ts: latestTick.ts,
  });
});

router.get("/gold/ticks", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { ticks } = getGoldState();
  res.json(ticks.slice(-limit));
});

router.get("/gold/orderbook", (_req, res) => {
  const { orderBook } = getGoldState();
  if (!orderBook) {
    res.json({ bids: [], asks: [], updatedAt: null });
    return;
  }
  res.json(orderBook);
});

router.get("/gold/summary", (_req, res) => {
  const { summary } = getGoldState();
  if (!summary) {
    res.status(503).json({ error: "no summary data yet" });
    return;
  }
  res.json(summary);
});

router.get("/gold/orderflow", (_req, res) => {
  const { orderFlow } = getGoldState();
  if (!orderFlow) {
    res.status(503).json({ error: "no orderflow data yet" });
    return;
  }
  res.json(orderFlow);
});

router.get("/gold/liquidity/zones", (_req, res) => {
  res.json(getGoldState().liquidityZones);
});

router.get("/gold/status", (_req, res) => {
  const { connected, lastTickAt } = getGoldState();
  res.json({
    connected,
    lastTickAt,
    stale: lastTickAt !== null && Date.now() - lastTickAt > 5000,
  });
});

// Full snapshot — all data at once
router.get("/gold/snapshot", (_req, res) => {
  const s = getGoldState();
  res.json({
    connected: s.connected,
    lastTickAt: s.lastTickAt,
    latestTick: s.latestTick,
    recentTicks: s.ticks.slice(-200),
    orderBook: s.orderBook,
    summary: s.summary,
    orderFlow: s.orderFlow,
    liquidityZones: s.liquidityZones,
  });
});

// SSE proxy — forwards 10Hz ticks from gold platform to browser
router.get("/gold/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: unknown) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  // Send current price immediately on connect
  const { latestTick, orderBook } = getGoldState();
  if (latestTick) send({ type: "tick", ...latestTick });
  if (orderBook) send({ type: "orderbook", ...orderBook });

  const onTick = (tick: unknown) => send({ type: "tick", ...(tick as object) });
  const onBook = (book: unknown) => send({ type: "orderbook", ...(book as object) });

  goldEvents.on("tick", onTick);
  goldEvents.on("orderbook", onBook);

  req.on("close", () => {
    goldEvents.off("tick", onTick);
    goldEvents.off("orderbook", onBook);
  });
});

export default router;
