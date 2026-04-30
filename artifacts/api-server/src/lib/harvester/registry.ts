import { eq, and, sql } from "drizzle-orm";
import {
  db,
  modelsTable,
  modelHistoryTable,
  type InsertModel,
} from "@workspace/db";

import { createHash } from "node:crypto";

export function modelIdFromEndpoint(endpoint: string): string {
  const hash = createHash("sha1").update(endpoint).digest("hex").slice(0, 12);
  return `m_${hash}`;
}

export type UpsertResult = {
  id: string;
  isNew: boolean;
};

export async function upsertModel(
  data: Omit<InsertModel, "id" | "firstSeenAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<UpsertResult> {
  const id = data.id ?? modelIdFromEndpoint(data.endpoint);
  const existing = await db
    .select({ id: modelsTable.id })
    .from(modelsTable)
    .where(eq(modelsTable.id, id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(modelsTable).values({
      ...data,
      id,
      updatedAt: new Date(),
    });
    return { id, isNew: true };
  }

  await db
    .update(modelsTable)
    .set({
      name: data.name,
      provider: data.provider,
      endpoint: data.endpoint,
      type: data.type,
      sourceUrl: data.sourceUrl,
      notes: data.notes,
      latencyMs: data.latencyMs,
      tps: data.tps,
      successRate: data.successRate,
      quality: data.quality,
      score: data.score,
      status: data.status,
      lastChecked: data.lastChecked ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(modelsTable.id, id));
  return { id, isNew: false };
}

export async function recordHistory(
  modelId: string,
  runId: string,
  data: {
    latencyMs: number | null;
    tps: number | null;
    successRate: number | null;
    quality: number | null;
    score: number;
    status: string;
  },
): Promise<void> {
  await db.insert(modelHistoryTable).values({
    modelId,
    runId,
    timestamp: new Date(),
    latencyMs: data.latencyMs,
    tps: data.tps,
    successRate: data.successRate,
    quality: data.quality,
    score: data.score,
    status: data.status,
  });
}

export async function applyRanking(): Promise<void> {
  // Rank only models that scored > 0 in this run; everything else gets null rank.
  await db.execute(sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rnk
      FROM models
      WHERE status IN ('ACTIVE', 'SLOW')
    )
    UPDATE models m
    SET rank = ranked.rnk
    FROM ranked
    WHERE m.id = ranked.id
  `);
  await db.execute(sql`
    UPDATE models SET rank = NULL WHERE status NOT IN ('ACTIVE', 'SLOW')
  `);
}

export async function archiveStale(daysStale = 7): Promise<number> {
  const result = await db
    .update(modelsTable)
    .set({ status: "ARCHIVED", rank: null })
    .where(
      and(
        eq(modelsTable.status, "FAIL"),
        sql`${modelsTable.lastChecked} < NOW() - INTERVAL '${sql.raw(`${daysStale} days`)}'`,
      ),
    )
    .returning({ id: modelsTable.id });
  return result.length;
}
