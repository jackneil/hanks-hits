import { resolveMergedSave } from "@/lib/progress-merge";
import { validateProgress } from "@/lib/progress-schemas";
import { sameProgress } from "@/shared/lib/progressStamp";
import type { CookieClickerProgress } from "./store";

export type BakerySnapshot = { data: CookieClickerProgress | null; revision: string | null };
export type BakeryRequest = { id: string; base: BakerySnapshot; data: CookieClickerProgress };
export type BakeryJournal = {
  version: 1;
  ownerId: string;
  writerId: string;
  serial?: number;
  acknowledged: BakerySnapshot;
  sent: BakeryRequest | null;
  live: CookieClickerProgress;
  conflict: BakerySnapshot | null;
  resolving: boolean;
  choiceBackup: { live: CookieClickerProgress; acknowledged: BakerySnapshot; sent: BakeryRequest | null } | null;
  resolvedCopies?: Array<[string, number]>;
  /** Exact guest sources included in a player's explicit bakery choice. */
  guestCandidateIds?: string[];
};

// A separate logical key per writer prevents one tab from erasing another's
// pending operation. The adapter stores new journals in the captured owner's
// namespace; legacy journals retain this key and are never rewritten or removed.
export const BAKERY_JOURNAL_PREFIX = "cookie-clicker-sync-";
export const bakeryJournalKey = (writerId: string) => `${BAKERY_JOURNAL_PREFIX}${writerId}-storage`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function isBakery(value: unknown): value is CookieClickerProgress {
  return validateProgress("cookie-clicker", value).success;
}

export function isBakerySnapshot(value: unknown): value is BakerySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as BakerySnapshot;
  if (snapshot.revision === null) return snapshot.data === null;
  return typeof snapshot.revision === "string" && /^[a-f0-9]{64}$/.test(snapshot.revision)
    && (snapshot.data === null || isBakery(snapshot.data));
}

