import { extractProgressWords, type WordField } from "../progress-words";

/** Bootstrap inventory: reading legacy words must not import or mount a game. */
export const legacyWordSources: Readonly<Record<string, string>> = Object.freeze({
  "oregon-trail": "oregon-trail-storage",
  weather: "weather-app-progress",
  "toy-finder": "toy-finder-progress",
  "drawing-app": "drawing-app-progress",
  "drum-machine": "drum-machine-state",
  "virtual-pet": "virtual-pet-state",
  "four-wheeler-3d": "four-wheeler-3d-game-state",
});

const nestedProgress = new Set(["drum-machine", "virtual-pet", "four-wheeler-3d"]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Decode the real Zustand envelope without adopting, sanitizing or stamping it.
 * Oregon persists its flat state, including leaderName/party during setup phases.
 * Its unsaved TitleScreen input drafts live only in React, not another envelope.
 * Keep the full progress object as evidence; never guess a missing entity ID.
 * The coordinator separately preserves original bytes and the persist version.
 */
export function extractLegacyWordSource(
  appId: string,
  raw: string,
): { fields: WordField[]; progress: unknown } | null {
  if (!Object.hasOwn(legacyWordSources, appId)) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!object(envelope) || !object(envelope.state)) return null;
    const progress = nestedProgress.has(appId) ? envelope.state.progress : envelope.state;
    if (!object(progress)) return null;
    return { fields: extractProgressWords(appId, progress).fields, progress };
  } catch {
    // Malformed or unreadable sources remain untouched for later recovery.
    return null;
  }
}
