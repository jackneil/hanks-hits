"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { GAME_STORAGE_KEYS, isClearedOnSignOut } from "./storage-keys";

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
    // Clear all game/app localStorage keys (explicit registry)
    for (const key of GAME_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }

    // Also clear any keys matching the suffix conventions (safety net)
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isClearedOnSignOut(key)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }

  return nextAuthSignOut({ callbackUrl });
}

// Re-export raw functions for advanced use cases
export { nextAuthSignIn as signIn, nextAuthSignOut as signOut };
