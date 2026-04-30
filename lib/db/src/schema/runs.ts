import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";

export const harvestRunsTable = pgTable(
  "harvest_runs",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("RUNNING"),
    sourceCommit: text("source_commit"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    linksDiscovered: integer("links_discovered").notNull().default(0),
    linksTested: integer("links_tested").notNull().default(0),
    modelsActive: integer("models_active").notNull().default(0),
    modelsFailed: integer("models_failed").notNull().default(0),
    avgLatencyMs: doublePrecision("avg_latency_ms"),
    avgScore: doublePrecision("avg_score"),
    stage: text("stage"),
    progress: doublePrecision("progress"),
    message: text("message"),
  },
  (table) => [
    index("harvest_runs_started_idx").on(table.startedAt),
    index("harvest_runs_status_idx").on(table.status),
  ],
);

export type HarvestRun = typeof harvestRunsTable.$inferSelect;
export type InsertHarvestRun = typeof harvestRunsTable.$inferInsert;
