import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const traderSettingsTable = pgTable("trader_settings", {
  id: text("id").primaryKey().default("singleton"),
  executionMode: text("execution_mode").notNull().default("OFF"),
  tradingMode: text("trading_mode").notNull().default("DAILY"),
  riskPerTradePct: doublePrecision("risk_per_trade_pct").notNull().default(1),
  dailyLossCapPct: doublePrecision("daily_loss_cap_pct").notNull().default(3),
  maxOpenPositions: integer("max_open_positions").notNull().default(2),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(5),
  minConfidence: doublePrecision("min_confidence").notNull().default(0.6),
  minRiskReward: doublePrecision("min_risk_reward").notNull().default(1.3),
  requireAiConfirmation: boolean("require_ai_confirmation")
    .notNull()
    .default(true),
  aiConfirmCount: integer("ai_confirm_count").notNull().default(2),
  signalExpirySec: integer("signal_expiry_sec").notNull().default(300),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const traderAccountTable = pgTable("trader_account", {
  id: text("id").primaryKey().default("singleton"),
  startingBalance: doublePrecision("starting_balance").notNull().default(100000),
  balance: doublePrecision("balance").notNull().default(100000),
  realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
  peakEquity: doublePrecision("peak_equity").notNull().default(100000),
  dailyPnl: doublePrecision("daily_pnl").notNull().default(0),
  dailyPnlResetAt: timestamp("daily_pnl_reset_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  totalTrades: integer("total_trades").notNull().default(0),
  winningTrades: integer("winning_trades").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const traderSnapshotsTable = pgTable(
  "trader_snapshots",
  {
    id: text("id").primaryKey(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceStatus: text("source_status").notNull(),
    spot: doublePrecision("spot").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (table) => [index("trader_snapshots_fetched_idx").on(table.fetchedAt)],
);

export const traderSignalsTable = pgTable(
  "trader_signals",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    tradingMode: text("trading_mode").notNull(),
    executionMode: text("execution_mode").notNull(),
    direction: text("direction").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    sourceScore: doublePrecision("source_score").notNull(),
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    riskReward: doublePrecision("risk_reward").notNull(),
    atrAbs: doublePrecision("atr_abs").notNull(),
    sizeUnits: doublePrecision("size_units").notNull(),
    riskAmount: doublePrecision("risk_amount").notNull(),
    rulesPassed: boolean("rules_passed").notNull(),
    aiPassed: boolean("ai_passed"),
    aiVotersCount: integer("ai_voters_count").notNull().default(0),
    aiAgreeCount: integer("ai_agree_count").notNull().default(0),
    status: text("status").notNull().default("PENDING"),
    rejectionReason: text("rejection_reason"),
    positionId: text("position_id"),
    snapshotId: text("snapshot_id"),
    gates: jsonb("gates").notNull(),
    aiVotes: jsonb("ai_votes").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("trader_signals_status_idx").on(table.status),
    index("trader_signals_created_idx").on(table.createdAt),
  ],
);

export const traderPositionsTable = pgTable(
  "trader_positions",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id").notNull(),
    side: text("side").notNull(),
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    sizeUnits: doublePrecision("size_units").notNull(),
    riskAmount: doublePrecision("risk_amount").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    exitPrice: doublePrecision("exit_price"),
    exitReason: text("exit_reason"),
    pnl: doublePrecision("pnl"),
    pnlR: doublePrecision("pnl_r"),
    status: text("status").notNull().default("OPEN"),
  },
  (table) => [
    index("trader_positions_status_idx").on(table.status),
    index("trader_positions_opened_idx").on(table.openedAt),
  ],
);

export const traderEquityCurveTable = pgTable(
  "trader_equity_curve",
  {
    id: text("id").primaryKey(),
    t: timestamp("t", { withTimezone: true }).notNull().defaultNow(),
    equity: doublePrecision("equity").notNull(),
    realizedPnl: doublePrecision("realized_pnl").notNull(),
    unrealizedPnl: doublePrecision("unrealized_pnl").notNull(),
    openPositions: integer("open_positions").notNull(),
  },
  (table) => [index("trader_equity_t_idx").on(table.t)],
);

export const traderCycleStateTable = pgTable("trader_cycle_state", {
  id: text("id").primaryKey().default("singleton"),
  lastCycleAt: timestamp("last_cycle_at", { withTimezone: true }),
  nextCycleAt: timestamp("next_cycle_at", { withTimezone: true }),
  running: boolean("running").notNull().default(false),
  lastError: text("last_error"),
});
