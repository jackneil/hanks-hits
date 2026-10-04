/** Legacy progress-key inventory. New persistence is owner-bound; sign-out
 * revokes leases instead of deleting durable saves or their ownership evidence. */
export const GAME_STORAGE_KEYS = [
  // Games
  "2048-game-state",
  "arkanoid-state",
  "bomberman-state",
  "checkers-progress",
  "chess-storage", // legacy key: clears stale data on devices from before the rename
  "hank-chess-state",
  "cookie-clicker-storage",
  "endless-runner-storage",
  "flappy-bird-progress",
  "hank-platformer-progress",
  "hill-climb-storage",
  "memory-match-progress",
  "monster-truck-save",
  "oregon-trail-storage",
  "quoridor-progress",
  "retro-arcade-progress",
  "snake-game-state",
  // Apps
  "drum-machine-state",
  "joke-generator-progress",
  "toy-finder-progress",
  "virtual-pet-state",
  "weather-app-progress",
] as const;

/** Frozen evidence of the original legacy saves' owner. New saves carry their
 * owner in an atomic v2 envelope; no upgraded writer changes this marker. */
export const PROGRESS_OWNER_KEY = "hanks-hits-progress-owner";

/** Cross-tab sign-out invalidates mounted store leases before hard navigation. */
export const SIGNOUT_BROADCAST_KEY = "hanks-hits-signout-broadcast";

/**
 * @deprecated Sign-out retains owner partitions and frozen legacy evidence.
 * Kept for old internal callers during the transport migration; never deletes.
 */
export function clearGameStorage(): void {}

/** Suffix safety net for keys that follow the common naming conventions */
const CLEARED_SUFFIXES = ["-storage", "-progress", "-save", "-game-state"];

/** Classifies legacy logical progress keys. It does not authorize deletion. */
export function isClearedOnSignOut(key: string): boolean {
  return (
    (GAME_STORAGE_KEYS as readonly string[]).includes(key) ||
    CLEARED_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}
