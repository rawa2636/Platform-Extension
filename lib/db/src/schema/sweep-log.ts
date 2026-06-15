import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const traderSweepLogTable = pgTable(
  "trader_sweep_log",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    signalDirection: text("signal_direction").notNull(),
    signalPrice: doublePrecision("signal_price").notNull(),
    sweepProbability: doublePrecision("sweep_probability").notNull(),
    expectedSweepDepthLow: doublePrecision("expected_sweep_depth_low").notNull(),
    expectedSweepDepthHigh: doublePrecision("expected_sweep_depth_high").notNull(),
    recommendedEntry: doublePrecision("recommended_entry").notNull(),
    nearestPoolPrice: doublePrecision("nearest_pool_price"),
    nearestPoolDistance: doublePrecision("nearest_pool_distance"),
    lowestPriceAfterSignal: doublePrecision("lowest_price_after_signal"),
    highestPriceAfterSignal: doublePrecision("highest_price_after_signal"),
    actualSweepDepth: doublePrecision("actual_sweep_depth"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    positionId: text("position_id"),
  },
  (t) => [
    index("trader_sweep_log_created_idx").on(t.createdAt),
    index("trader_sweep_log_direction_idx").on(t.signalDirection),
  ],
);
