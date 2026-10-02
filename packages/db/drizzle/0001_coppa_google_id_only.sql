-- COPPA purge for issue #26i: an account keeps only the Google subject id.
-- See design/ACCOUNTS_COPPA.md, section "Purge steps".
--
-- ORDER: deploy the Google-only code FIRST, then run this file. The old code
-- selects users.password on every user read, so it fails when the column is
-- gone. The new code never reads or writes the columns this file clears.
--
-- This file does NOT touch app_progress. The words that players typed into
-- games are moved to the device and cleared from the server by the local
-- word store change (design/LOCAL_WORDS.html, section 4), which moves them to
-- the device first. A clear here would delete words that no device holds yet.
--
-- Production schema is applied by hand (drizzle-kit push, no migrations
-- table), and no deploy step runs this file. Run it once, as one
-- transaction, with a production write grant:
--   psql "$DATABASE_PUBLIC_URL" -X -v ON_ERROR_STOP=1 -1 -f packages/db/drizzle/0001_coppa_google_id_only.sql
-- THEN run packages/db/scripts/coppa-purge-vacuum.sql. It cannot run in a
-- transaction. An UPDATE leaves the old bytes on disk until the table is
-- rewritten, and that file rewrites the tables.
--
-- 1. Clear the personal information that Google sign-in stored on users.
UPDATE "users" SET "name" = NULL, "email" = NULL, "email_verified" = NULL, "image" = NULL;--> statement-breakpoint
-- 2. Clear every OAuth token and token claim. The id_token is a JWT that carries the email claim.
UPDATE "accounts" SET "refresh_token" = NULL, "access_token" = NULL, "expires_at" = NULL, "token_type" = NULL, "scope" = NULL, "id_token" = NULL, "session_state" = NULL;--> statement-breakpoint
-- 3. Passwords were only for the removed email sign-in.
ALTER TABLE "users" DROP COLUMN "password";--> statement-breakpoint
-- 4. One sign-in account per player: a Google account that is new to the
--    site must never be linked to whoever is signed in on that browser.
CREATE UNIQUE INDEX "accounts_user_id_unique" ON "accounts" USING btree ("user_id");--> statement-breakpoint
-- 5. Make "always NULL" a database rule, so no later code path can store them again.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_no_tokens" CHECK ("accounts"."refresh_token" IS NULL AND "accounts"."access_token" IS NULL AND "accounts"."expires_at" IS NULL AND "accounts"."token_type" IS NULL AND "accounts"."scope" IS NULL AND "accounts"."id_token" IS NULL AND "accounts"."session_state" IS NULL);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_no_personal_info" CHECK ("users"."name" IS NULL AND "users"."email" IS NULL AND "users"."email_verified" IS NULL AND "users"."image" IS NULL);
