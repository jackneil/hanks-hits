import type { createOwnerBoundProgress, ProgressLease } from "@/lib/owner-bound-progress/core";
import { OWNER_KEY_SALT } from "@/shared/clips/library/ownerKey";
import { cloneProgress, parseProgressJournal, type ProgressJournal } from "@/shared/lib/progressJournal";
import { journalOriginalId, journalSourceId, emptyJournalRecovery, type JournalCopy } from "@/shared/lib/progressJournalRecovery";
import type { JournalRecovery } from "@/shared/lib/progressJournalRepository";
import { sameProgress } from "@/shared/lib/progressStamp";
import { BAKERY_JOURNAL_PREFIX, parseBakeryJournal, type BakeryJournal } from "./sync-session";
import type { CookieClickerProgress } from "./store";

type Authority = Pick<ReturnType<typeof createOwnerBoundProgress>,
  "isCurrent" | "matchesSession" | "listDurableScoped" | "readDurableScoped" | "listDurableLegacy" | "readLegacy">;
const APP = "cookie-clicker";

/** Conversion is read-only. Original bytes, including old retirement and guest evidence, are never rewritten. */
export function importBakeryJournal(sourceKey: string, raw: string, ownerId: string, ownerKey: string): JournalCopy | null {
  if (!ownerId || ownerKey !== `u_${journalOriginalId(OWNER_KEY_SALT + ownerId).slice(0, 20)}`) return null;
  const old = parseBakeryJournal(raw, ownerId);
  if (!old) return null;
  const writerId = `bakery-${journalOriginalId(JSON.stringify([sourceKey, raw]))}`;
  const imported = { kind: "bakery-v1" as const, sourceKey, raw };
  const convert = (source: Pick<BakeryJournal, "acknowledged" | "sent" | "live">, backup = false) => {
    if (source.sent === undefined) return null;
    const journal: ProgressJournal<CookieClickerProgress> = {
      version: 1, appId: APP, ownerId, writerId: backup ? `${writerId}-backup` : writerId,
      serial: 0, acknowledged: cloneProgress(source.acknowledged), sent: cloneProgress(source.sent), live: cloneProgress(source.live),
      // Old delivery/retirement rules cannot grant automatic replay permission.
      // The original request remains intact, but a fresh displayed choice is required.
      conflict: { remote: cloneProgress(old.conflict ?? source.acknowledged), reason: "unknown-lineage", paths: ["$root"] },
      forceWrite: false, imported,
    };
    const converted = JSON.stringify(journal);
    return parseProgressJournal(converted, APP, ownerId) ? converted : null;
  };
  const current = convert(old);
  if (!current) return null;
  const backup = old.choiceBackup ? convert(old.choiceBackup, true) : null;
  if (old.choiceBackup && !backup) return null;
  return { writerId, sourceId: journalSourceId(ownerKey, APP, writerId, current), envelope: {
    format: "hh-progress-journal", version: 3, generation: 0, current,
    originals: backup ? [{ raw: backup, choice: true }] : [], recovery: emptyJournalRecovery(),
  } };
}

/** Complete owner-pinned inventory. Unknown ownership or unreadable bytes block automatic recovery. */
export function inventoryBakeryJournals(authority: Authority, lease: ProgressLease, ownerId: string): JournalRecovery {
  const denied = (): JournalRecovery => ({ copies: [], unavailable: true });
  if (!authority.isCurrent(lease) || !authority.matchesSession("authenticated", ownerId)) return denied();
  const scoped = authority.listDurableScoped(BAKERY_JOURNAL_PREFIX, lease);
  const legacy = authority.listDurableLegacy(BAKERY_JOURNAL_PREFIX, lease);
  if (!scoped.available || !legacy.available) return denied();
  const copies: JournalCopy[] = [];
  let unavailable = false;
  for (const entry of [
    ...scoped.keys.map(key => ({ key, scoped: true })), ...legacy.keys.map(key => ({ key, scoped: false })),
  ]) {
    if (!authority.isCurrent(lease)) return denied();
    if (!entry.key.endsWith("-storage")) { unavailable = true; continue; }
    let raw: string | null;
    if (entry.scoped) {
      const read = authority.readDurableScoped(entry.key, lease);
      if (read.status === "unavailable") { unavailable = true; continue; }
      raw = read.status === "durable" ? read.raw : null;
    } else {
      const read = authority.readLegacy(entry.key);
      if (!read.markerReadable) { unavailable = true; continue; }
      raw = read.raw;
    }
    if (raw === null) continue;
    try {
      const identity: unknown = JSON.parse(raw);
      if (!identity || typeof identity !== "object" || !("ownerId" in identity)
        || typeof identity.ownerId !== "string" || !identity.ownerId) { unavailable = true; continue; }
      if (identity.ownerId !== ownerId) { if (entry.scoped) unavailable = true; continue; }
      const old = parseBakeryJournal(raw, ownerId);
      if (!old) { unavailable = true; continue; }
      const sourceKey = entry.scoped ? `owner:${lease.ownerKey}:${entry.key}` : entry.key;
      const converted = importBakeryJournal(sourceKey, raw, ownerId, lease.ownerKey);
      // Even a nominally clean source must validate nested backup/sent fields.
      if (!converted) { unavailable = true; continue; }
      if (!old.sent && !old.conflict && !old.resolving && !old.choiceBackup && !old.guestCandidateIds?.length
        && (sameProgress(old.live, old.acknowledged.data) || (old.acknowledged.data === null && old.live.lastModified <= 0))) continue;
      copies.push(converted);
    } catch { unavailable = true; }
  }
  return authority.isCurrent(lease) ? { copies, unavailable } : denied();
}
