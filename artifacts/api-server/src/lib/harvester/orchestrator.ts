import { eq, sql } from "drizzle-orm";
import { db, harvestRunsTable } from "@workspace/db";
import { logger } from "../logger";
import { discoverEndpoints, fetchSourceCommit } from "./extractor";
import { healthCheck, benchmark, withConcurrencyLimit } from "./tester";
import { computeScore, classify } from "./scoring";
import {
  upsertModel,
  recordHistory,
  applyRanking,
  archiveStale,
} from "./registry";
import { randomUUID } from "node:crypto";

export type RunStage =
  | "discovering"
  | "testing"
  | "benchmarking"
  | "ranking"
  | "finalizing";

type LiveStatus = {
  running: boolean;
  currentRunId: string | null;
  stage: RunStage | null;
  progress: number | null;
  startedAt: Date | null;
};

const liveStatus: LiveStatus = {
  running: false,
  currentRunId: null,
  stage: null,
  progress: null,
  startedAt: null,
};

export function getLiveStatus(): LiveStatus {
  return { ...liveStatus };
}

export function isHarvestRunning(): boolean {
  return liveStatus.running;
}

const MAX_LINKS_PER_RUN = 80;

async function setRunStage(
  runId: string,
  stage: RunStage,
  progress: number,
): Promise<void> {
  liveStatus.stage = stage;
  liveStatus.progress = progress;
  await db
    .update(harvestRunsTable)
    .set({ stage, progress })
    .where(eq(harvestRunsTable.id, runId));
}

