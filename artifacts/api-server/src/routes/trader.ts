import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  traderSignalsTable,
  traderPositionsTable,
  traderCycleStateTable,
  traderEquityCurveTable,
} from "@workspace/db";
import {
  GetTraderAccountResponse,
  GetTraderSettingsResponse,
  UpdateTraderSettingsResponse,
  UpdateTraderSettingsBody,
  GetTraderSnapshotResponse,
  ListTraderSignalsResponseItem,
  GetTraderSignalResponse,
  ListTraderPositionsResponseItem,
  CloseTraderPositionResponse,
  RunTraderCycleResponse,
  ResetTraderAccountBody,
  GetTraderDashboardResponse,
  RejectTraderSignalBody,
} from "@workspace/api-zod";
import {
  computeEquityBreakdown,
  ensureSingletons,
  getAccount,
  getSettings,
  resetAccount,
  updateSettings,
  type SettingsState,
} from "../lib/trader/account.js";
import {
  fetchAndPersistSnapshot,
  getCurrentSpotPrice,
} from "../lib/trader/datasource.js";
import {
  approveSignal,
  ensureCycleStateRow,
  rejectSignal,
  runOneCycle,
} from "../lib/trader/executor.js";
import {
  closePosition,
  checkOpenPositionsForExit,
} from "../lib/trader/positions.js";
import {
  assessLiquidityTrap,
} from "../lib/trader/liquidity-trap.js";

const router: IRouter = Router();

function serializeAccount(
  acc: Awaited<ReturnType<typeof getAccount>>,
  eq: Awaited<ReturnType<typeof computeEquityBreakdown>>,
): unknown {
  return {
    balance: round2(acc.balance),
    equity: round2(eq.equity),
    startingBalance: round2(acc.startingBalance),
    realizedPnl: round2(acc.realizedPnl),
    unrealizedPnl: round2(eq.unrealizedPnl),
    peakEquity: round2(acc.peakEquity),
    currentDrawdownPct: Math.round(eq.drawdownPct * 100) / 100,
    dailyPnl: round2(acc.dailyPnl),
    dailyPnlResetAt: new Date(acc.dailyPnlResetAt).toISOString(),
    openPositions: eq.openPositions,
    tradesToday: eq.tradesToday,
    totalTrades: acc.totalTrades,
    winRate: eq.winRate,
    updatedAt: new Date(acc.updatedAt).toISOString(),
  };
}

function serializeSettings(s: SettingsState): unknown {
  return {
    executionMode: s.executionMode,
    tradingMode: s.tradingMode,
    riskPerTradePct: s.riskPerTradePct,
    dailyLossCapPct: s.dailyLossCapPct,
    maxOpenPositions: s.maxOpenPositions,
    maxTradesPerDay: s.maxTradesPerDay,
    minConfidence: s.minConfidence,
    minRiskReward: s.minRiskReward,
    requireAiConfirmation: s.requireAiConfirmation,
    aiConfirmCount: s.aiConfirmCount,
    signalExpirySec: s.signalExpirySec,
    updatedAt: new Date(s.updatedAt).toISOString(),
  };
}

function serializeSignal(row: typeof traderSignalsTable.$inferSelect): unknown {
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).toISOString(),
    tradingMode: row.tradingMode,
    executionMode: row.executionMode,
    direction: row.direction,
    confidence: row.confidence,
    sourceScore: row.sourceScore,
    entry: row.entry,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    riskReward: row.riskReward,
    atrAbs: row.atrAbs,
    sizeUnits: row.sizeUnits,
    riskAmount: row.riskAmount,
    rulesPassed: row.rulesPassed,
    aiPassed: row.aiPassed,
    aiVotersCount: row.aiVotersCount,
    aiAgreeCount: row.aiAgreeCount,
    status: row.status,
    rejectionReason: row.rejectionReason,
    positionId: row.positionId,
  };
}

