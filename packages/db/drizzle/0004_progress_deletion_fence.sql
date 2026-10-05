SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "app_progress" ADD COLUMN "revision_required" boolean DEFAULT false NOT NULL;