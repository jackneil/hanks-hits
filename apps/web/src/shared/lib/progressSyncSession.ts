import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { mergeProgressConflict } from "./progressConflict";
import { sameProgress } from "./progressStamp";
import {
  cloneProgress, isJournalProgress, isProgressSnapshot, parseProgressJournal,
  type ProgressConflict, type ProgressJournal, type ProgressRequest, type ProgressSnapshot,
} from "./progressJournal";

type Result = "saved" | "pending" | "conflict" | "blocked" | "ignored";

/**
 * Owner-bound state machine; the adapter owns network, storage and presentation.
 * A persisted sent request is ALWAYS uncertain after a crash. Only its first
 * response in this session can prove rejection and authorize a three-way rebase.
 */
export class ProgressSyncSession<T extends AppProgressData> {
  private journal: ProgressJournal<T>;
  private freshRequest: string | null = null;
  private raw: string;
  private replayReady = false;
  private unpreserved: string[] = [];
  storageAvailable = true;

  constructor(raw: string, appId: ValidAppId, ownerId: string, private readonly io: {
    maySave: () => boolean;
    /**
     * Before replacing the current row, durably preserve every `originals` entry byte for
     * byte under its owner/writer/serial. False/throw blocks the transition.
     * Archived sources require Part C capture receipts before any retirement.
     */
    persist: (next: string, originals: readonly string[]) => boolean;
    requestId: () => string;
  }) {
    const journal = parseProgressJournal<T>(raw, appId, ownerId);
    if (!journal) throw new Error("Invalid progress journal");
    this.journal = journal;
    this.raw = raw;
  }

  snapshot(): ProgressJournal<T> | null {
    return this.io.maySave() ? cloneProgress(this.journal) : null;
  }

  private write(next: ProgressJournal<T>, preserve = false): boolean {
    if (!this.io.maySave()) return false;
    if (this.journal.serial === Number.MAX_SAFE_INTEGER) { this.storageAvailable = false; return false; }
    next.serial = this.journal.serial + 1;
    const raw = JSON.stringify(next);
    const originals = [...new Set([
      ...this.unpreserved, ...(preserve ? [this.raw] : []),
      ...(preserve && !sameProgress(JSON.parse(this.raw), this.journal) ? [JSON.stringify(this.journal)] : []),
    ])];
    try { this.storageAvailable = this.io.persist(raw, originals); }
    catch { this.storageAvailable = false; }
    if (!this.storageAvailable || !this.io.maySave()) {
      this.unpreserved = originals;
      return false;
    }
    this.unpreserved = [];
    this.journal = next;
    this.raw = raw;
    return true;
  }

  capture(live: T): boolean {
    if (!this.io.maySave() || !isJournalProgress(this.journal.appId, live)) return false;
    if (sameProgress(this.journal.live, live) && this.storageAvailable) return true;
    const next = { ...cloneProgress(this.journal), live: cloneProgress(live) };
    if (this.write(next, true)) return true;
    // Keep the player's latest edit in memory even when the disk is full. No
    // request is dispatched, and no reconciliation discards the durable row.
    if (this.io.maySave()) this.journal = next;
    return false;
  }

  prepare(live: T): ProgressRequest<T> | null {
    if (!this.capture(live) || !this.io.maySave()) return null;
    const row = this.journal;
    if (row.conflict) return null;
    if (row.sent) {
      if (!this.replayReady) return null;
      this.replayReady = false;
      return cloneProgress(row.sent);
    }
    if (!row.forceWrite && sameProgress(row.live, row.acknowledged.data)) return null;
    const sent = { id: this.io.requestId(), base: cloneProgress(row.acknowledged), data: cloneProgress(row.live) };
    const next = { ...cloneProgress(row), sent };
    if (!parseProgressJournal<T>(JSON.stringify(next), row.appId, row.ownerId) || !this.write(next)) return null;
    this.freshRequest = sent.id;
    this.replayReady = false;
    return cloneProgress(sent);
  }

  /** Timeout, failed fetch, queued beacon or invalid response never count as ACK. */
  uncertain(requestId: string): void {
    if (this.io.maySave() && this.journal.sent?.id === requestId) {
      this.freshRequest = null;
      this.replayReady = false;
    }
  }

  private conflict(remote: ProgressSnapshot<T>, reason: ProgressConflict<T>["reason"], paths: string[]): Result {
    const next = { ...cloneProgress(this.journal), conflict: { remote: cloneProgress(remote), reason, paths } };
    return this.write(next, true) ? "conflict" : "blocked";
  }