function serializePosition(
  row: typeof traderPositionsTable.$inferSelect,
  spot: number | null,
): unknown {
  let unrealizedPnl: number | null = null;
  if (spot !== null && row.status === "OPEN") {
    const dir = row.side === "BUY" ? 1 : -1;
    unrealizedPnl =
      Math.round(dir * (spot - row.entry) * row.sizeUnits * 100) / 100;
  }
  return {
    id: row.id,
    signalId: row.signalId,
    side: row.side,
    entry: row.entry,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    sizeUnits: row.sizeUnits,
    riskAmount: row.riskAmount,
    openedAt: new Date(row.openedAt).toISOString(),
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    exitPrice: row.exitPrice,
    exitReason: row.exitReason,
    pnl: row.pnl,
    pnlR: row.pnlR,
    status: row.status,
    currentPrice: row.status === "OPEN" ? spot : null,
    unrealizedPnl,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

router.get("/trader/account", async (_req, res) => {
  await ensureSingletons();
  const acc = await getAccount();
  const eq = await computeEquityBreakdown(null);
  res.json(GetTraderAccountResponse.parse(serializeAccount(acc, eq)));
});

router.post("/trader/account/reset", async (req, res) => {
  const parsed = ResetTraderAccountBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const balance = parsed.data.startingBalance ?? 100000;
  await resetAccount(balance);
  const acc = await getAccount();
  const eq = await computeEquityBreakdown(null);
  res.json(GetTraderAccountResponse.parse(serializeAccount(acc, eq)));
});

router.get("/trader/settings", async (_req, res) => {
  const s = await getSettings();
  res.json(GetTraderSettingsResponse.parse(serializeSettings(s)));
});

router.patch("/trader/settings", async (req, res) => {
  const parsed = UpdateTraderSettingsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await updateSettings(parsed.data);
  res.json(UpdateTraderSettingsResponse.parse(serializeSettings(updated)));
});

router.get("/trader/snapshot", async (req, res) => {
  try {
    const { snapshot } = await fetchAndPersistSnapshot();
    res.json(GetTraderSnapshotResponse.parse(snapshot));
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.snapshot.failed",
    );
    res.status(503).json({
      error: `data source unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

router.get("/trader/signals", async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "ALL";
  const limit = Math.max(
    1,
    Math.min(200, Number(req.query.limit ?? 50) || 50),
  );
  const filters =
    status === "ALL" ? undefined : eq(traderSignalsTable.status, status);
  const rows = await (filters
    ? db
        .select()
        .from(traderSignalsTable)
        .where(filters)
        .orderBy(desc(traderSignalsTable.createdAt))
        .limit(limit)
    : db
        .select()
        .from(traderSignalsTable)
        .orderBy(desc(traderSignalsTable.createdAt))
        .limit(limit));
  res.json(rows.map((r) => ListTraderSignalsResponseItem.parse(serializeSignal(r))));
});

router.get("/trader/signals/:id", async (req, res) => {
  const id = req.params.id;
  const [row] = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "signal not found" });
    return;
  }
  const detail = {
    ...(serializeSignal(row) as Record<string, unknown>),
    snapshot: row.snapshotId ? await loadSnapshotPayload(row.snapshotId) : {
      fetchedAt: new Date(row.createdAt).toISOString(),
      sourceStatus: "unknown",
      symbol: "XAUUSD",
      spot: row.entry,
      signalDirection: row.direction,
      signalConfidence: row.confidence,
      signalScore: row.sourceScore,
      signalTakeProfits: [row.takeProfit],
      newsHighImpactCount: 0,
      drivers: [],
    },
    gates: row.gates ?? [],
    aiVotes: row.aiVotes ?? [],
  };
  res.json(GetTraderSignalResponse.parse(detail));
});

async function loadSnapshotPayload(id: string): Promise<unknown> {
  const { traderSnapshotsTable } = await import("@workspace/db");
  const [s] = await db
    .select()
    .from(traderSnapshotsTable)
    .where(eq(traderSnapshotsTable.id, id))
    .limit(1);
  if (!s) {
    return {
      fetchedAt: new Date().toISOString(),
      sourceStatus: "unknown",
      symbol: "XAUUSD",
      spot: 0,
      signalDirection: "NEUTRAL",
      signalConfidence: 0,
      signalScore: 0,
      signalTakeProfits: [],
      newsHighImpactCount: 0,
      drivers: [],
    };
  }
  return s.payload;
}

router.post("/trader/signals/:id/approve", async (req, res) => {
  const r = await approveSignal(req.params.id);
  if (!r.ok) {
    res.status(409).json({ error: r.reason ?? "cannot approve" });
    return;
  }
  const [row] = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.id, req.params.id))
    .limit(1);
  const detail = {
    ...(serializeSignal(row!) as Record<string, unknown>),
    snapshot: row!.snapshotId ? await loadSnapshotPayload(row!.snapshotId) : null,
    gates: row!.gates ?? [],
    aiVotes: row!.aiVotes ?? [],
  };
  res.json(GetTraderSignalResponse.parse(detail));
});

router.post("/trader/signals/:id/reject", async (req, res) => {
  const parsed = RejectTraderSignalBody.safeParse(req.body ?? {});
  const reason = parsed.success ? parsed.data.reason ?? "" : "";
  const ok = await rejectSignal(req.params.id, reason);
  if (!ok) {
    res.status(409).json({ error: "cannot reject (not pending)" });
    return;
  }
  const [row] = await db
    .select()
    .from(traderSignalsTable)
    .where(eq(traderSignalsTable.id, req.params.id))
    .limit(1);
  res.json(ListTraderSignalsResponseItem.parse(serializeSignal(row!)));
});

router.get("/trader/positions", async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "ALL";
  const limit = Math.max(
    1,
    Math.min(200, Number(req.query.limit ?? 50) || 50),
  );
  const filters =
    status === "ALL" ? undefined : eq(traderPositionsTable.status, status);
  const rows = await (filters
    ? db
        .select()
        .from(traderPositionsTable)
        .where(filters)
        .orderBy(desc(traderPositionsTable.openedAt))
        .limit(limit)
    : db
        .select()
        .from(traderPositionsTable)
        .orderBy(desc(traderPositionsTable.openedAt))
        .limit(limit));
  let spot: number | null = null;
  if (rows.some((r) => r.status === "OPEN")) {
    try {
      spot = await getCurrentSpotPrice();
    } catch {
      spot = null;
    }
  }
  res.json(
    rows.map((r) =>
      ListTraderPositionsResponseItem.parse(serializePosition(r, spot)),
    ),
  );
});

router.post("/trader/positions/:id/close", async (req, res) => {
  let spot: number;
  try {
    spot = await getCurrentSpotPrice();
  } catch (err) {
    res.status(503).json({
      error: `cannot fetch spot to close: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  const result = await closePosition(req.params.id, spot, "MANUAL");
  if (!result) {
    res.status(409).json({ error: "position not open or not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(traderPositionsTable)
    .where(eq(traderPositionsTable.id, req.params.id))
    .limit(1);
  res.json(CloseTraderPositionResponse.parse(serializePosition(row!, spot)));
});

router.post("/trader/cycle/run", async (_req, res) => {
  const result = await runOneCycle();
  res.json(RunTraderCycleResponse.parse(result));
});

// ── Multi-Agent Consensus: dry-run JSON (no trade committed) ─────────────
router.get("/trader/decision", async (req, res) => {
  try {
    const { runConsensus } = await import("../lib/trader/consensus.js");
    const { snapshot } = await fetchAndPersistSnapshot();
    const verdict = await runConsensus(snapshot);
    res.json(verdict);
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.decision.failed",
    );
    res.status(503).json({
      error: `decision engine failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// ── Multi-Agent Consensus: SSE streaming (live per-agent progress) ────────
router.get("/trader/decision/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  try {
    send("status", { stage: "fetching", messageAr: "جارٍ جلب بيانات السوق الحية من المصدر..." });

    const { snapshot } = await fetchAndPersistSnapshot();

    send("snapshot", {
      spot: snapshot.spot,
      direction: snapshot.signalDirection,
      confidence: snapshot.signalConfidence,
      atrAbs: snapshot.atrAbs,
      sourceStatus: snapshot.sourceStatus,
    });

    const { runConsensusWithProgress } = await import("../lib/trader/consensus.js");

    const verdict = await runConsensusWithProgress(
      snapshot,
      (event, agentId, output, elapsedMs) => {
        if (event === "start") {
          send("agent_start", { agentId });
        } else {
          send("agent_done", {
            agentId,
            vote: output?.vote,
            confidence: output?.confidence,
            elapsedMs,
            entryZone: output?.entryZone ?? null,
          });
        }
      },
    );

    send("verdict", verdict);
    res.end();
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.decision.stream.failed",
    );
    send("error", { message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

// ── Vision Agent: ingest frame from external source (Bookmap/heatmap) ────
router.post("/trader/ingest/frame", async (req, res) => {
  try {
    const { ingestFrame, getFrameBuffer } = await import("../lib/trader/agents/vision.js");
    const body = req.body as Record<string, unknown>;

    const clusters = Array.isArray(body.clusters) ? body.clusters : [];
    const labels = Array.isArray(body.labels)
      ? (body.labels as unknown[]).filter((l): l is string => typeof l === "string")
      : [];
    const timestamp = typeof body.timestamp === "string"
      ? body.timestamp
      : new Date().toISOString();
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;

    ingestFrame({ clusters: clusters as Parameters<typeof ingestFrame>[0]["clusters"], labels, timestamp, sourceUrl });
    const buf = getFrameBuffer();
    res.json({ ok: true, bufferedFrames: buf.length, timestamp });
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trader.ingest.frame.failed",
    );
    res.status(400).json({ error: String(err) });
  }
});

router.get("/trader/sweep", async (req, res) => {
  try {
    const { snapshot } = await fetchAndPersistSnapshot();
    const queryDir = req.query["direction"] as string | undefined;
    let direction: "BUY" | "SELL";
    if (queryDir === "BUY" || queryDir === "SELL") {
      direction = queryDir;
    } else if (snapshot.signalDirection === "BUY" || snapshot.signalDirection === "SELL") {
      direction = snapshot.signalDirection;
    } else {
      res.status(400).json({ error: "no directional signal available — pass ?direction=BUY|SELL" });
      return;
    }
    const slDistance = Math.abs((snapshot.signalEntry ?? snapshot.spot) - (snapshot.signalStopLoss ?? (snapshot.spot - (snapshot.atrAbs ?? 12) * 0.25)));
    const assessment = await assessLiquidityTrap(snapshot, direction, slDistance);
    res.json(assessment);
  } catch (err) {
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, "trader.sweep.error");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/trader/dashboard", async (_req, res) => {
  await ensureSingletons();
  await ensureCycleStateRow();
  const [settings, account, openPositions, recentSignals, cycleRows, equityRows] =
    await Promise.all([
      getSettings(),
      getAccount(),
      db
        .select()
        .from(traderPositionsTable)
        .where(eq(traderPositionsTable.status, "OPEN"))
        .orderBy(desc(traderPositionsTable.openedAt))
        .limit(20),
      db
        .select()
        .from(traderSignalsTable)
        .orderBy(desc(traderSignalsTable.createdAt))
        .limit(15),
      db.select().from(traderCycleStateTable).limit(1),
      db
        .select()
        .from(traderEquityCurveTable)
        .orderBy(desc(traderEquityCurveTable.t))
        .limit(120),
    ]);

  let spot: number | null = null;
  let snapshotJson: unknown = null;
  try {
    const { snapshot } = await fetchAndPersistSnapshot();
    spot = snapshot.spot;
    snapshotJson = snapshot;
    if (openPositions.length > 0) {
      await checkOpenPositionsForExit(spot);
    }
  } catch {
    /* leave snapshot null */
  }

  const equityBreakdown = await computeEquityBreakdown(spot);
  const cycle = cycleRows[0];

  const out = {
    account: serializeAccount(account, equityBreakdown),
    settings: serializeSettings(settings),
    snapshot: snapshotJson,
    openPositions: openPositions.map((p) => serializePosition(p, spot)),
    recentSignals: recentSignals.map(serializeSignal),
    lastCycleAt: cycle?.lastCycleAt
      ? new Date(cycle.lastCycleAt).toISOString()
      : null,
    nextCycleAt: cycle?.nextCycleAt
      ? new Date(cycle.nextCycleAt).toISOString()
      : null,
    cycleRunning: cycle?.running ?? false,
    equityCurve: equityRows
      .slice()
      .reverse()
      .map((r) => ({ t: new Date(r.t).toISOString(), equity: r.equity })),
  };

  res.json(GetTraderDashboardResponse.parse(out));
});

export default router;
