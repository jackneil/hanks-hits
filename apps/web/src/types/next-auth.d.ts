/**
 * The session holds the user id and the made-up gamer name, and nothing
 * else (COPPA, issue #26i). See src/lib/auth-privacy.ts.
 *
 * The user type has no name, email or image on purpose, so the compiler
 * rejects any read of them, a destructuring read too.
 */
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** gaming_profiles.handle: a random gamer name, never a real name. */
      handle: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    handle?: string | null;
    /** The sign-in time in seconds (lib/auth-privacy.ts signInTime): the session ends 30 days after it. */
    authTime?: number;
  }
}
