import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { gamingProfiles } from "./leaderboards";

/**
 * Leaderboard clips (design/LEADERBOARD_CLIPS.html, section 5).
 *
 * A player can put one video of a run on the leaderboard for each game. The
 * video and its poster are in the clips bucket (lb/<id>.mp4, lb/<id>.jpg).
 * This table holds the facts that the server measured from the MP4. The run
 * score is the only value that the client sends.
 *
 * gaming_profile_id is text because gaming_profiles.id is text (migration
 * 0000). An account delete removes the gaming profile, and the cascade
 * removes the row. The sweeper then removes the objects that have no row.
 */
export const LEADERBOARD_CLIP_STATUSES = ["public", "hidden"] as const;
export type LeaderboardClipRowStatus = (typeof LEADERBOARD_CLIP_STATUSES)[number];

export const leaderboardClipStatus = pgEnum(
  "leaderboard_clip_status",
  LEADERBOARD_CLIP_STATUSES
);

export const leaderboardClips = pgTable(
  "leaderboard_clips",
  {
    // 24 random URL-safe characters. The id has no meaning and is not guessable.
    id: text("id").primaryKey(),
    gamingProfileId: text("gaming_profile_id")
      .notNull()
      .references(() => gamingProfiles.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    // Optional run score, normalized like a board score. Unknown scores remain NULL.
    runScore: bigint("run_score", { mode: "number" }),
    // Measured by the server from the MP4.
    durationMs: integer("duration_ms").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    hasAudio: boolean("has_audio").notNull(),
    status: leaderboardClipStatus("status").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (table) => [
    // One clip for each player and game. A new upload replaces the old row.
    unique("leaderboard_clips_profile_app_unique").on(
      table.gamingProfileId,
      table.appId
    ),
    // The leaderboard API reads the public clips of one game.
    index("leaderboard_clips_app_status_idx").on(table.appId, table.status),
    // A hidden clip has the time it was hidden (the 30-day sweep reads it),
    // and a public clip has none.
    check(
      "leaderboard_clips_hidden_at_check",
      sql`(${table.status} = 'hidden') = (${table.hiddenAt} IS NOT NULL)`
    ),
    check(
      "leaderboard_clips_measures_check",
      sql`${table.runScore} >= 0 AND ${table.durationMs} > 0 AND ${table.width} > 0 AND ${table.height} > 0 AND ${table.bytes} > 0`
    ),
  ]
);

/**
 * The upload ledger for the database rate limit (section 6): 10 uploads
 * each day for each account, 1 at a time.
 *
 * A clip row is replaced for each game, so the clips table cannot count
 * uploads. Each upload that passes the first checks (sign-in, size) writes
 * one row here, before the server reads the request body. finished_at is
 * null while the upload runs: that is the "1 at a time" lock. A row that
 * stays open after a crash stops counting as running after
 * UPLOAD_STALE_MS (apps/web/src/lib/leaderboard-clips/store.ts). An upload
 * that fails on our side (bucket or database) deletes its row, so it does
 * not count against the player. The sweeper deletes rows older than 2 days.
 *
 * The row is keyed on the account (users.id), not on the gaming profile:
 * the server takes the slot before it reads the form, and only the form
 * names the game whose board row (and so gaming profile) the upload needs.
 */
export const leaderboardClipUploads = pgTable(
  "leaderboard_clip_uploads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("leaderboard_clip_uploads_user_started_idx").on(
      table.userId,
      table.startedAt
    ),
  ]
);
