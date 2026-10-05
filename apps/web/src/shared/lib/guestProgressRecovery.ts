import type { ValidAppId } from "@hank-neil/db/schema";
import type { DurableGuestCandidate, OwnerBoundProgress, ProgressLease } from "@/lib/owner-bound-progress/core";
import { PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress/keys";
import type { MigrationDatabase } from "@/lib/local-words/migration";
import type { SourceRecord } from "@/lib/local-words/database";
import { extractProgressWords, WORD_EXTRACTION_VERSION } from "@/lib/progress-words";
import { ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { isJournalProgress, parseProgressJournal, type ProgressJournal } from "./progressJournal";
import { emptyJournalRecovery, journalOriginalId, journalSourceId, resolvedJournalSources, type JournalCopy } from "./progressJournalRecovery";
import type { JournalRecovery, ProgressJournalRepository } from "./progressJournalRepository";
import { progressFromSave } from "./untouchedProgress";

type GuestAddress = { appId: ValidAppId; ownerId: string; lease: ProgressLease; authority: OwnerBoundProgress };
const denied = (): JournalRecovery => ({ copies: [], unavailable: true });
const current = (io: GuestAddress) => io.authority.isCurrent(io.lease) && io.authority.matchesSession("authenticated", io.ownerId);
const progress = (appId: ValidAppId, raw: string, loadAt: number) => {
  try {
    const save = JSON.parse(raw);
    return progressFromSave(appId, save?.state, loadAt);
  } catch { return null; }
};

function guestCopy(io: GuestAddress, candidate: DurableGuestCandidate): JournalCopy | null {
  if (candidate.projectedRaw === null) return null;
  try {
    const source = JSON.parse(candidate.raw);
    const supportedVersion = io.appId === "checkers" ? 2 : ["oregon-trail", "retro-arcade"].includes(io.appId) ? 1 : 0;
    if (source.version !== undefined && (!Number.isInteger(source.version) || source.version < 0 || source.version > supportedVersion)) return null;
  } catch { return null; }
  const live = progress(io.appId, candidate.projectedRaw, candidate.loadAt);
  if (!isJournalProgress(io.appId, live)) return null;
  const writerId = `guest-${candidate.id}`;
  const journal: ProgressJournal<typeof live> = {
    version: 1, appId: io.appId, ownerId: io.ownerId, writerId, serial: 0,
    acknowledged: { data: null, revision: null }, sent: null, live, forceWrite: false,
    conflict: { remote: { data: null, revision: null }, reason: "unknown-lineage", paths: ["$root"] },
    imported: { kind: "guest-v2", sourceKey: PROGRESS_STORAGE_KEYS[io.appId], raw: candidate.raw,
      candidateId: candidate.id, loadAt: candidate.loadAt },
  };
  const raw = JSON.stringify(journal);
  if (!parseProgressJournal(raw, io.appId, io.ownerId)) return null;
  return { writerId, sourceId: journalSourceId(io.lease.ownerKey, io.appId, writerId, raw), envelope: {
    format: "hh-progress-journal", version: 3, generation: 0, current: raw,
    originals: [], recovery: emptyJournalRecovery(),
  } };
}

/** Original words remain guest-owned. Account association grants no permission to publish them. */
function wordSource(appId: ValidAppId, candidate: DurableGuestCandidate): SourceRecord {
  const original = progress(appId, candidate.raw, candidate.loadAt);
  const sourceKey = `guest-candidate:${PROGRESS_STORAGE_KEYS[appId]}:${candidate.id}:${original === null ? "original" : "words"}`;
  const sourceVersion = `guest:2:words:${WORD_EXTRACTION_VERSION}`;
  const digest = journalOriginalId(candidate.raw);
  return {
    id: JSON.stringify(["guest", appId, sourceKey, sourceVersion, digest]), ownerKey: "guest", appId,
    sourceKey, sourceVersion, digest, raw: candidate.raw,
    fields: extractProgressWords(appId, original).fields,
  };
}

/** Preserve exact originals before exposing projected choices. Never ACK or remove a source here. */
export async function inventoryGuestJournals(io: GuestAddress & { words: MigrationDatabase }): Promise<JournalRecovery> {
  try {
    if (!current(io) || await ownerKeyFor(io.ownerId) !== io.lease.ownerKey || !current(io)) return denied();
    const inventory = io.authority.listDurableGuestCandidates(PROGRESS_STORAGE_KEYS[io.appId], io.lease);
    let unavailable = inventory.unavailable;
    const copies: JournalCopy[] = [];
    if (inventory.candidates.length) {
      // Check both deletion fences. Guest provenance survives account deletion,
      // but a revoked account cannot initiate any more preservation work.
      if (await io.words.ownerEpoch(io.lease.ownerKey) !== 0 || !current(io)
        || await io.words.ownerEpoch("guest") !== 0 || !current(io)) return denied();
    }
    for (const candidate of inventory.candidates) {
      if (!current(io)) return denied();
      await io.words.capture(wordSource(io.appId, candidate), 0);
      if (!current(io)) return denied();
      const copy = guestCopy(io, candidate);
      if (copy) copies.push(copy); else unavailable = true;
    }
    // A source may change while IndexedDB commits. A receipt for old bytes is
    // useful preservation, but cannot authorize the newly displayed cohort.
    const latest = io.authority.listDurableGuestCandidates(PROGRESS_STORAGE_KEYS[io.appId], io.lease);
    if (latest.unavailable || JSON.stringify(latest.candidates) !== JSON.stringify(inventory.candidates)) return denied();
    return current(io) ? { copies, unavailable } : denied();
  } catch { return denied(); }
}

/** Retry local transfer bookkeeping from durable generic receipts, with no HTTP or new choice. */
export async function acknowledgeResolvedGuests(io: GuestAddress & {
  repository: Pick<ProgressJournalRepository, "recover">;
}): Promise<boolean> {
  try {
    if (!current(io)) return false;
    const recovery = await io.repository.recover();
    if (recovery.unavailable || !current(io)) return false;
    const resolved = resolvedJournalSources(recovery.copies, io.appId, io.lease.ownerKey);
    if (!resolved) return false;
    const key = PROGRESS_STORAGE_KEYS[io.appId];
    const inventory = io.authority.listDurableGuestCandidates(key, io.lease);
    if (inventory.unavailable) return false;
    let complete = true;
    for (const candidate of inventory.candidates) {
      const copy = guestCopy(io, candidate);
      if (!copy || !resolved.has(copy.sourceId)) { complete = false; continue; }
      if (!current(io) || !io.authority.flushStore(key, io.lease)
        || !io.authority.acknowledgeGuestCandidate(key, candidate.id, io.lease)) return false;
    }
    return complete && current(io);
  } catch { return false; }
}