export async function startHarvestRun(): Promise<string> {
  if (liveStatus.running) {
    throw new Error("A harvest run is already in progress.");
  }
  const runId = `run_${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();

  await db.insert(harvestRunsTable).values({
    id: runId,
    status: "RUNNING",
    startedAt,
    stage: "discovering",
    progress: 0,
  });

  liveStatus.running = true;
  liveStatus.currentRunId = runId;
  liveStatus.stage = "discovering";
  liveStatus.progress = 0;
  liveStatus.startedAt = startedAt;

  // Fire and forget. Errors are caught inside.
  void runHarvestPipeline(runId).catch((err) => {
    logger.error({ err, runId }, "harvest pipeline crashed");
  });

  return runId;
}

async function runHarvestPipeline(runId: string): Promise<void> {
  const t0 = Date.now();
  try {
    logger.info({ runId }, "harvest run started");
    const sourceCommit = await fetchSourceCommit();
    if (sourceCommit) {
      await db
        .update(harvestRunsTable)
        .set({ sourceCommit })
        .where(eq(harvestRunsTable.id, runId));
    }

    await setRunStage(runId, "discovering", 0.05);
    const allDiscovered = await discoverEndpoints();
    const discovered = allDiscovered.slice(0, MAX_LINKS_PER_RUN);
    logger.info(
      { runId, discovered: discovered.length, total: allDiscovered.length },
      "discovery done",
    );
    await db
      .update(harvestRunsTable)
      .set({ linksDiscovered: discovered.length })
      .where(eq(harvestRunsTable.id, runId));

    await setRunStage(runId, "testing", 0.2);

    type TestRecord = {
      idx: number;
      ok: boolean;
      latencyMs: number;
      status: number;
      error?: string;
    };

    const tests = await withConcurrencyLimit(
      discovered.map((d, idx) => ({ d, idx })),
      8,
      async ({ d, idx }): Promise<TestRecord> => {
        const r = await healthCheck(d.url);
        return { idx, ...r };
      },
      (done, total) => {
        const p = 0.2 + (done / total) * 0.3;
        liveStatus.progress = p;
      },
    );

    await db
      .update(harvestRunsTable)
      .set({ linksTested: tests.length })
      .where(eq(harvestRunsTable.id, runId));

    await setRunStage(runId, "benchmarking", 0.5);

    let active = 0;
    let failed = 0;
    const latencies: number[] = [];
    const scores: number[] = [];

    type BenchEntry = { idx: number; bench: Awaited<ReturnType<typeof benchmark>> | null };

    const benches = await withConcurrencyLimit(
      tests
        .filter((t): t is TestRecord => !!t)
        .map((t) => ({ t, d: discovered[t.idx]! })),
      6,
      async ({ t, d }): Promise<BenchEntry> => {
        if (!t.ok) return { idx: t.idx, bench: null };
        const b = await benchmark(d.url, d.type);
        return { idx: t.idx, bench: b };
      },
      (done, total) => {
        const p = 0.5 + (done / total) * 0.35;
        liveStatus.progress = p;
      },
    );

    await setRunStage(runId, "ranking", 0.85);

    for (const test of tests) {
      if (!test) continue;
      const d = discovered[test.idx];
      if (!d) continue;
      const benchEntry = benches.find(
        (b): b is BenchEntry => !!b && b.idx === test.idx,
      );
      const bench = benchEntry?.bench ?? null;
      const inputs = {
        ok: test.ok,
        latencyMs: test.latencyMs,
        tps: bench?.tps ?? 0,
        success: bench?.success ?? false,
        quality: bench?.quality ?? 0,
      };
      const score = computeScore(inputs);
      const status = classify(score, test.ok, test.latencyMs);
      const successRate = bench ? (bench.success ? 1 : 0) : test.ok ? 0.5 : 0;

      const upserted = await upsertModel({
        name: d.name,
        provider: d.provider,
        endpoint: d.url,
        type: d.type,
        sourceUrl: `https://github.com/zebbern/no-cost-ai/blob/main/${d.sourceFile}`,
        notes: bench?.error ?? test.error ?? null,
        latencyMs: test.latencyMs,
        tps: bench?.tps ?? null,
        successRate,
        quality: bench?.quality ?? null,
        score,
        status,
        lastChecked: new Date(),
      });

      await recordHistory(upserted.id, runId, {
        latencyMs: test.latencyMs,
        tps: bench?.tps ?? null,
        successRate,
        quality: bench?.quality ?? null,
        score,
        status,
      });

      if (status === "ACTIVE") {
        active += 1;
        latencies.push(test.latencyMs);
        scores.push(score);
      } else if (status === "FAIL") {
        failed += 1;
      } else {
        latencies.push(test.latencyMs);
        scores.push(score);
      }
    }

    await applyRanking();
    await archiveStale(7);

    await setRunStage(runId, "finalizing", 0.97);

    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : null;
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    const finishedAt = new Date();
    await db
      .update(harvestRunsTable)
      .set({
        status: "SUCCESS",
        finishedAt,
        durationMs: Date.now() - t0,
        modelsActive: active,
        modelsFailed: failed,
        avgLatencyMs,
        avgScore,
        stage: null,
        progress: 1,
        message: `Discovered ${discovered.length} endpoints, ${active} active, ${failed} failed.`,
      })
      .where(eq(harvestRunsTable.id, runId));

    logger.info({ runId, active, failed }, "harvest run done");
  } catch (err) {
    logger.error({ err, runId }, "harvest pipeline error");
    await db
      .update(harvestRunsTable)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        durationMs: Date.now() - t0,
        message: err instanceof Error ? err.message : String(err),
      })
      .where(eq(harvestRunsTable.id, runId));
  } finally {
    liveStatus.running = false;
    liveStatus.currentRunId = null;
    liveStatus.stage = null;
    liveStatus.progress = null;
    liveStatus.startedAt = null;
  }
}

export async function getLastFinishedAt(): Promise<Date | null> {
  const rows = await db
    .select({ finishedAt: harvestRunsTable.finishedAt })
    .from(harvestRunsTable)
    .where(sql`${harvestRunsTable.finishedAt} IS NOT NULL`)
    .orderBy(sql`${harvestRunsTable.finishedAt} DESC`)
    .limit(1);
  return rows[0]?.finishedAt ?? null;
}
