/**
 * What an account keeps: the Google subject id and nothing else (COPPA,
 * issue #26i, design/ACCOUNTS_COPPA.md).
 *
 * The site is for children. 16 CFR 312.5(c)(7) lets it keep a persistent
 * identifier without parental consent when it collects NO other personal
 * information and uses the identifier only to support internal operations
 * (312.2: "authenticate users", and keep game scores). So sign-in must
 * never store or pass on an email address, a name, a photo, or an OAuth
 * token (Google's id_token is a JWT that carries the email claim).
 *
 * Each rule is applied at more than one layer, so one mistake cannot leak:
 * 1. Google is asked for the "openid" scope only, so it does not send the
 *    email, name or photo.
 * 2. googleProfile() keeps only the subject id of what Google does send.
 * 3. keepNoTokens() tells Auth.js to store no token of the token set.
 * 4. withoutPersonalInfo() wraps the database adapter, so createUser,
 *    updateUser and linkAccount drop those fields even when a later
 *    provider passes them.
 * 5. privateToken() and privateSession() put only the user id and the
 *    made-up gamer name in the session cookie and the session response
 *    (the cookie also holds the sign-in time, for the 30-day limit).
 * 6. CHECK constraints on users and accounts (packages/db) reject a row
 *    that holds any of them.
 *
 * oneAccountPerPlayer() also stops a sign-in from linking a second Google
 * account to the player who is signed in on that browser.
 *
 * This file imports only types, so tests can load it without a database.
 */
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import type { JWT } from "next-auth/jwt";

/**
 * The Google scope we ask for. "openid" alone gives an id_token with the
 * subject id ("sub") and no email, name or picture claim. Google's account
 * chooser accepts it (probe of the production client on 2026-10-01: the
 * request with "openid" opens the sign-in page, a request with an unknown
 * scope returns invalid_scope).
 */
export const GOOGLE_SCOPE = "openid";

/** The subset of Google's id_token claims that we read. */
export interface GoogleIdClaims {
  sub: string;
}

/** The user that Auth.js creates from a Google sign-in: an id and no personal information. */
export interface IdOnlyProfile {
  id: string;
  name: null;
  email: null;
  image: null;
}

/**
 * Google provider profile(): keep only the subject id. Auth.js stores
 * the returned id as accounts.provider_account_id. It also copies name,
 * email and image to the new user, so they are null here.
 */
export function googleProfile(claims: GoogleIdClaims): IdOnlyProfile {
  return { id: String(claims.sub), name: null, email: null, image: null };
}

/**
 * Provider account(): which fields of the token set to store on the
 * account row. None. Auth.js adds provider, type and providerAccountId,
 * and sign-in needs only those.
 */
export function keepNoTokens(): Record<string, never> {
  return {};
}

/** The user fields that are personal information. They must always be null in the database. */
const PERSONAL_USER_FIELDS = ["name", "email", "emailVerified", "image"] as const;

/**
 * Wrap a database adapter so it can never write personal information or
 * a token. createUser writes null for each personal field. updateUser
 * drops the personal fields from the change. linkAccount keeps only the
 * fields that link the account to the user.
 */
