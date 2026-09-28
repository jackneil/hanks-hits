/**
 * How long we keep an account that nobody uses.
 *
 * COPPA (16 CFR 312.10) does not let a site keep a child's information
 * for all time. The written retention policy must give a timeframe for
 * deletion. The FTC says that a site can keep the information "for a
 * specific amount of time after the child has last used" the site
 * (90 FR 16918, 2025-04-22, the discussion of 312.10).
 *
 * The privacy notice (/privacy) shows this number, and
 * lib/account-retention.ts deletes the accounts. Both read it from this
 * file, so they cannot disagree. This file has no database import, so the
 * notice page can use it.
 *
 * We chose 24 months to match other services for children (ABCmouse,
 * Kiddopia and Legends of Learning delete accounts after 24 months with no
 * use). A child who stops for a school year and comes back the next summer
 * still has the saved games.
 */

/** Months with no use after which we delete an account. */
export const INACTIVE_ACCOUNT_MONTHS = 24;

/**
 * The time before which an account is not in use, for a given "now".
 * Month arithmetic is in UTC. A day that does not exist in the earlier
 * month moves to the next day (for example, 29 February becomes 1 March).
 */
export function inactiveAccountCutoff(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - INACTIVE_ACCOUNT_MONTHS,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    )
  );
}
