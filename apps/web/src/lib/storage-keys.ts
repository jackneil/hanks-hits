/**
 * Registry of every localStorage key that holds a player's game/app state.
 *
 * signOutAndClear() wipes these on logout so the NEXT kid on a shared family
 * computer doesn't inherit (or upload!) the previous kid's progress. A synced
 * game whose key is missing here AND matches no suffix pattern below leaks the
 * old user's progress into the next account's cloud save (2026-07-10 review
 * finding: five "-state" keys were uncovered).
 *
 * The test at src/lib/__tests__/storage-keys.test.ts scans every
 * `localStorageKey:` passed to useAuthSync and fails if one isn't covered, so
 * new games can't silently reintroduce the leak.
 */
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

/**
 * Who the locally stored progress belongs to. Written on every authenticated
 * initial sync; checked before any local blob is merge-uploaded, so a
 * previous user's leftovers on a shared device can never flow into the next
 * account even if the sign-out clear was defeated (e.g. a second open tab
 * re-persisting from memory). Deliberately NOT matched by the clearing
 * suffixes: it must survive logout to identify foreign data.
 */
export const PROGRESS_OWNER_KEY = "hanks-hits-progress-owner";

/**
 * Cross-tab sign-out signal. Other tabs listen for this key's storage event
 * and hard-reload, killing their in-memory zustand stores (which would
 * otherwise re-persist the just-cleared keys and leak into the next login).
 */
export const SIGNOUT_BROADCAST_KEY = "hanks-hits-signout-broadcast";

/** Remove every game/app progress key (explicit registry + suffix scan). */
export function clearGameStorage(): void {
  for (const key of GAME_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
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

/** Suffix safety net for keys that follow the common naming conventions */
const CLEARED_SUFFIXES = ["-storage", "-progress", "-save", "-game-state"];

/** True when signOutAndClear() will remove this key on logout */
export function isClearedOnSignOut(key: string): boolean {
  return (
    (GAME_STORAGE_KEYS as readonly string[]).includes(key) ||
    CLEARED_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}
