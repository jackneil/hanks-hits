import { PROGRESS_WORD_FIELDS } from "@/lib/progress-words";

type Projector = (saved: Record<string, unknown>, loadedAt: number) => Record<string, unknown>;
const projectors = new Map<string, Projector>();

/** Game rules register without making the storage bootstrap import every game. */
export function registerAdmissionProjector(appId: string, projector: Projector): void {
  projectors.set(appId, projector);
}

/**
 * Retain the original source until its game can interpret timestamp markers.
 * A projected word-bearing save never carries a checksum of the original words.
 */
export function projectGuestSave(appId: string | undefined, raw: string, loadedAt: number): string | null {
  if (!appId || !PROGRESS_WORD_FIELDS[appId]) return raw;
  const project = projectors.get(appId);
  if (!project) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
    const value = envelope as Record<string, unknown>;
    if (!value.state || typeof value.state !== "object" || Array.isArray(value.state)) return null;
    return JSON.stringify({ ...value, state: project(value.state as Record<string, unknown>, loadedAt) });
  } catch { return null; }
}
