import {
  pgTable,
  text,
  timestamp,
  jsonb,
  varchar,
  index,
} from "drizzle-orm/pg-core";

export const scans = pgTable(
  "scans",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    verdict: jsonb("verdict"),
    supplierMatches: jsonb("supplier_matches").default([]),
    steps: jsonb("steps").default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("scans_normalized_url_idx").on(t.normalizedUrl)]
);

export const signalCache = pgTable(
  "signal_cache",
  {
    key: varchar("key", { length: 512 }).primaryKey(),
    signalType: varchar("signal_type", { length: 64 }).notNull(),
    result: jsonb("result").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("signal_cache_expires_idx").on(t.expiresAt)]
);
