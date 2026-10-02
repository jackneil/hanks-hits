import { eq, type Database } from "@hank-neil/db";
import { gamingProfiles, users } from "@hank-neil/db/schema";
import { generateUniqueHandle } from "@/lib/handle-generator";

export type GamingProfile = typeof gamingProfiles.$inferSelect;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";
/** Postgres foreign_key_violation: the users row is gone. */
const FOREIGN_KEY_VIOLATION = "23503";

/** The Postgres error code of a database error, also when Drizzle wraps it (on `cause`). */
export function postgresCode(err: unknown): string | null {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const { code } = e as { code?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/**
 * True when the error is a unique violation on the handle column (another
 * user got the same random handle first). Drizzle wraps the Postgres error
 * in DrizzleQueryError, so the code and the constraint name are on `cause`.
 */
export function isHandleCollision(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === UNIQUE_VIOLATION) {
      return typeof constraint === "string" && constraint.includes("handle");
    }
  }
  return false;
}

/**
 * The user's gaming profile (the made-up gamer name), created on first
 * use. Sign-in calls it, so every signed-in player has a gamer name to
 * show instead of a real name. The progress route calls it inside its
 * transaction when a score reaches a leaderboard.
 *
 * Race-safe: a second tab that creates the same user's profile first wins
 * (ON CONFLICT on user_id), and a random handle that another user took in
 * the meantime is retried with a new handle. Each insert runs in its own
 * transaction (a savepoint when `database` is already a transaction), so a
 * failed insert does not abort the caller's transaction.
 *
 * Throws when the third random handle also collides, or on a database
 * error. The callers decide what a failure means for them.
 */
export async function getOrCreateGamingProfile(
  database: Database,
  userId: string
): Promise<GamingProfile | null> {
  const existing = await database.query.gamingProfiles.findFirst({
    where: eq(gamingProfiles.userId, userId),
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await generateUniqueHandle(database);
    try {
      const [inserted] = await database.transaction((sp) =>
        sp
          .insert(gamingProfiles)
          .values({ userId, handle })
          .onConflictDoNothing({ target: gamingProfiles.userId })
          .returning()
      );
      // A no-op insert means another tab created this user's profile first.
      return (
        inserted ??
        (await database.query.gamingProfiles.findFirst({
          where: eq(gamingProfiles.userId, userId),
        })) ??
        null
      );
    } catch (err) {
      if (isHandleCollision(err) && attempt < 2) {
        console.warn(`[gaming-profile] handle collision on attempt ${attempt + 1}, retrying`);
        continue;
      }
      throw err;
    }
  }
  // Not reached: the third attempt returns or throws.
  return null;
}

/** The users row of a session is gone: the account was deleted. */
export const ACCOUNT_GONE = "account-gone" as const;

/**
 * The gamer name for a session, read each time the session is read, so a
 * deleted account signs out on every device the next time it loads a
 * page. ACCOUNT_GONE when the users row does not exist (the account was
 * deleted, or a cookie names a user that never existed). A user with no
 * gamer name yet gets one. Throws on other database errors: the caller
 * keeps the session then, because a database outage must not sign
 * everyone out.
 */
export async function sessionGamerName(
  database: Database,
  userId: string
): Promise<string | null | typeof ACCOUNT_GONE> {
  const [row] = await database
    .select({ handle: gamingProfiles.handle })
    .from(users)
    .leftJoin(gamingProfiles, eq(gamingProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return ACCOUNT_GONE;
  if (row.handle) return row.handle;
  try {
    const profile = await getOrCreateGamingProfile(database, userId);
    return profile?.handle ?? null;
  } catch (err) {
    // The account was deleted between the read and the insert.
    if (postgresCode(err) === FOREIGN_KEY_VIOLATION) return ACCOUNT_GONE;
    throw err;
  }
}
