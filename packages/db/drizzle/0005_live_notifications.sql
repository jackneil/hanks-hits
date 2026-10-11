CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"app_id" text NOT NULL,
	"actor_handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_owner_created_idx" ON "notifications" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hh_lock_board() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hh-board:' || NEW.app_id || ':' || NEW.score_type, 0));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hh_board_lock ON leaderboard_entries;
CREATE TRIGGER hh_board_lock BEFORE INSERT OR UPDATE ON leaderboard_entries
  FOR EACH ROW EXECUTE FUNCTION hh_lock_board();

CREATE OR REPLACE FUNCTION hh_board_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor gaming_profiles%ROWTYPE;
  old_score bigint;
  old_rank integer;
  new_rank integer;
  recipient record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_score := OLD.score;
    IF (NEW.score_type = 'fastest_time' AND NEW.score >= OLD.score)
      OR (NEW.score_type <> 'fastest_time' AND NEW.score <= OLD.score) THEN RETURN NEW; END IF;
  END IF;
  -- Hold visibility stable until inserts commit. A concurrent opt-out then
  -- runs its history scrub after this transaction, never before it.
  SELECT * INTO actor FROM gaming_profiles WHERE id = NEW.gaming_profile_id FOR SHARE;
  IF NOT actor.show_on_leaderboards THEN RETURN NEW; END IF;
  SELECT 1 + count(*) INTO new_rank FROM leaderboard_entries b
    JOIN gaming_profiles p ON p.id = b.gaming_profile_id
    WHERE b.app_id = NEW.app_id AND b.score_type = NEW.score_type
      AND p.show_on_leaderboards AND b.gaming_profile_id <> NEW.gaming_profile_id
      AND CASE WHEN NEW.score_type = 'fastest_time' THEN b.score < NEW.score ELSE b.score > NEW.score END;
  IF old_score IS NULL THEN old_rank := 2147483647;
  ELSE
    SELECT 1 + count(*) INTO old_rank FROM leaderboard_entries b
      JOIN gaming_profiles p ON p.id = b.gaming_profile_id
      WHERE b.app_id = NEW.app_id AND b.score_type = NEW.score_type
        AND p.show_on_leaderboards AND b.gaming_profile_id <> NEW.gaming_profile_id
        AND CASE WHEN NEW.score_type = 'fastest_time' THEN b.score < old_score ELSE b.score > old_score END;
  END IF;
  -- Alert crossed players on the visible top-100 board, once per actual
  -- crossing. A tie never counts as passing somebody.
  FOR recipient IN
    WITH board AS (
      SELECT b.score, p.user_id, p.id FROM leaderboard_entries b
        JOIN gaming_profiles p ON p.id = b.gaming_profile_id
      WHERE b.app_id = NEW.app_id AND b.score_type = NEW.score_type AND p.show_on_leaderboards
      ORDER BY CASE WHEN NEW.score_type = 'fastest_time' THEN b.score ELSE -b.score END, p.id
      LIMIT 100
    ), peers AS (
      SELECT b.user_id, 'score_passed'::text AS kind, actor.handle AS handle
      FROM board b WHERE b.id <> actor.id
        AND CASE WHEN NEW.score_type = 'fastest_time'
          THEN b.score > NEW.score AND (old_score IS NULL OR b.score <= old_score)
          ELSE b.score < NEW.score AND (old_score IS NULL OR b.score >= old_score) END
    ), milestones AS (
      SELECT actor.user_id,
        CASE WHEN new_rank = 1 AND old_rank > 1 THEN 'first_place' ELSE 'top_ten' END AS kind,
        NULL::text AS handle
      WHERE (new_rank = 1 AND old_rank > 1) OR (new_rank <= 10 AND old_rank > 10)
    ) SELECT * FROM peers UNION ALL SELECT * FROM milestones ORDER BY user_id
  LOOP
    -- Consistent owner lock order across games keeps capped history safe
    -- when separate boards notify the same people at the same time.
    PERFORM pg_advisory_xact_lock(hashtextextended('hh-inbox:' || recipient.user_id, 0));
    INSERT INTO notifications(user_id, kind, app_id, actor_handle)
      VALUES (recipient.user_id, recipient.kind, NEW.app_id, recipient.handle);
    DELETE FROM notifications WHERE user_id = recipient.user_id AND id IN (
      SELECT id FROM notifications WHERE user_id = recipient.user_id
        ORDER BY created_at DESC, id DESC OFFSET 100
    );
    -- NOTIFY is delivered only when the surrounding transaction commits.
    -- It carries routing identity only, never handles or notification text.
    PERFORM pg_notify('hh_live', recipient.user_id);
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hh_board_notifications ON leaderboard_entries;
CREATE TRIGGER hh_board_notifications AFTER INSERT OR UPDATE ON leaderboard_entries
  FOR EACH ROW EXECUTE FUNCTION hh_board_notifications();

CREATE OR REPLACE FUNCTION hh_hide_notification_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.show_on_leaderboards AND NOT NEW.show_on_leaderboards THEN
    UPDATE notifications SET actor_handle = NULL WHERE actor_handle = OLD.handle;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hh_hide_notification_actor ON gaming_profiles;
CREATE TRIGGER hh_hide_notification_actor AFTER UPDATE OF show_on_leaderboards ON gaming_profiles
  FOR EACH ROW EXECUTE FUNCTION hh_hide_notification_actor();
