/**
 * The stored parts of a finished Record (plan 8.3).
 *
 * The io worker stores a recording in parts: a new part starts when the
 * video config changes (a new avcC or coded size) or when the next chunk
 * would make the part larger than the part limit. The service gives the
 * FIRST part as ClipActionResult.record. A lab that keeps only that record
 * analyses part 1 against the whole recording length, and the report then
 * shows a length failure with no cause. So the lab finds every part:
 * - The result's own `parts` list, when the service gives one. It is the
 *   complete list, in order (the service contract of PR 2.4 adds it).
 * - Else the library rows of the same game and owner with kind "record" and
 *   createdAt at or after the first part's createdAt. The io worker dates
 *   each part at its start in the recording, so the later parts sort after
 *   the first part, and every older recording sorts before it.
 * The first part is always first, and no part is in the list two times.
 */
import type { ClipRecord } from "../protocol";
import type { ClipActionResult } from "../service/contract";

/** The `parts` list of a result, when the service gives one; else null. */
export function declaredParts(result: ClipActionResult): readonly ClipRecord[] | null {
  if (!result.ok || !("parts" in result)) return null;
  const parts = result.parts;
  return Array.isArray(parts) && parts.length > 0 ? parts : null;
}

/** The number of parts that could not be stored, when the service gives it; else 0. */
export function declaredFailedParts(result: ClipActionResult): number {
  if (!result.ok || !("failedParts" in result)) return 0;
  const failed = result.failedParts;
  return typeof failed === "number" && Number.isFinite(failed) && failed > 0 ? failed : 0;
}

/** Every part of the recording whose first part is `first`, oldest first (see the file comment). */
export function recordParts(first: ClipRecord, declared: readonly ClipRecord[] | null, listed: readonly ClipRecord[]): ClipRecord[] {
  const source = declared
    ? declared
    : listed
        .filter((row) => row.kind === "record" && row.gameId === first.gameId && row.ownerKey === first.ownerKey && row.createdAt >= first.createdAt)
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parts: ClipRecord[] = [first];
  const seen = new Set([first.id]);
  for (const row of source) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    parts.push(row);
  }
  return parts;
}
