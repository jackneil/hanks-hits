-- Run in a transaction. These bounds apply only to migration DDL, never saves.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "legacy_progress_words" (
	"progress_id" text NOT NULL,
	"source_revision" text NOT NULL,
	"extraction_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_progress_words_progress_id_source_revision_extraction_version_pk" PRIMARY KEY("progress_id","source_revision","extraction_version")
);
--> statement-breakpoint
CREATE TABLE "progress_word_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "progress_word_policy_singleton" CHECK ("progress_word_policy"."id" = 'local-only')
);
--> statement-breakpoint
ALTER TABLE "legacy_progress_words" ADD CONSTRAINT "legacy_progress_words_progress_id_app_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."app_progress"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "progress_word_policy" ("id", "enabled") VALUES ('local-only', false);