export function withoutPersonalInfo(base: Adapter): Adapter {
  const adapter: Adapter = { ...base };

  if (base.createUser) {
    const createUser = base.createUser.bind(base);
    adapter.createUser = (user: AdapterUser) =>
      createUser({
        ...user,
        name: null,
        // AdapterUser types email as string. The column allows NULL and
        // the users_no_personal_info constraint requires it.
        email: null as unknown as string,
        emailVerified: null,
        image: null,
      });
  }

  if (base.updateUser) {
    const updateUser = base.updateUser.bind(base);
    adapter.updateUser = (user: Partial<AdapterUser> & Pick<AdapterUser, "id">) => {
      const change: Record<string, unknown> = { ...user };
      for (const field of PERSONAL_USER_FIELDS) delete change[field];
      return updateUser(change as Partial<AdapterUser> & Pick<AdapterUser, "id">);
    };
  }

  if (base.linkAccount) {
    const linkAccount = base.linkAccount.bind(base);
    adapter.linkAccount = (account: AdapterAccount) =>
      linkAccount({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
  }

  return adapter;
}

/**
 * Thrown when a sign-in would link a second sign-in account to a player.
 * It carries no ids or values, so the Auth.js error log stays clean.
 */
export class SecondSignInAccountError extends Error {
  constructor() {
    super("This player already has a sign-in account.");
    this.name = "SecondSignInAccountError";
  }
}

/**
 * Wrap a database adapter so a player can have only one sign-in account.
 *
 * When a browser is signed in and someone signs in there with a Google
 * account that is new to the site, Auth.js links that Google account to
 * the player who is signed in (@auth/core handle-login.js). That Google
 * account then opens the first player's account on any device, and two
 * children's games end up in one account. linkAccount refuses the link
 * here, and Auth.js sends the browser to /login?error with the session of
 * the first player unchanged.
 *
 * The unique index accounts_user_id_unique is the same rule in the
 * database. This check also covers the time between the deploy and the
 * purge file, which adds that index.
 */
export function oneAccountPerPlayer(
  base: Adapter,
  hasSignInAccount: (userId: string) => Promise<boolean>
): Adapter {
  if (!base.linkAccount) return base;
  const linkAccount = base.linkAccount.bind(base);
  return {
    ...base,
    // Auth.js does not read the result of linkAccount, so this returns nothing.
    linkAccount: async (account: AdapterAccount): Promise<void> => {
      if (await hasSignInAccount(account.userId)) throw new SecondSignInAccountError();
      await linkAccount(account);
    },
  };
}

/** A sign-in lasts 30 days from the sign-in itself (Auth.js session.maxAge too). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * When the player signed in, in seconds since 1970.
 *
 * Auth.js re-signs the session cookie with a new expiry on each read (a
 * sliding session: @auth/core lib/actions/session.js). So a cookie that is
 * used once a month, for example on a shared family computer, would never
 * end. The jwt callback ends the session SESSION_MAX_AGE_SECONDS after
 * this time instead (sessionTooOld). The time is in the encrypted cookie,
 * so a client cannot change it. A cookie from before this change has no
 * time: its 30 days start at its next read.
 */
export function signInTime(token: { authTime?: unknown }, signingIn: boolean, nowSeconds: number): number {
  if (!signingIn && typeof token.authTime === "number" && Number.isFinite(token.authTime)) {
    return Math.min(token.authTime, nowSeconds);
  }
  return nowSeconds;
}

/** True when the sign-in is 30 days old or more: the player must sign in again. */
export function sessionTooOld(authTime: number, nowSeconds: number): boolean {
  return nowSeconds - authTime >= SESSION_MAX_AGE_SECONDS;
}

/**
 * The session cookie's content: the user id ("sub" and "id"), the gamer
 * name and the sign-in time. Built fresh, never copied from the old token,
 * so the name, email and picture that Auth.js puts in its default token
 * (and that session cookies from before this change still hold) are
 * dropped the next time the cookie is written.
 */
export function privateToken(id: string, handle: string | null, authTime: number): JWT {
  return { sub: id, id, handle, authTime };
}

/** The user that the session response (/api/auth/session, auth(), useSession) shows. */
export interface PrivateSessionUser {
  id: string;
  handle: string | null;
}

/** The session response: the user id, the gamer name and the expiry. Nothing else. */
export function privateSession(
  expires: string,
  token: Pick<JWT, "id" | "handle" | "sub">
): { expires: string; user: PrivateSessionUser } {
  const id = typeof token.id === "string" ? token.id : String(token.sub ?? "");
  const handle = typeof token.handle === "string" ? token.handle : null;
  return { expires, user: { id, handle } };
}
