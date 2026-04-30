import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  serial,
  index,
} from "drizzle-orm/pg-core";

export const modelHistoryTable = pgTable(
  "model_history",
  {
    id: serial("id").primaryKey(),
    modelId: text("model_id").notNull(),
    runId: text("run_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    latencyMs: doublePrecision("latency_ms"),
    tps: doublePrecision("tps"),
    successRate: doublePrecision("success_rate"),
    quality: doublePrecision("quality"),
    score: doublePrecision("score").notNull().default(0),
    status: text("status").notNull(),
  },
  (table) => [
    index("model_history_model_idx").on(table.modelId),
    index("model_history_run_idx").on(table.runId),
    index("model_history_ts_idx").on(table.timestamp),
  ],
);

export type ModelHistory = typeof modelHistoryTable.$inferSelect;
export type InsertModelHistory = typeof modelHistoryTable.$inferInsert;
