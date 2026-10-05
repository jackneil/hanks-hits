import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { cloneProgress, isProgressSnapshot, newProgressJournal, parseProgressJournal,
  type ProgressJournal, type ProgressSnapshot } from "./progressJournal";
import { ProgressJournalRepository, type JournalCopy } from "./progressJournalRepository";
import { resolvedJournalSources } from "./progressJournalRecovery";
import { ProgressSyncSession } from "./progressSyncSession";
import { sameProgress } from "./progressStamp";

type RuntimeOptions<T extends AppProgressData> = {
  appId: ValidAppId; ownerId: string; ownerKey: string; writerId: string;
  repository: ProgressJournalRepository;
  maySave: () => boolean;
  getLive: () => T;
  applyLive: (data: T) => void;
  isUntouched: (data: T) => boolean;
  requestId: () => string;
};
export type ProgressRuntimeSnapshot<T> = {
  phase: "loading" | "ready" | "blocked" | "revoked";
  journal: ProgressJournal<T> | null;
  copies: JournalCopy[];
};

/**
 * Shared runtime initialization. Recovery finishes before cloud adoption, and
 * every asynchronous storage boundary is followed by a live-store reread.
 * Network scheduling and presentation use this same session after initialization.
 */
export class ProgressSyncRuntime<T extends AppProgressData> {
  private session: ProgressSyncSession<T> | null = null;
  private phase: ProgressRuntimeSnapshot<T>["phase"] = "loading";
  private copies: JournalCopy[] = [];
  private alive = true;
  private initializing: Promise<boolean> | null = null;
  private adoptionSource: string | null = null;
  private boot: { raw: string; expectedLive: T; adoptingCloud: boolean } | null = null;
  constructor(private readonly io: RuntimeOptions<T>) {}

  private allowed = () => this.alive && this.io.maySave();
  snapshot(): ProgressRuntimeSnapshot<T> {
    return this.allowed()
      ? { phase: this.phase, journal: this.session?.snapshot() ?? null, copies: cloneProgress(this.copies) }
      : { phase: "revoked", journal: null, copies: [] };
  }
  deactivate(): void { this.alive = false; }

  initialize(canonical: ProgressSnapshot<T>): Promise<boolean> {
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeOnce(canonical).catch(() => this.block()).finally(() => { this.initializing = null; });
    return this.initializing;
  }

  private block(): false { this.phase = "blocked"; return false; }
  private install(raw: string): void {
    this.session = new ProgressSyncSession(raw, this.io.appId, this.io.ownerId, {
      maySave: this.allowed, persist: this.io.repository.persist, requestId: this.io.requestId,
    });
  }

  /** Includes a storage retry, but never assumes play stopped while it waited. */
  private async captureLatest(): Promise<boolean> {
    if (!this.allowed() || !this.session) return false;
    if (this.session.capture(this.io.getLive())) return true;
    await this.io.repository.settle();
    return this.allowed() && this.session.capture(this.io.getLive());
  }

