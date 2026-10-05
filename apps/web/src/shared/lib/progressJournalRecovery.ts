import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { isOwnerKey, OWNER_KEY_SALT, sha256 } from "@/shared/clips/library/ownerKey";
import { cloneProgress, parseProgressJournal, type ProgressJournal } from "./progressJournal";
import type { JournalAddress, JournalEnvelope, JournalOriginal } from "./progressJournalEnvelope";
import { sameProgress } from "./progressStamp";

export type JournalResolution = { sourceId: string; revision: string };
export type JournalRecoveryMetadata = { version: 1; adoptedSources: string[]; resolutions: JournalResolution[] };
export type JournalCopy = { sourceId: string; writerId: string; envelope: JournalEnvelope };
export type RecoveryAddress = JournalAddress & { ownerKey: string };
const hash = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);
const revision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const emptyJournalRecovery = (): JournalRecoveryMetadata => ({ version: 1, adoptedSources: [], resolutions: [] });

/** Identity excludes envelope generation/compaction metadata, but includes exact journal bytes. */
export const journalSourceId = (ownerKey: string, appId: ValidAppId, writerId: string, raw: string): string =>
  JSON.stringify([ownerKey, appId, writerId, hash(raw)]);

export function isJournalSourceId(value: unknown, appId: ValidAppId, ownerKey?: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 4 && typeof parts[0] === "string" && isOwnerKey(parts[0])
      && (ownerKey === undefined || parts[0] === ownerKey) && parts[1] === appId && identifier(parts[2])
      && revision(parts[3]) && JSON.stringify(parts) === value;
  } catch { return false; }
}

export function isJournalRecovery(value: unknown, appId: ValidAppId, ownerKey?: string): value is JournalRecoveryMetadata {
  return object(value) && value.version === 1 && Array.isArray(value.adoptedSources)
    && value.adoptedSources.every(id => isJournalSourceId(id, appId, ownerKey))
    && Array.isArray(value.resolutions) && value.resolutions.every(item => object(item)
      && isJournalSourceId(item.sourceId, appId, ownerKey) && revision(item.revision));
}

/**
 * Install this journal directly into ProgressSyncSession, then observe the
 * canonical row. Never prepare a fresh request from somebody else's pending
 * copy: its original writer could have dispatched after our inventory read.
 * The coordinator must check complete inventory availability and resolutions
 * before calling this conversion; conversion alone is not adoption permission.
 */
export function adoptJournalCopy<T extends AppProgressData>(copy: JournalCopy, address: RecoveryAddress): {
  journal: ProgressJournal<T>; recovery: JournalRecoveryMetadata; originals: JournalOriginal[];
} {
  const old = parseProgressJournal<T>(copy.envelope.current, address.appId, address.ownerId);
  const recovery = copy.envelope.recovery ?? emptyJournalRecovery();
  if (!old || old.writerId !== copy.writerId || !identifier(address.writerId) || address.writerId === old.writerId
    || address.ownerKey !== `u_${hash(OWNER_KEY_SALT + address.ownerId).slice(0, 20)}`
    || !isJournalRecovery(recovery, address.appId, address.ownerKey)
    || copy.sourceId !== journalSourceId(address.ownerKey, address.appId, copy.writerId, copy.envelope.current)
    || copy.envelope.originals.some(item => !parseProgressJournal(item.raw, address.appId, address.ownerId))) throw new Error("Invalid recovery source");
  const journal = { ...cloneProgress(old), writerId: address.writerId };
  if (!journal.sent && !journal.conflict && (journal.forceWrite || !sameProgress(journal.live, journal.acknowledged.data))) {
    journal.sent = { id: `recovery-${hash(copy.envelope.current)}`, base: cloneProgress(journal.acknowledged), data: cloneProgress(journal.live) };
  }
  return {
    journal,
    recovery: { version: 1, adoptedSources: [...new Set([copy.sourceId, ...recovery.adoptedSources])], resolutions: cloneProgress(recovery.resolutions) },
    originals: [{ raw: copy.envelope.current, choice: false }, ...cloneProgress(copy.envelope.originals)],
  };
}

/** Resolve exact sources only; another version of that writer is independent. */
export function resolvedJournalSources(copies: readonly JournalCopy[], appId: ValidAppId, ownerKey: string): Set<string> | null {
  const resolved = new Set<string>();
  for (const copy of copies) {
    const recovery = copy.envelope.recovery ?? emptyJournalRecovery();
    if (!isJournalRecovery(recovery, appId, ownerKey)) return null;
    for (const receipt of recovery.resolutions) resolved.add(receipt.sourceId);
  }
  return resolved;
}
