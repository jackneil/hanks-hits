import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Generic app progress table - ONE table for ALL games/apps
 * No migrations needed when adding new games!
 */
export const appProgress = pgTable(
  "app_progress",
  {
    id: text("id").primaryKey(), // Generated unique ID
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(), // e.g., "hill-climb", "monster-truck", "weather"
    data: jsonb("data").notNull(), // THE ENTIRE GAME STATE AS JSON BLOB
    lastSyncedAt: timestamp("last_synced_at"), // For conflict resolution
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: one record per user per app
    unique("user_app_unique").on(table.userId, table.appId),
    // Index for fast lookups by user
    index("app_progress_user_idx").on(table.userId),
  ]
);

/**
 * Transaction log for exploit-proof currency tracking
 * Prevents the "spend locally, sync gets old coins back" exploit
 */
export const appTransactions = pgTable(
  "app_transactions",
  {
    id: text("id").primaryKey(),
    progressId: text("progress_id")
      .notNull()
      .references(() => appProgress.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "spend", "earn", "unlock"
    amount: integer("amount"), // For currency changes
    itemId: text("item_id"), // For unlocks (vehicleId, stageId)
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => [
    // Index for fast transaction lookups by progress
    index("transactions_progress_idx").on(table.progressId),
  ]
);

// Valid app IDs - used for validation in API routes
export const VALID_APP_IDS = [
  "hill-climb",
  "monster-truck",
  "checkers",
  "chess",
  "oregon-trail",
  "flappy-bird",
  "2048",
  "snake",
  "memory-match",
  "joke-generator",
  "endless-runner",
  "weather",
  "cookie-clicker",
  "toy-finder",
  "quoridor",
  "platformer",
  "retro-arcade",
  "blitz-bomber",
  "dino-runner",
  "breakout",
  "space-invaders",
  "drawing-app",
  "hextris",
  "asteroids",
  "drum-machine",
  "virtual-pet",
  "bomberman",
  "trivia",
  "wordle",
  "math-attack",
  "arkanoid",
  // Platform-level synced blob (not a game): the cross-game Trophy Case.
  "achievements",
] as const;

export type ValidAppId = (typeof VALID_APP_IDS)[number];

// Type for the progress data blob (game-specific)
export type AppProgressData = Record<string, unknown>;

// Type for transaction types
export type TransactionType = "spend" | "earn" | "unlock";
