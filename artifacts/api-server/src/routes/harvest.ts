import { Router, type IRouter } from "express";
import { GetHarvestStatusResponse } from "@workspace/api-zod";
import {
  startHarvestRun,
  getLiveStatus,
  getLastFinishedAt,
} from "../lib/harvester/orchestrator";
import { getNextScheduledAt } from "../lib/harvester/scheduler";

const router: IRouter = Router();

router.post("/harvest/run", async (req, res): Promise<void> => {
  try {
    const runId = await startHarvestRun();
    res.status(202).json({ runId, status: "RUNNING" });
  } catch (err) {
    req.log.warn({ err }, "harvest run rejected");
    res.status(409).json({
      error:
        err instanceof Error ? err.message : "Could not start harvest run",
    });
  }
});

router.get("/harvest/status", async (_req, res): Promise<void> => {
  const live = getLiveStatus();
  const lastFinishedAt = await getLastFinishedAt();
  const nextScheduledAt = getNextScheduledAt();

  res.json(
    GetHarvestStatusResponse.parse({
      running: live.running,
      currentRunId: live.currentRunId,
      stage: live.stage,
      progress: live.progress,
      startedAt: live.startedAt,
      lastFinishedAt,
      nextScheduledAt,
    }),
  );
});

export default router;
