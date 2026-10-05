import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { extractProgressWords, type WordField } from "@/lib/progress-words";
import { parseProgressJournal, type ProgressJournal } from "./progressJournal";
import { sameProgress } from "./progressStamp";
import { emptyJournalRecovery, isJournalRecovery, type JournalRecoveryMetadata } from "./progressJournalRecovery";

export type JournalOriginal = { raw: string; choice: boolean };
export type JournalEnvelope = {
  format: "hh-progress-journal";
  version: 1 | 2 | 3;
  generation: number;
  current: string;
  originals: JournalOriginal[];
  recovery?: JournalRecoveryMetadata;
};
export type JournalAddress = { appId: ValidAppId; ownerId: string; writerId: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function readJournalEnvelope(raw: string, address: JournalAddress): JournalEnvelope | null {
  try {
    const value: unknown = JSON.parse(raw);
    let row: JournalEnvelope;
    if (object(value) && value.format === "hh-progress-journal") {
      if (![1, 2, 3].includes(value.version as number) || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
        || typeof value.current !== "string" || !Array.isArray(value.originals)
        || value.originals.some(item => !object(item) || typeof item.raw !== "string" || typeof item.choice !== "boolean")) return null;
      if (value.version !== 1 ? !isJournalRecovery(value.recovery, address.appId) : value.recovery !== undefined) return null;
      row = value as JournalEnvelope;
    } else row = { format: "hh-progress-journal", version: 1, generation: 0, current: raw, originals: [] };
    const journal = parseProgressJournal(row.current, address.appId, address.ownerId);
    if (!journal || journal.writerId !== address.writerId) return null;
    // Foreign or unknown originals cannot silently acquire this owner's address.
    if (row.originals.some(item => !parseProgressJournal(item.raw, address.appId, address.ownerId))) return null;
    return row;
  } catch { return null; }
}

/** One replacement contains both the new row and all originals still at risk. */
export function nextJournalEnvelope(previous: JournalEnvelope | null, current: string, originals: readonly string[], address: JournalAddress): JournalEnvelope {
  const journal = parseProgressJournal(current, address.appId, address.ownerId);
  if (!journal || journal.writerId !== address.writerId) throw new Error("Invalid journal replacement");
  const generation = (previous?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) throw new Error("Journal generations exhausted");
  const retained = new Map<string, boolean>((previous?.originals ?? []).map(item => [item.raw, item.choice]));
  for (const raw of originals) {
    if (raw === current) continue;
    const original = parseProgressJournal(raw, address.appId, address.ownerId);
    if (!original) throw new Error("Invalid journal original");
    // Only the explicit choice boundary is pinned. Pinning every timer update
    // made while a conflict is open would prevent compaction indefinitely.
    const choice = Boolean(original.writerId === journal.writerId && original.serial === journal.serial - 1
      && original.conflict && !journal.conflict && journal.forceWrite);
    retained.set(raw, (retained.get(raw) ?? false) || choice);
  }
  return { format: "hh-progress-journal", version: 3, generation, current,
    originals: [...retained].map(([raw, choice]) => ({ raw, choice })),
    recovery: structuredClone(previous?.recovery ?? emptyJournalRecovery()) };
}

function words(row: ProgressJournal<AppProgressData>): WordField[] {
  return [row.acknowledged.data, row.sent?.base.data, row.sent?.data, row.live, row.conflict?.remote.data]
    .flatMap(data => extractProgressWords(row.appId, data).fields);
}

/**
 * Coverage is a witness, not a durable receipt. The caller must atomically write
 * the ENTIRE compacted envelope successfully before relying on this result.
 * A memory-only owner-storage read cannot authorize independent source removal.
 */
export function journalOriginalRetention(original: JournalOriginal, current: string, address: JournalAddress): "pinned" | "covered" | "capture" {
  const before = parseProgressJournal(original.raw, address.appId, address.ownerId);
  const after = parseProgressJournal(current, address.appId, address.ownerId);
  if (!before || !after || after.writerId !== address.writerId) return "pinned";
  if (original.choice && (after.forceWrite || after.conflict !== null)) return "pinned";
  const kept = words(after);
  return words(before).every(field => kept.some(candidate => sameProgress(field, candidate))) ? "covered" : "capture";
}