/** Corrupt or foreign records never become a candidate for this account. */
export function parseBakeryJournal(raw: string, ownerId: string): BakeryJournal | null {
  try {
    const row = JSON.parse(raw) as BakeryJournal;
    if (row.version !== 1 || row.ownerId !== ownerId || typeof row.writerId !== "string" ||
        !/^[a-zA-Z0-9-]+$/.test(row.writerId) || !isBakerySnapshot(row.acknowledged) ||
        !isBakery(row.live) || typeof row.resolving !== "boolean") return null;
    if (row.sent !== null && (!row.sent || typeof row.sent.id !== "string" ||
        !isBakerySnapshot(row.sent.base) || !isBakery(row.sent.data))) return null;
    if (row.conflict !== null && !isBakerySnapshot(row.conflict)) return null;
    if (row.choiceBackup !== null && (!row.choiceBackup || !isBakery(row.choiceBackup.live) ||
        !isBakerySnapshot(row.choiceBackup.acknowledged))) return null;
    if (row.serial !== undefined && (!Number.isSafeInteger(row.serial) || row.serial < 0)) return null;
    if (row.resolvedCopies !== undefined && (!Array.isArray(row.resolvedCopies) || row.resolvedCopies.some(
      (entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Number.isSafeInteger(entry[1]) || entry[1] < 0,
    ))) return null;
    if (row.guestCandidateIds !== undefined && (!Array.isArray(row.guestCandidateIds)
      || row.guestCandidateIds.some(id => typeof id !== "string"))) return null;
    return copy(row);
  } catch {
    return null;
  }
}

/** The exact server continuation rule, including validation and record salvage. */
function continueBakery(base: CookieClickerProgress | null, incoming: CookieClickerProgress): CookieClickerProgress {
  if (!base) return copy(incoming);
  const result = resolveMergedSave(incoming, { data: base, updatedAt: new Date(0) }, "cookie-clicker",
    (data) => validateProgress("cookie-clicker", data), { continuation: true });
  if (result.kind !== "write") throw new Error("A bakery continuation could not be validated");
  return result.data as CookieClickerProgress;
}

/**
 * Cookie-only acknowledged/sent/live state machine. Network and React belong
 * to the adapter. Every transition checks the mounted account again, including
 * responses received after sign-out. Failed persistence leaves memory intact
 * and is surfaced by the adapter; it never pretends reload recovery succeeded.
 */
export class BakerySyncSession {
  private journal: BakeryJournal;
  storageAvailable = true;

  constructor(journal: BakeryJournal, private readonly io: {
    maySave: () => boolean;
    persist: (key: string, value: string) => void;
    requestId: () => string;
  }) {
    this.journal = copy(journal);
  }

  snapshot(): BakeryJournal { return copy(this.journal); }

  private persist(): void {
    if (!this.io.maySave()) return;
    try {
      this.journal.serial = (this.journal.serial ?? 0) + 1;
      this.io.persist(bakeryJournalKey(this.journal.writerId), JSON.stringify(this.journal));
      this.storageAvailable = true;
    } catch {
      this.storageAvailable = false;
    }
  }

  capture(live: CookieClickerProgress): void {
    if (!this.io.maySave()) return;
    this.journal.live = copy(live);
    this.persist();
  }

  /** Immutable retirement receipts avoid deleting a concurrently edited tab's key. */
  retire(copies: Array<[string, number]>): void {
    if (!this.io.maySave()) return;
    this.journal.resolvedCopies = [...(this.journal.resolvedCopies ?? []), ...copies];
    this.persist();
  }

  /** Retries keep the same sent snapshot, even while the bakery keeps baking. */
  prepare(live: CookieClickerProgress): BakeryRequest | null {
    if (!this.io.maySave()) return null;
    this.capture(live);
    if (this.journal.conflict && !this.journal.resolving) return null;
    if (this.journal.sent) return copy(this.journal.sent);
    if (!this.journal.resolving && sameProgress(this.journal.acknowledged.data, live)) return null;
    this.journal.sent = {
      id: this.io.requestId(), base: copy(this.journal.acknowledged), data: copy(live),
    };
    this.persist();
    return copy(this.journal.sent);
  }

  /** A beacon may call prepare, but must never call receive as a successful ACK. */
  receive(request: BakeryRequest, remote: BakerySnapshot, ok: boolean,
    live: CookieClickerProgress): "saved" | "retry" | "conflict" | "ignored" {
    if (!this.io.maySave() || this.journal.sent?.id !== request.id || !isBakerySnapshot(remote)) return "ignored";
    this.journal.live = copy(live);
    const expected = continueBakery(request.base.data, request.data);
    if (ok || sameProgress(remote.data, expected)) {
      if (!remote.data) return "ignored";
      // Later wallet edits stay authoritative. Only server record reconciliation
      // can differ after a matching revision; never add cookie balances/deltas.
      this.journal.live = sameProgress(live, request.data)
        ? copy(remote.data) : continueBakery(remote.data, live);
      this.journal.acknowledged = copy(remote);
      this.journal.sent = null;
      this.journal.conflict = null;
      this.journal.resolving = false;
      this.journal.choiceBackup = null;
      this.persist();
      return "saved";
    }
    // A legacy no-op can advance the revision without changing the base. This
    // equality proves it is safe to retry the same snapshot on that revision.
    // Null data may be a new deletion fence, never permission to recreate.
    if (remote.data !== null && sameProgress(remote.data, request.base.data)) {
      this.journal.acknowledged = copy(remote);
      this.journal.sent = { ...copy(request), id: this.io.requestId(), base: copy(remote) };
      this.persist();
      return "retry";
    }
    this.journal.conflict = copy(remote);
    this.journal.resolving = false;
    this.persist();
    return "conflict";
  }

  /** An explicit choice is conditional on the exact alternative shown to the player. */
  choose(displayed: BakerySnapshot, selected: CookieClickerProgress, alternatives: CookieClickerProgress[] = [], guestCandidateIds: string[] = []): boolean {
    if (!this.io.maySave() || !sameProgress(displayed, this.journal.conflict)) return false;
    this.journal.choiceBackup ??= copy({
      live: this.journal.live, acknowledged: this.journal.acknowledged, sent: this.journal.sent,
    });
    this.journal.acknowledged = copy(displayed);
    const records = alternatives.reduce((kept, alternative) => continueBakery(alternative, kept), selected);
    this.journal.live = continueBakery(displayed.data, continueBakery(this.journal.live, records));
    this.journal.sent = null;
    this.journal.resolving = true;
    this.journal.guestCandidateIds = [...new Set([...(this.journal.guestCandidateIds ?? []), ...guestCandidateIds])];
    // Keep the old conflict until a matching write is acknowledged.
    this.persist();
    return true;
  }
}
