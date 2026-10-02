import { eq, type Database } from "@hank-neil/db";
import { accounts } from "@hank-neil/db/schema";

/**
 * True when the player already has a sign-in account (an accounts row).
 * lib/auth.ts gives it to oneAccountPerPlayer() (lib/auth-privacy.ts), so
 * a sign-in cannot link a second Google account to a player.
 */
export async function hasSignInAccount(database: Database, userId: string): Promise<boolean> {
  const [row] = await database
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  return row !== undefined;
}
