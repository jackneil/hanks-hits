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
 *
 * Known fail-closed trade-off: after user A signs out, a kid who plays as a
 * GUEST and then signs in for the first time loses that guest session's
 * progress (the surviving marker says the local data was A's; we cannot
 * tell one guest from another). Losing a guest round beats crediting one
 * kid's progress to another's account.
 */
export const PROGRESS_OWNER_KEY = "hanks-hits-progress-owner";

/**
 * Cross-tab sign-out signal. Other tabs listen for this key's storage event
 * and hard-reload, killing their in-memory zustand stores (which would
 * otherwise re-persist the just-cleared keys and leak into the next login).
 */
export const SIGNOUT_BROADCAST_KEY = "hanks-hits-signout-broadcast";

/**
 * Per save key: this device's save of the key holds the progress of the
 * signed-in account, or progress built on it (useAuthSync writes it when a
 * first sync is done). A save without it was built on the defaults (a
 * guest's play, a blank device): at the first sync, the account's progress
 * stays the base and the save's records fold in. Cleared on sign-out.
 */
export const SYNC_LINEAGE_PREFIX = "hanks-hits-lineage:";

/**
 * The lineage key of a save key. It ends with "-progress", a suffix that
 * every version of clearGameStorage() removes: also the code before this
 * key, after a rollback, so a sign-out on that code clears it too.
 */
export function syncLineageKey(localStorageKey: string): string {
  return `${SYNC_LINEAGE_PREFIX}${localStorageKey}:sync-progress`;
}

/**
 * The time when clearGameStorage() last removed every save on this device
 * (a sign-out, or the purge of another account's progress). A save after it
 * that has no sync lineage key was made on the defaults. Kept on sign-out,
 * as the owner key is. A device with no value has only saves from before
 * this key existed: those keep the last-write rule of that code.
 */
export const SAVES_CLEARED_KEY = "hanks-hits-saves-cleared";

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
  localStorage.setItem(SAVES_CLEARED_KEY, String(Date.now()));
}

/** Suffix safety net for keys that follow the common naming conventions */
const CLEARED_SUFFIXES = ["-storage", "-progress", "-save", "-game-state"];

/** True when signOutAndClear() will remove this key on logout */
export function isClearedOnSignOut(key: string): boolean {
  return (
    (GAME_STORAGE_KEYS as readonly string[]).includes(key) ||
    key.startsWith(SYNC_LINEAGE_PREFIX) ||
    CLEARED_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}
