import type { ValidAppId } from "@hank-neil/db/schema";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { parseProgressJournal, PROGRESS_JOURNAL_PREFIX } from "@/shared/lib/progressJournal";
import { readJournalEnvelope } from "@/shared/lib/progressJournalEnvelope";
import { sameProgress } from "@/shared/lib/progressStamp";

/** This fixture uses plain physical localStorage. Credit only selectable, durable bytes. */
export function inspectDurableRecovery(appId: ValidAppId, ownerId: string): Record<string, unknown>[] {
  const entry = progressSyncPresentation.getSnapshot().find(row => row.appId === appId);
  if (!entry?.localDurable) return [];
  const dialog = entry.open();
  if (!dialog) return [];
  try {
    // Opening captures live edits and may discover a failed checkpoint write.
    if (!progressSyncPresentation.getSnapshot().find(row => row.id === entry.id)?.localDurable) return [];
    const durable: unknown[] = [];
    const prefix = `${PROGRESS_JOURNAL_PREFIX}${appId}-`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(prefix) || !key.endsWith("-storage")) continue;
      const envelope = readJournalEnvelope(localStorage.getItem(key)!, {
        appId, ownerId, writerId: key.slice(prefix.length, -"-storage".length),
      });
      if (!envelope) continue;
      for (const raw of [envelope.current, ...envelope.originals.map(original => original.raw)]) {
        const row = parseProgressJournal(raw, appId, ownerId)!;
        durable.push(row.live, row.acknowledged.data, row.sent?.data, row.conflict?.remote.data);
      }
    }
    return dialog.options.filter(option => durable.some(data => sameProgress(data, option.data)))
      .map(option => option.data as Record<string, unknown>);
  } catch { return []; }
  finally { dialog.close(); }
}
