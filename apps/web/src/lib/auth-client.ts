"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { SIGNOUT_BROADCAST_KEY, clearGameStorage } from "./storage-keys";

// Re-export NextAuth client functions with our customizations
export { useSession, SessionProvider } from "next-auth/react";

/**
 * Sign in with credentials (email/password)
 */
export async function signInWithCredentials(
  email: string,
  password: string
) {
  return nextAuthSignIn("credentials", {
    email,
    password,
    redirect: false,
  });
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle(callbackUrl: string = "/") {
  return nextAuthSignIn("google", { callbackUrl });
}

/**
 * Sign out and clear localStorage (security fix)
 * Prevents cross-user data contamination on shared devices. The key registry
 * and matching rules live in storage-keys.ts so a test can prove every synced
 * game's key gets cleared.
 */
export async function signOutAndClear(callbackUrl: string = "/") {
  if (typeof window !== "undefined") {
    // Never let a storage failure (blocked webviews) strand the user
    // logged in — the sign-out itself must always proceed.
    try {
      clearGameStorage();
      // Tell every OTHER open tab to reload: their in-memory zustand stores
      // would otherwise re-persist the just-cleared keys within seconds and
      // hand this user's progress to whoever signs in next.
      localStorage.setItem(SIGNOUT_BROADCAST_KEY, String(Date.now()));
    } catch (err) {
      console.warn("Could not clear game storage on sign-out:", err);
    }
  }

  return nextAuthSignOut({ callbackUrl });
}

// Re-export raw functions for advanced use cases
export { nextAuthSignIn as signIn, nextAuthSignOut as signOut };
