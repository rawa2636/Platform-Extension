import { Router, type IRouter } from "express";
import { sql, eq, desc } from "drizzle-orm";
import { db, modelsTable, harvestRunsTable } from "@workspace/db";
import { GetStatsResponse } from "@workspace/api-zod";
import { getNextScheduledAt } from "../lib/harvester/scheduler";

const router: IRouter = Router();

router.get("/stats", async (_req, res): Promise<void> => {
  const counts = await db
    .select({
      status: modelsTable.status,
      c: sql<number>`COUNT(*)::int`,
    })
    .from(modelsTable)
    .groupBy(modelsTable.status);

  const byType = await db
    .select({
      type: modelsTable.type,
      c: sql<number>`COUNT(*)::int`,
    })
    .from(modelsTable)
    .groupBy(modelsTable.type);

  const aggRows = await db
    .select({
      avgScore: sql<number | null>`AVG(${modelsTable.score})::float`,
      avgLatencyMs: sql<number | null>`AVG(${modelsTable.latencyMs})::float`,
      avgTps: sql<number | null>`AVG(${modelsTable.tps})::float`,
    })
    .from(modelsTable)
    .where(eq(modelsTable.status, "ACTIVE"));
  const agg = aggRows[0] ?? { avgScore: null, avgLatencyMs: null, avgTps: null };

  const [lastRun] = await db
    .select()
    .from(harvestRunsTable)
    .orderBy(desc(harvestRunsTable.startedAt))
    .limit(1);

  const get = (s: string): number => counts.find((c) => c.status === s)?.c ?? 0;

  res.json(
    GetStatsResponse.parse({
      totalModels: counts.reduce((a, b) => a + b.c, 0),
      activeModels: get("ACTIVE"),
      slowModels: get("SLOW"),
      failedModels: get("FAIL"),
      archivedModels: get("ARCHIVED"),
      avgScore: agg.avgScore,
      avgLatencyMs: agg.avgLatencyMs,
      avgTps: agg.avgTps,
      lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
      nextRunAt: getNextScheduledAt(),
      typeBreakdown: byType.map((b) => ({ type: b.type, count: b.c })),
    }),
  );
});

export default router;
