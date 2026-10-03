/**
 * Retention of leaderboard clips (design/LEADERBOARD_CLIPS.html, section 8,
 * COPPA 16 CFR 312.10). Pure time rules; sweeper.ts applies them.
 *
 * | Case                              | When the video is deleted          |
 * | Removed by the owner or an admin  | At once (the DELETE route)         |
 * | Replaced by a newer upload        | At once (the upload route)         |
 * | Hidden by a report                | 30 days after the report           |
 * | Public                            | 12 months after the upload         |
 * | Account deleted                   | The row by cascade; the objects at |
 * |                                   | the next sweep (once a day)        |
 */

/** A clip that a report hid is deleted after this many days. */
export const HIDDEN_KEEP_DAYS = 30;
/** A public clip is deleted this many months after the upload. */
export const PUBLIC_KEEP_MONTHS = 12;
/**
 * An object with no row is deleted only when it is older than this. An
 * upload stores the objects first and writes the row after, so a newer
 * object can belong to an upload that is still running.
 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;
/** Rows of the upload ledger are kept this long (the daily limit reads 24 hours). */
export const UPLOAD_LEDGER_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionCutoffs {
  /** Delete a hidden clip with hidden_at before this time. */
  hiddenBefore: Date;
  /** Delete any clip with created_at before this time. */
  createdBefore: Date;
  /** Delete an object with no row that was last changed before this time. */
  orphanBefore: Date;
  /** Delete upload ledger rows that started before this time. */
  ledgerBefore: Date;
}

/**
 * The same date and time `months` calendar months earlier, in UTC. A day
 * that the earlier month does not have becomes that month's last day (12
 * months before 2028-02-29 is 2027-02-28, not 2027-03-01), so the cutoff is
 * never later than the true calendar date and a clip is never deleted early.
 */
export function monthsBefore(now: Date, months: number): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  // Day 0 of the next month is the last day of this month (Date.UTC carries a month below 0 into earlier years).
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    )
  );
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const at = now.getTime();
  return {
    hiddenBefore: new Date(at - HIDDEN_KEEP_DAYS * DAY_MS),
    createdBefore: monthsBefore(now, PUBLIC_KEEP_MONTHS),
    orphanBefore: new Date(at - ORPHAN_GRACE_MS),
    ledgerBefore: new Date(at - UPLOAD_LEDGER_KEEP_MS),
  };
}
