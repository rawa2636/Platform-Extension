import { Router, type IRouter } from "express";
import { eq, sql, desc, asc, and, ne } from "drizzle-orm";
import { db, modelsTable, modelHistoryTable } from "@workspace/db";
import {
  ListModelsQueryParams,
  ListModelsResponse,
  GetTopModelsQueryParams,
  GetTopModelsResponse,
  GetActiveModelsResponse,
  GetModelParams,
  GetModelResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/models", async (req, res): Promise<void> => {
  const parsed = ListModelsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, type, sort, limit, offset } = parsed.data;

  const filters = [] as ReturnType<typeof eq>[];
  if (status !== "ALL") filters.push(eq(modelsTable.status, status));
  if (type !== "ALL") filters.push(eq(modelsTable.type, type));
  const where = filters.length ? and(...filters) : undefined;

  const orderColumn =
    sort === "score"
      ? modelsTable.score
      : sort === "latency"
        ? modelsTable.latencyMs
        : sort === "tps"
          ? modelsTable.tps
          : modelsTable.lastChecked;

  const orderExpr = sort === "latency" ? asc(orderColumn) : desc(orderColumn);

  const items = await db
    .select()
    .from(modelsTable)
    .where(where ?? sql`TRUE`)
    .orderBy(orderExpr)
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(modelsTable)
    .where(where ?? sql`TRUE`);
  const total = totalRows[0]?.c ?? 0;

  res.json(
    ListModelsResponse.parse({
      items,
      total,
      limit,
      offset,
    }),
  );
});

router.get("/models/top", async (req, res): Promise<void> => {
  const parsed = GetTopModelsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit, type } = parsed.data;
  const filters = [eq(modelsTable.status, "ACTIVE")];
  if (type !== "ALL") filters.push(eq(modelsTable.type, type));

  const items = await db
    .select()
    .from(modelsTable)
    .where(and(...filters))
    .orderBy(desc(modelsTable.score))
    .limit(limit);

  res.json(GetTopModelsResponse.parse(items));
});

router.get("/models/active", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.status, "ACTIVE"))
    .orderBy(desc(modelsTable.score));
  res.json(GetActiveModelsResponse.parse(items));
});

router.get("/models/:id", async (req, res): Promise<void> => {
  const params = GetModelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [model] = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.id, params.data.id))
    .limit(1);

  if (!model) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const history = await db
    .select({
      runId: modelHistoryTable.runId,
      timestamp: modelHistoryTable.timestamp,
      latencyMs: modelHistoryTable.latencyMs,
      tps: modelHistoryTable.tps,
      score: modelHistoryTable.score,
      status: modelHistoryTable.status,
    })
    .from(modelHistoryTable)
    .where(eq(modelHistoryTable.modelId, params.data.id))
    .orderBy(desc(modelHistoryTable.timestamp))
    .limit(50);

  res.json(GetModelResponse.parse({ ...model, history: history.reverse() }));
});

export default router;
