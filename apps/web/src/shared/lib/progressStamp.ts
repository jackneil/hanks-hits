/**
 * The time in synced progress (`lastModified`, or `updatedAt` in Memory
 * Match) marks the player's last change, and nothing else.
 *
 * useAuthSync merges the progress of a device and the progress of the
 * account by that time: the newer one wins (lib/progress-merge.ts). A time
 * that a page load, a read or the server's copy put into the progress makes
 * untouched or old progress look new, and the merge then replaces the real
 * progress of the account with it. So:
 *
 * - The default progress of a store has time 0 (untouched).
 * - getProgress() returns the stored time. A read never stamps.
 * - setProgress() keeps the time of the progress that it gets (the server's
 *   time, or 0). Taking progress is not a player action.
 * - A player action that changes progress stamps Date.now(). An action
 *   that changes nothing keeps the time.
 * - An automatic change that a page makes once (a page load, the catch-up
 *   for the time away, a visit on a new day) is progress only in a store
 *   that a player already changed, and only on the account's progress:
 *   automaticStamp(time, synced). A page runs its automatic changes when
 *   useAuthSync says `ready`, and passes `synced`. `ready` also turns true
 *   when the account cannot be reached (READY_FALLBACK_MS) and for a guest:
 *   the page then runs on the device's copy, which can be older than the
 *   account, and a stamp there made the old copy newer than the account.
 * - A continuous change (a clock that runs while the page is open: Cookie
 *   Clicker's bake, the Four-Wheeler world clock, the pet's needs) keeps
 *   the time. A stamp there made an idle page newer than what the kid did
 *   on another device, and the idle page's saves replaced it. The server
 *   takes a save with the same time as its row (the same line of play,
 *   lib/progress-merge.ts), so the change still reaches the account.
 *
 * src/__tests__/progress-stamp-fuzz.test.ts drives every synced store with
 * seeded random actions and holds each store to these rules.
 */
import type { StoreApi } from "zustand";

/**
 * Deep equality of two JSON-like values. `ignore` names keys (at any depth)
 * that the comparison skips. A key that holds `undefined` counts as absent,
 * as in JSON.
 */
export function sameProgress(a: unknown, b: unknown, ignore: readonly string[] = []): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    return a.every((value, i) => sameProgress(value, other[i], ignore));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    if (left[key] === undefined && right[key] === undefined) continue;
    if (!sameProgress(left[key], right[key], ignore)) return false;
  }
  return true;
}

/**
 * The time for an automatic change: Date.now() in a store that a player
 * already changed (time above 0), when the progress is the account's
 * (`synced`: useAuthSync's first sync is done). Else the time stays (0:
 * untouched; an unsynced copy keeps the time of its last player change).
 */
export function automaticStamp(time: number, synced = true): number {
  return synced && time > 0 ? Date.now() : time;
}

/**
 * The progress after a player action: `next` with time Date.now() when it
 * differs from `prev` (the time aside), else `prev` itself with its time.
 */
export function stampIfChanged<P extends object>(
  prev: P,
  next: P,
  timeKey: "lastModified" | "updatedAt" = "lastModified"
): P {
  if (sameProgress(prev, next, [timeKey])) return prev;
  return { ...next, [timeKey]: Date.now() };
}

type StampedState = { lastModified: number };

type PersistedStore<S> = Pick<StoreApi<S>, "subscribe" | "setState"> & {
  persist: { hasHydrated: () => boolean };
};

export interface ProgressStamp<S extends StampedState> {
  /** Run a set() that takes progress from somewhere else (the server) without a stamp. */
  adopt: (apply: () => void) => void;
  /** Start to stamp. Call it once, after create(). */
  attach: (store: PersistedStore<S>) => void;
}

/**
 * Stamps for a store that keeps its synced fields at the top level of its
 * state and has many actions that change them (Hill Climb, Monster Truck,
 * Oregon Trail). After attach(), a set() that changes the value of one of
 * `fields` stamps lastModified with Date.now(). A set() that writes
 * lastModified itself keeps the time that it wrote. A set() that writes the
 * same values (a new array with the same items) does not stamp.
 */
export function progressStamp<S extends StampedState>(
  fields: readonly (keyof S & string)[]
): ProgressStamp<S> {
  let mode: "player" | "adopt" = "player";
  const run = (next: typeof mode, apply: () => void) => {
    const before = mode;
    mode = next;
    try {
      apply();
    } finally {
      mode = before;
    }
  };
  return {
    adopt: (apply) => run("adopt", apply),
    attach(store) {
      store.subscribe((state, prev) => {
        if (mode === "adopt" || !store.persist.hasHydrated()) return;
        if (state.lastModified !== prev.lastModified) return;
        if (fields.every((field) => sameProgress(state[field], prev[field]))) return;
        store.setState({ lastModified: Date.now() } as Partial<S>);
      });
    },
  };
}
