"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";

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
 * All localStorage keys used by games and apps.
 * CRITICAL: Keep this list updated when adding new games!
 */
const GAME_STORAGE_KEYS = [
  // Games with cloud sync
  "2048-game-state",
  "snake-game-state",
  "checkers-progress",
  "chess-storage",
  "flappy-bird-progress",
  "memory-match-progress",
  "quoridor-progress",
  "retro-arcade-storage",
  // Games pending cloud sync
  "hill-climb-storage",
  "monster-truck-save",
  "cookie-clicker-storage",
  "endless-runner-storage",
  "hank-platformer-progress",
  "oregon-trail-storage",
  // Apps
  "joke-generator-progress",
  "toy-finder-progress",
  "weather-app-progress",
];

/**
 * Sign out and clear localStorage (security fix)
 * Prevents cross-user data contamination on shared devices.
 */
export async function signOutAndClear(callbackUrl: string = "/") {
  if (typeof window !== "undefined") {
    // Clear all game/app localStorage keys
    for (const key of GAME_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }

    // Also clear any keys matching common patterns (safety net)
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.endsWith("-storage") ||
        key.endsWith("-progress") ||
        key.endsWith("-save") ||
        key.endsWith("-game-state")
      )) {
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
