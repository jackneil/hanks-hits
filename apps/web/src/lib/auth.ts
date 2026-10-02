import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@hank-neil/db";
import * as schema from "@hank-neil/db/schema";
import { ACCOUNT_GONE, postgresCode, sessionGamerName } from "@/lib/gaming-profile";
import { hasSignInAccount } from "@/lib/sign-in-accounts";
import {
  GOOGLE_SCOPE,
  SESSION_MAX_AGE_SECONDS,
  googleProfile,
  keepNoTokens,
  oneAccountPerPlayer,
  privateSession,
  privateToken,
  sessionTooOld,
  signInTime,
  withoutPersonalInfo,
} from "@/lib/auth-privacy";

/**
 * Sign-in: Google only, and an account keeps only Google's subject id
 * (COPPA 16 CFR 312.5(c)(7), issue #26i). A grown-up signs in with
 * Google. Playing as a guest needs no sign-in at all. The rules and why
 * they are layered are in auth-privacy.ts and design/ACCOUNTS_COPPA.md.
 */

/**
 * How long a session read waits for the gamer name. Every page load and
 * every signed-in API call reads the session, so a database that does not
 * answer (a network drop, not a fast refusal) must not hold them for the
 * minutes that a TCP connect can take. A healthy lookup takes milliseconds.
 */
export const GAMER_NAME_TIMEOUT_MS = 1_500;

const TIMED_OUT = Symbol("timed out");

/**
 * The player's made-up gamer name (created on first sign-in), or
 * ACCOUNT_GONE when the account was deleted. Read on every session read,
 * so a deleted account signs out on each device the next time it loads a
 * page. A database error, or no answer within GAMER_NAME_TIMEOUT_MS, keeps
 * the session: `fallback` (the name already in the cookie) is used, and
 * the header says "Player" if there is none. The log holds no values.
 */
async function gamerNameFor(
  userId: string,
  fallback: string | null
): Promise<string | null | typeof ACCOUNT_GONE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), GAMER_NAME_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([sessionGamerName(db, userId), timeout]);
    if (result === TIMED_OUT) {
      console.error("[auth] gamer name lookup failed", { code: "timeout" });
      return fallback;
    }
    return result;
  } catch (err) {
    console.error("[auth] gamer name lookup failed", { code: postgresCode(err) ?? "unknown" });
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: oneAccountPerPlayer(
    withoutPersonalInfo(
      DrizzleAdapter(db, {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens,
        authenticatorsTable: schema.authenticators,
      })
    ),
    (userId) => hasSignInAccount(db, userId)
  ),

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: GOOGLE_SCOPE } },
      profile: googleProfile,
      account: keepNoTokens,
    }),
  ],

  session: {
    strategy: "jwt",
    // Auth.js slides this expiry forward on each read. The 30 days are
    // counted from the sign-in by the jwt callback (sessionTooOld).
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  pages: {
    signIn: "/login",
    error: "/login", // Redirect errors to login
  },

  callbacks: {
    // `user` is set only on sign-in. Every other call gets the decoded
    // cookie, which may come from before this change and hold the name,
    // email and picture: privateToken() builds a new token, so they go.
    // Returning null clears the cookie: the player is signed out.
    async jwt({ token, user }) {
      const id =
        user?.id ?? (typeof token.id === "string" ? token.id : token.sub);
      if (!id) return null; // No user.
      const now = Math.floor(Date.now() / 1000);
      const authTime = signInTime(token, Boolean(user), now);
      if (sessionTooOld(authTime, now)) return null; // 30 days since the sign-in.
      const handle = await gamerNameFor(
        id,
        typeof token.handle === "string" ? token.handle : null
      );
      if (handle === ACCOUNT_GONE) return null; // The account was deleted.
      return privateToken(id, handle, authTime);
    },
    // The response of /api/auth/session, auth() and useSession(): built
    // fresh, so the name, email and image of Auth.js's default session go.
    async session({ session, token }) {
      // The end of the 30 days from the sign-in, when that is sooner than
      // the sliding expiry that Auth.js computed.
      const end =
        typeof token.authTime === "number"
          ? new Date((token.authTime + SESSION_MAX_AGE_SECONDS) * 1000)
          : null;
      const expires =
        end && end.getTime() < new Date(session.expires).getTime()
          ? end.toISOString()
          : session.expires;
      return privateSession(expires, token);
    },
  },

  // Trust Railway and localhost
  trustHost: true,
});

// Export auth config for use in API routes
export type { Session } from "next-auth";
