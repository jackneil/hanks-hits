import { boolean, check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appProgress } from "./app-progress";

/** Immutable handoff candidates; ownership is inherited from the progress row. */
export const legacyProgressWords = pgTable("legacy_progress_words", {
  progressId: text("progress_id").notNull().references(() => appProgress.id, { onDelete: "cascade" }),
  sourceRevision: text("source_revision").notNull(),
  extractionVersion: integer("extraction_version").notNull(),
  payload: jsonb("payload").notNull(),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.progressId, t.sourceRevision, t.extractionVersion] })]);

/** Cutover is separately authorized SQL, never an application-startup action. */
export const progressWordPolicy = pgTable("progress_word_policy", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
}, (t) => [check("progress_word_policy_singleton", sql`${t.id} = 'local-only'`)]);
