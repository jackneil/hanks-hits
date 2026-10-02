import { z } from "zod";

/**
 * Score type enum - determines sort direction and display format
 */
export const scoreTypeSchema = z.enum(["high_score", "wins", "fastest_time"]);
export type ScoreType = z.infer<typeof scoreTypeSchema>;

/**
 * The largest score a board row may hold. It matches MAX_CURRENCY, the
 * largest bound in the progress schemas.
 */
export const MAX_BOARD_SCORE = 1_000_000_000_000;

/**
 * Validation schema for leaderboard entry data
 * Used to validate extracted scores before DB insert
 */
const leaderboardStatsSchema = z
  .record(z.string().max(50), z.union([z.number(), z.string().max(100)]))
  .refine((obj) => Object.keys(obj).length <= 10, {
    message: "Max 10 additional stats",
  });

export const leaderboardEntrySchema = z.object({
  // leaderboard_entries.score is a Postgres bigint: a fraction makes the
  // insert throw. toBoardEntry() makes the integer. With this rule, a path
  // that skips it fails validation (in a test, or as a logged skip), never
  // in Postgres.
  score: z.number().int().min(0).max(MAX_BOARD_SCORE),
  scoreType: scoreTypeSchema,
  stats: leaderboardStatsSchema.optional(),
}).strict();

export type LeaderboardEntryData = z.infer<typeof leaderboardEntrySchema>;

const booleanQueryParamSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

/**
 * Query params for GET /api/leaderboards/[appId]
 */
export const leaderboardQuerySchema = z.object({
  period: z.enum(["all", "week", "month"]).default("all"),
  limit: z.coerce.number().min(1).max(100).default(100), // Capped at 100
  offset: z.coerce.number().min(0).default(0),
  includeMe: booleanQueryParamSchema.default(false),
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/**
 * Handle validation (for future customization if enabled)
 */
export const handleSchema = z
  .string()
  .min(3)
  .max(35) // Allow for suffix
  .regex(/^[a-zA-Z0-9_]+$/, "Handle must be alphanumeric");

/**
 * Time periods for leaderboard filtering
 */
export const TIME_PERIODS = {
  all: null, // No filter
  week: 7, // Last 7 days
  month: 30, // Last 30 days
} as const;

export type TimePeriod = keyof typeof TIME_PERIODS;
