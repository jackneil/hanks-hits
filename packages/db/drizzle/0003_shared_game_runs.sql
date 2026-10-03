SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "leaderboard_clips" ALTER COLUMN "run_score" DROP NOT NULL;