  private async initializeOnce(canonical: ProgressSnapshot<T>): Promise<boolean> {
    const { repository, appId, ownerId, ownerKey, writerId } = this.io;
    if (!this.allowed() || !isProgressSnapshot<T>(appId, canonical)) return this.block();
    if (this.session) return this.observeInitialization(canonical);
    const beforeInventory = cloneProgress(this.io.getLive());
    const inventory = await repository.recover();
    if (!this.allowed() || inventory.unavailable) return this.block();
    const resolved = resolvedJournalSources(inventory.copies, appId, ownerKey);
    if (!resolved) return this.block();
    this.copies = inventory.copies.filter(copy => {
      if (copy.writerId === writerId || resolved.has(copy.sourceId)) return false;
      const row = parseProgressJournal<T>(copy.envelope.current, appId, ownerId)!;
      return row.sent !== null || row.conflict !== null || row.forceWrite
        || !sameProgress(row.live, row.acknowledged.data) || Boolean(copy.envelope.recovery?.adoptedSources.length);
    });
    const live = cloneProgress(this.io.getLive());
    if (!this.boot && !this.adoptionSource && this.copies.length === 1) {
      const source = this.copies[0];
      const row = parseProgressJournal<T>(source.envelope.current, appId, ownerId)!;
      if (sameProgress(row.live, live) && !source.envelope.recovery?.adoptedSources.some(id => resolved.has(id))) {
        this.adoptionSource = source.sourceId;
      }
    }
    if (!this.boot && this.adoptionSource) {
      // The repository's failed adoption draft owns this exact source ID,
      // even if its original writer advances before checkpoint storage recovers.
      const id = this.adoptionSource, prior = repository.snapshot();
      const retired = resolved.has(id) || prior?.recovery?.adoptedSources.some(source => resolved.has(source));
      const raw = retired ? prior?.current : await repository.adopt(id);
      if (!this.allowed()) return this.block();
      if (!raw) {
        if (!repository.snapshot()) this.adoptionSource = null; // No archived draft yet: refresh selection next time.
        return this.block();
      }
      this.adoptionSource = null;
      if (retired || this.copies.some(copy => copy.sourceId !== id)) {
        // A resolved ancestor or a newer source is not permission to replay
        // the old draft. Keep its immutable operation and require a choice.
        const row = parseProgressJournal<T>(raw, appId, ownerId)!;
        row.conflict = { remote: cloneProgress(canonical), reason: "unknown-lineage", paths: ["$root"] };
        this.boot = { raw: JSON.stringify(row), expectedLive: live, adoptingCloud: false };
        repository.persist(this.boot.raw, [raw]);
      } else {
        this.install(raw);
        // Adoption awaited archive/checkpoint writes. Capture play created
        // while those writes waited before observing or applying cloud state.
        return this.observeInitialization(canonical);
      }
    }
    if (!this.boot) {
      const untouched = this.copies.length === 0 && sameProgress(beforeInventory, live) && this.io.isUntouched(live);
      const adoptingCloud = untouched && canonical.data !== null && !sameProgress(live, canonical.data);
      const target = adoptingCloud ? canonical.data! : live;
      const related = this.copies.length === 0 && (untouched || sameProgress(live, canonical.data) || canonical.revision === null);
      const row = newProgressJournal(appId, ownerId, writerId, canonical, target, related);
      if (this.copies.length) row.conflict = { remote: cloneProgress(canonical), reason: "unknown-lineage", paths: ["$root"] };
      const raw = JSON.stringify(row);
      // Preserve even an untouched device copy before replacing it with cloud.
      const originals = adoptingCloud
        ? [JSON.stringify(newProgressJournal(appId, ownerId, writerId, canonical, live, false))] : [];
      this.boot = { raw, expectedLive: live, adoptingCloud };
      repository.persist(raw, originals);
    } else repository.persist(this.boot.raw, []);
    await repository.settle();
    if (!this.allowed() || !repository.isDurable() || repository.snapshot()?.current !== this.boot.raw) return this.block();
    const currentLive = cloneProgress(this.io.getLive());
    if (this.boot.adoptingCloud && !sameProgress(currentLive, this.boot.expectedLive)) {
      // Those edits were made on the old device copy, not the cloud ancestor.
      const raw = JSON.stringify(newProgressJournal(appId, ownerId, writerId, canonical, currentLive, false));
      repository.persist(raw, [this.boot.raw]);
      this.boot = { raw, expectedLive: currentLive, adoptingCloud: false };
      await repository.settle();
      if (!this.allowed() || !repository.isDurable() || repository.snapshot()?.current !== raw) return this.block();
    }
    const boot = this.boot;
    this.install(boot.raw);
    this.boot = null;
    if (boot.adoptingCloud) {
      // No await between this final comparison and apply. It is still the
      // untouched local snapshot whose replacement was durably preserved.
      if (!sameProgress(this.io.getLive(), boot.expectedLive)) return this.block();
      this.io.applyLive(this.session!.snapshot()!.live);
    }
    return this.observeInitialization(canonical);
  }

  private async observeInitialization(canonical: ProgressSnapshot<T>): Promise<boolean> {
    if (!await this.captureLatest() || !this.allowed()) return this.block();
    // Awaiting even an already-completed capture yields to the caller. Capture
    // again immediately before observation and application to close that gap.
    if (!this.session!.capture(this.io.getLive())) return this.block();
    const result = this.session!.observe(canonical);
    if (!this.allowed() || result === "blocked" || result === "ignored") return this.block();
    this.io.applyLive(this.session!.snapshot()!.live);
    this.phase = "ready";
    return true;
  }
}
