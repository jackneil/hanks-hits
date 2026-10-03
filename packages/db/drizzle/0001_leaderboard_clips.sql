CREATE TYPE "public"."leaderboard_clip_status" AS ENUM('public', 'hidden');--> statement-breakpoint
CREATE TABLE "leaderboard_clip_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leaderboard_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"gaming_profile_id" text NOT NULL,
	"app_id" text NOT NULL,
	"run_score" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"has_audio" boolean NOT NULL,
	"status" "leaderboard_clip_status" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "leaderboard_clips_profile_app_unique" UNIQUE("gaming_profile_id","app_id"),
	CONSTRAINT "leaderboard_clips_hidden_at_check" CHECK (("leaderboard_clips"."status" = 'hidden') = ("leaderboard_clips"."hidden_at" IS NOT NULL)),
	CONSTRAINT "leaderboard_clips_measures_check" CHECK ("leaderboard_clips"."run_score" >= 0 AND "leaderboard_clips"."duration_ms" > 0 AND "leaderboard_clips"."width" > 0 AND "leaderboard_clips"."height" > 0 AND "leaderboard_clips"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "leaderboard_clip_uploads" ADD CONSTRAINT "leaderboard_clip_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_clips" ADD CONSTRAINT "leaderboard_clips_gaming_profile_id_gaming_profiles_id_fk" FOREIGN KEY ("gaming_profile_id") REFERENCES "public"."gaming_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaderboard_clip_uploads_user_started_idx" ON "leaderboard_clip_uploads" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "leaderboard_clips_app_status_idx" ON "leaderboard_clips" USING btree ("app_id","status");