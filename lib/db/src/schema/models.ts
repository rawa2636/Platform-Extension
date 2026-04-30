import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const modelsTable = pgTable(
  "models",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    type: text("type").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    latencyMs: doublePrecision("latency_ms"),
    tps: doublePrecision("tps"),
    successRate: doublePrecision("success_rate"),
    quality: doublePrecision("quality"),
    score: doublePrecision("score").notNull().default(0),
    rank: integer("rank"),
    status: text("status").notNull().default("FAIL"),
    lastChecked: timestamp("last_checked", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("models_status_idx").on(table.status),
    index("models_type_idx").on(table.type),
    index("models_score_idx").on(table.score),
    index("models_endpoint_idx").on(table.endpoint),
  ],
);

export type Model = typeof modelsTable.$inferSelect;
export type InsertModel = typeof modelsTable.$inferInsert;
