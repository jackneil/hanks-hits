-- COPPA purge, step 2 of 2 (issue #26i, design/ACCOUNTS_COPPA.md section 6).
-- Run it right after packages/db/drizzle/0001_coppa_google_id_only.sql, with
-- the same production write grant:
--   psql "$DATABASE_PUBLIC_URL" -X -v ON_ERROR_STOP=1 -f packages/db/scripts/coppa-purge-vacuum.sql
-- Do NOT add -1: VACUUM cannot run inside a transaction block.
--
-- Why: an UPDATE writes a new row version and leaves the old version, with
-- the old email, name, photo link and tokens, in the table file and in the
-- indexes (users_email_unique holds every email). Autovacuum does not run on
-- tables this small (threshold 50 dead rows). A plain VACUUM marks the space
-- free and keeps the same files, so old bytes can stay in the free space of
-- a page. VACUUM FULL writes new table and index files that hold only the
-- live rows, and deletes the old files. It also writes NULL for the dropped
-- password column. CHECKPOINT makes the new files durable now, so the next
-- backup copies them.
--
-- Only users and accounts: the purge file does not change app_progress. The
-- typed words in it are the local word store change's: that change clears
-- them and runs its own VACUUM FULL "app_progress" (design/LOCAL_WORDS.html,
-- section 4). packages/db/scripts/typed-words-count.sql shows when it ran.
--
-- VACUUM FULL takes an ACCESS EXCLUSIVE lock on each table while it runs.
-- These tables are small (production on 2026-10-02: 4 users, 4 accounts),
-- so the lock lasts well under a second each.
VACUUM FULL "users";
VACUUM FULL "accounts";
CHECKPOINT;
