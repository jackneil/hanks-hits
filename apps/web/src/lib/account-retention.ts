import {
  and,
  db as defaultDb,
  eq,
  gte,
  lt,
  sql,
  type Database,
} from "@hank-neil/db";
import {
  appProgress,
  gamingProfiles,
  leaderboardEntries,
  users,
} from "@hank-neil/db/schema";

import { inactiveAccountCutoff } from "./retention-policy";
import { logServerError } from "./server-log";

/**
 * Delete the accounts that nobody used for INACTIVE_ACCOUNT_MONTHS.
 *
 * This is the deletion part of the written retention policy in the privacy
 * notice (16 CFR 312.10). The notice tells parents what "used" means, so
 * keep the notice and this query the same.
 *
 * An account is in use when one of these is newer than the cutoff:
 * - the account was made (users.created_at),
 * - the account changed, for example a name change (users.updated_at),
 * - a game saved progress (app_progress.updated_at),
 * - the leaderboard setting changed (gaming_profiles.updated_at),
 * - a game sent a leaderboard score (leaderboard_entries.synced_at).
 *
 * The delete removes the users row only. The database removes the rest
 * of the account with it (ON DELETE CASCADE): accounts, sessions,
 * authenticators, app_progress, app_transactions, gaming_profiles and
 * leaderboard_entries.
 *
 * All timestamp columns are "timestamp without time zone" in UTC. drizzle
 * sends a Date as an ISO string, so the compare is in UTC too.
 */
export function inactiveAccountDeleteQuery(database: Database, now: Date) {
  const cutoff = inactiveAccountCutoff(now);
  return database
    .delete(users)
    .where(
      and(
        lt(users.createdAt, cutoff),
        lt(users.updatedAt, cutoff),
        sql`not exists (select 1 from ${appProgress} where ${and(
          eq(appProgress.userId, users.id),
          gte(appProgress.updatedAt, cutoff)
        )})`,
        sql`not exists (select 1 from ${gamingProfiles} where ${and(
          eq(gamingProfiles.userId, users.id),
          gte(gamingProfiles.updatedAt, cutoff)
        )})`,
        sql`not exists (select 1 from ${leaderboardEntries} inner join ${gamingProfiles} on ${eq(
          gamingProfiles.id,
          leaderboardEntries.gamingProfileId
        )} where ${and(
          eq(gamingProfiles.userId, users.id),
          gte(leaderboardEntries.syncedAt, cutoff)
        )})`
      )
    )
    .returning({ id: users.id });
}

/** Delete the accounts that are not in use. Returns how many it deleted. */
export async function deleteInactiveAccounts(
  database: Database = defaultDb,
  now: Date = new Date()
): Promise<number> {
  const deleted = await inactiveAccountDeleteQuery(database, now);
  return deleted.length;
}

/**
 * Run the delete once and log the result. The log line holds only a count
 * and a date, never an account. A failure is logged and the next run tries
 * again.
 */
export async function runAccountRetention(
  database: Database = defaultDb,
  now: Date = new Date()
): Promise<void> {
  try {
    const count = await deleteInactiveAccounts(database, now);
    const cutoff = inactiveAccountCutoff(now).toISOString().slice(0, 10);
    console.log(
      `[retention] Deleted ${count} account(s) with no use since ${cutoff}.`
    );
  } catch (error) {
    logServerError("[retention] Inactive account delete failed", error);
  }
}

/** The first run waits one minute, so the server can start first. */
export const RETENTION_FIRST_RUN_DELAY_MS = 60 * 1000;
/** After the first run, the delete runs once each day. */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

let stopSchedule: (() => void) | null = null;

function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

/**
 * Start the daily delete in this server process. instrumentation.ts calls
 * this function one time when the production server starts. A second call
 * does not start a second schedule. The timers do not keep the process
 * alive.
 *
 * @returns A function that stops the schedule.
 */
export function startAccountRetentionSchedule(
  run: () => Promise<void> = () => runAccountRetention()
): () => void {
  if (stopSchedule) return stopSchedule;

  const first = setTimeout(() => void run(), RETENTION_FIRST_RUN_DELAY_MS);
  const daily = setInterval(() => void run(), RETENTION_INTERVAL_MS);
  unref(first);
  unref(daily);

  stopSchedule = () => {
    clearTimeout(first);
    clearInterval(daily);
    stopSchedule = null;
  };
  return stopSchedule;
}
