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
 *
 * Two safety properties are structural here:
 * - Convention-probed keys are display-gated on isClearedOnSignOut(): the
 *   shelf never shows account-linked progress that a sign-out would not
 *   wipe, so a key naming that slips the clearing net can't leak the
 *   previous kid's stats on a shared device.
 * - Key guessing can collide across games (a game slugged "snake-game"
 *   would probe "snake-game-state", which is Snake's real key). No current
 *   id collides — worth re-checking when naming freely (see the tests).
 */

import { isClearedOnSignOut } from "@/lib/storage-keys";

// Every storage-key convention in use today, in rough order of popularity.
// "-app-progress" covers ids whose key embeds an extra word (weather →
// weather-app-progress); the "hank-" prefix covers hank-chess-state and
// hank-platformer-progress. Kept alongside storage-keys.ts CLEARED_SUFFIXES
// on purpose: this list is what we READ, that list is what sign-out WIPES,
// and the isClearedOnSignOut() gate below ties them together.
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
 * Device-owned saves for games that predate the zustand conventions and
 * never sync to an account (four-wheeler's My Land save lives inside a
 * srcDoc iframe world of its own). These are deliberately NOT cleared on
 * sign-out — they belong to the device, like a console save — so the
 * isClearedOnSignOut gate does not apply; the shelf shows exactly what
 * opening the game itself would show.
 */
const DEVICE_OWNED_ALIASES: Record<string, readonly string[]> = {
  "four-wheeler-adventure": ["fwa_myland_v1"],
};

export interface LocalProgressResult {
  progress: Record<string, unknown>;
  /**
   * True when the save is a device-owned alias (never account-synced).
   * Account-scoped display guards (progress-owner checks) skip these.
   */
  deviceOwned: boolean;
}

/**
 * Find the persisted progress for an app/game id, or null when the game
 * has never been played on this device (or the data is unreadable).
 */
export function findLocalProgress(appId: string): LocalProgressResult | null {
  if (typeof window === "undefined") return null;

  for (const key of DEVICE_OWNED_ALIASES[appId] ?? []) {
    const raw = safeRead(key);
    if (raw === null) continue;
    const progress = parseAliasBlob(raw);
    if (progress) return { progress, deviceOwned: true };
  }

  for (const prefix of KEY_PREFIXES) {
    for (const suffix of KEY_SUFFIXES) {
      const key = `${prefix}${appId}${suffix}`;
      // Structural invariant: never display what sign-out wouldn't clear.
      if (!isClearedOnSignOut(key)) continue;

      const raw = safeRead(key);
      if (raw === null) continue;

      const progress = unwrapPersistEnvelope(raw);
      if (progress) return { progress, deviceOwned: false };
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
    return Object.keys(state).length > 0 ? state : null;
  } catch {
    return null;
  }
}

/**
 * Alias saves are hand-rolled formats, not persist envelopes. An array
 * blob (four-wheeler's land plots) is wrapped so downstream stat
 * extraction always receives a record.
 */
function parseAliasBlob(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length > 0 ? { items: parsed } : null;
    if (isRecord(parsed)) return Object.keys(parsed).length > 0 ? parsed : null;
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
