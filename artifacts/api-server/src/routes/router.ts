import { Router, type IRouter } from "express";
import { eq, and, asc, desc, notInArray } from "drizzle-orm";
import { db, modelsTable } from "@workspace/db";
import { RouteRequestBody, RouteRequestResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/route", async (req, res): Promise<void> => {
  const parsed = RouteRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { taskType, modelType, excludeIds } = parsed.data;

  const filters = [eq(modelsTable.status, "ACTIVE")];
  if (modelType !== "ALL") {
    const effectiveType = taskType === "embedding" ? "embedding" : modelType;
    filters.push(eq(modelsTable.type, effectiveType));
  }
  if (excludeIds && excludeIds.length > 0) {
    filters.push(notInArray(modelsTable.id, excludeIds));
  }

  const orderExpr =
    taskType === "realtime"
      ? asc(modelsTable.latencyMs)
      : taskType === "analysis"
        ? desc(modelsTable.score)
        : desc(modelsTable.score);

  const candidates = await db
    .select()
    .from(modelsTable)
    .where(and(...filters))
    .orderBy(orderExpr)
    .limit(6);

  if (candidates.length === 0) {
    res.status(404).json({
      error: "No active model matches the selection.",
    });
    return;
  }

  const [selected, ...fallbacks] = candidates;

  const reason =
    taskType === "realtime"
      ? `Selected ${selected!.name} for lowest latency (${Math.round(selected!.latencyMs ?? 0)} ms).`
      : taskType === "analysis"
        ? `Selected ${selected!.name} for highest overall score (${selected!.score.toFixed(3)}).`
        : taskType === "embedding"
          ? `Selected ${selected!.name} as the top embedding model by score.`
          : `Selected ${selected!.name} for best balanced score (${selected!.score.toFixed(3)}).`;

  res.json(
    RouteRequestResponse.parse({
      taskType,
      selected,
      fallbacks,
      reason,
    }),
  );
});

export default router;
