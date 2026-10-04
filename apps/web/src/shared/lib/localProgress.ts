/** Read the current owner's saved progress without importing game modules. */
import { ownerBoundProgress, PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress";

/**
 * Device-owned saves for games that predate the zustand conventions and
 * never sync to an account (four-wheeler's My Land save lives inside a
 * srcDoc iframe world of its own). These are deliberately NOT cleared on
 * sign-out. They belong to the device, like a console save. The shelf shows what
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

  const lease = ownerBoundProgress.captureLease();
  const key = PROGRESS_STORAGE_KEYS[appId];
  if (!lease || !key) return null;
  const raw = ownerBoundProgress.readScoped(key, lease);
  if (raw !== null && ownerBoundProgress.isCurrent(lease)) {
    const progress = unwrapPersistEnvelope(raw);
    if (progress) return { progress, deviceOwned: false };
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
