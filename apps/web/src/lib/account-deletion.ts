import { eq, type Database } from "@hank-neil/db";
import { users } from "@hank-neil/db/schema";

/**
 * Delete an account and everything in it (COPPA 16 CFR 312.6(a)(2): a
 * parent can direct the operator to delete the child's information).
 *
 * The delete removes the users row only. The database removes the rest
 * with it (ON DELETE CASCADE): accounts (the Google sign-in id), sessions,
 * authenticators, app_progress, app_transactions, gaming_profiles (the
 * gamer name) and leaderboard_entries (the scores).
 *
 * Every other device that is signed in to the account signs out the next
 * time it reads its session (lib/auth.ts, sessionGamerName).
 *
 * Returns false when there was no such account.
 */
export async function deleteAccount(database: Database, userId: string): Promise<boolean> {
  const deleted = await database.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return deleted.length > 0;
}
