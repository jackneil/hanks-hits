/**
 * Read a game's locally persisted progress straight from localStorage.
 *
 * Games persist through zustand's `persist` middleware under per-game keys
 * that follow a handful of naming conventions (see GAME_STORAGE_KEYS in
 * src/lib/storage-keys.ts — the sign-out clearing list built from the same
 * conventions). There is no single appId → key mapping in the codebase, so
 * this helper tries every known convention. It exists for decoration (the
 * My Games shelf's personal-best stat), so it never throws: any malformed
 * or missing entry just reads as "no local progress".
 */

// Every storage-key convention in use today, in rough order of popularity.
// "-app-progress" covers ids whose key embeds an extra word (weather →
// weather-app-progress); the "hank-" prefix covers hank-chess-state and
// hank-platformer-progress.
const KEY_SUFFIXES = [
  "-storage",
  "-progress",
  "-save",
  "-game-state",
  "-state",
  "-app-progress",
] as const;
const KEY_PREFIXES = ["", "hank-"] as const;

/**
 * Find the persisted progress blob for an app/game id, or null when the
 * game has never been played on this device (or the data is unreadable).
 */
export function findLocalProgress(
  appId: string
): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;

  for (const prefix of KEY_PREFIXES) {
    for (const suffix of KEY_SUFFIXES) {
      const raw = safeRead(`${prefix}${appId}${suffix}`);
      if (raw === null) continue;

      const progress = unwrapPersistEnvelope(raw);
      if (progress) return progress;
    }
  }

  return null;
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Zustand persist writes `{"state": {...}, "version": n}`. Stores that
 * partialize to `{ progress }` nest the real blob one level deeper.
 */
function unwrapPersistEnvelope(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const state = isRecord(parsed.state) ? parsed.state : parsed;
    if (isRecord(state.progress)) return state.progress;
    return isRecord(state) && Object.keys(state).length > 0 ? state : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