  private accept(remote: ProgressSnapshot<T>, sent: ProgressRequest<T>): Result {
    if (remote.data === null) return "ignored";
    // Rebase edits made while the request was in flight over the actual ACK.
    const merged = mergeProgressConflict(this.journal.appId, sent.data, this.journal.live, remote.data);
    if (merged.kind === "conflict") return this.conflict(remote, "canonical-change", merged.paths);
    const next = { ...cloneProgress(this.journal), acknowledged: cloneProgress(remote), live: merged.data,
      sent: null, conflict: null, forceWrite: false };
    if (!this.write(next, true)) return "blocked";
    this.freshRequest = null;
    this.replayReady = false;
    return sameProgress(next.live, remote.data) ? "saved" : "pending";
  }

  private rebase(remote: ProgressSnapshot<T>): Result {
    const row = this.journal;
    let live = row.live;
    if (row.acknowledged.data === null || remote.data === null) {
      if (!sameProgress(row.acknowledged, remote)) return this.conflict(remote, "unknown-lineage", ["$root"]);
    } else {
      const merged = mergeProgressConflict(row.appId, row.acknowledged.data, live, remote.data);
      if (merged.kind === "conflict") return this.conflict(remote, "concurrent-edit", merged.paths);
      live = merged.data;
    }
    const next = { ...cloneProgress(row), acknowledged: cloneProgress(remote), live, sent: null, conflict: null };
    if (!this.write(next, true)) return "blocked";
    this.freshRequest = null;
    this.replayReady = false;
    return !next.forceWrite && sameProgress(live, remote.data) ? "saved" : "pending";
  }

  receive(requestId: string, remote: ProgressSnapshot<T>, outcome: "accepted" | "rejected", live: T): Result {
    if (!this.io.maySave() || this.journal.sent?.id !== requestId
      || !isProgressSnapshot<T>(this.journal.appId, remote)) return "ignored";
    if (!this.capture(live)) { this.uncertain(requestId); return "blocked"; }
    const sent = this.journal.sent!;
    if (outcome === "accepted") return this.accept(remote, sent);
    if (this.freshRequest === requestId) return this.rebase(remote);
    return this.observe(remote);
  }

  /** Cold recovery / reconnect GET, before any remote copy touches the store. */
  observe(remote: ProgressSnapshot<T>): Result {
    if (!this.io.maySave() || !isProgressSnapshot<T>(this.journal.appId, remote)) return "ignored";
    this.freshRequest = null;
    this.replayReady = false;
    const row = this.journal;
    if (row.conflict) return this.conflict(remote, row.conflict.reason, row.conflict.paths);
    if (!row.sent) return this.rebase(remote);
    // Equality to the sent copy proves it is redundant now. Equality to the OLD
    // BASE with an advanced revision does not: another player may have deleted
    // an addition after it committed. Preserve that as an ambiguous choice.
    if (!row.forceWrite && sameProgress(remote.data, row.sent.data)) return this.accept(remote, row.sent);
    if (sameProgress(remote, row.sent.base)) {
      // The original may still arrive after this GET. Retry the SAME immutable
      // operation without restoring first-attempt status, including after a crash.
      this.replayReady = true;
      return "pending";
    }
    return this.conflict(remote, "ambiguous-delivery", ["$root"]);
  }

  /** The exact displayed revision fences an explicit choice against later edits. */
  choose(displayed: ProgressSnapshot<T>, selected: "local" | "server" | { empty: T }): boolean {
    if (!this.io.maySave() || !sameProgress(displayed, this.journal.conflict?.remote)) return false;
    // A deleted cloud row has no playable state. The adapter offers "Start
    // fresh" with this game's validated defaults and sends a conditional write
    // against the absent row. That write fences a delayed pre-deletion request.
    if (typeof selected === "object" && displayed.data !== null) return false;
    const live = typeof selected === "object" ? selected.empty
      : selected === "local" ? this.journal.live : displayed.data;
    if (live === null || !isJournalProgress(this.journal.appId, live)) return false;
    const next = { ...cloneProgress(this.journal), acknowledged: cloneProgress(displayed), live: cloneProgress(live),
      sent: null, conflict: null, forceWrite: true };
    if (!this.write(next, true)) return false;
    this.freshRequest = null;
    this.replayReady = false;
    return true;
  }
}
