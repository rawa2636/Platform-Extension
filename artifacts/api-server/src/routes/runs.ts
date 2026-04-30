import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, harvestRunsTable } from "@workspace/db";
import {
  ListRunsQueryParams,
  ListRunsResponse,
  GetLatestRunResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/runs", async (req, res): Promise<void> => {
  const parsed = ListRunsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const items = await db
    .select()
    .from(harvestRunsTable)
    .orderBy(desc(harvestRunsTable.startedAt))
    .limit(parsed.data.limit);

  res.json(ListRunsResponse.parse(items));
});

router.get("/runs/latest", async (_req, res): Promise<void> => {
  const [latest] = await db
    .select()
    .from(harvestRunsTable)
    .orderBy(desc(harvestRunsTable.startedAt))
    .limit(1);

  if (!latest) {
    res.status(404).json({ error: "No runs yet" });
    return;
  }

  res.json(GetLatestRunResponse.parse(latest));
});

export default router;
