import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { cloneProgress, isProgressSnapshot, newProvisionalJournal, parseProgressJournal,
  type ProgressJournal, type ProgressRequest, type ProgressSnapshot } from "./progressJournal";
import { ProgressJournalRepository, type JournalCopy } from "./progressJournalRepository";
import { journalOriginalId, journalSourceId, resolvedJournalSources } from "./progressJournalRecovery";
import { ProgressSyncSession } from "./progressSyncSession";
import { sameProgress } from "./progressStamp";
import { progressSyncTransport, type ProgressResponse, type ProgressTransport, type ProgressWrite } from "./progressSyncTransport";

export const PROGRESS_BEACON_BYTES = 48 * 1024;
export type ProgressSaveResult = { ok: boolean; status: number | null };
export type ProgressChoice<T> = { remote: ProgressSnapshot<T>; local: T; copies: JournalCopy[]; alternatives: ProgressAlternative<T>[] };
export type ProgressAlternative<T> = { id: string; sourceId: string; data: T };
export type ProgressSelection<T> = "local" | "server" | { alternativeId: string } | { empty: T };
export type ProgressSyncStatus = "pending" | "saving" | "saved" | "conflict" | "storage-error" | "network-error" | "revoked";

type RuntimeOptions<T extends AppProgressData> = {
  appId: ValidAppId; ownerId: string; ownerKey: string; writerId: string;
  repository: ProgressJournalRepository;
  maySave: () => boolean;
  getLive: () => T;
  applyLive: (data: T) => void;
  isUntouched: (data: T) => boolean;
  requestId: () => string;
  transport?: ProgressTransport<T>;
  onOwnerChanged?: () => void;
  onChange?: () => void;
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
  private bootstrapping: Promise<boolean> | null = null;
  private readonly transport: ProgressTransport<T>;
  private saving: Promise<ProgressSaveResult> | null = null;
  private explicitChoice = false;
  private problem: "storage-error" | "network-error" | null = null;
  constructor(private readonly io: RuntimeOptions<T>) {
    this.transport = io.transport ?? progressSyncTransport(io.appId, io.ownerId);
  }

  private allowed = () => this.alive && this.io.maySave();
  snapshot(): ProgressRuntimeSnapshot<T> {
    return this.allowed()
      ? { phase: this.phase, journal: this.session?.snapshot() ?? null, copies: cloneProgress(this.copies) }
      : { phase: "revoked", journal: null, copies: [] };
  }
  deactivate(): void { this.alive = false; }

  initialize(canonical: ProgressSnapshot<T>): Promise<boolean> {
    if (this.saving) return Promise.resolve(false);
    return this.initializeShared(canonical);
  }

  private initializeShared(canonical: ProgressSnapshot<T>): Promise<boolean> {
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeOnce(canonical).catch(() => this.block()).finally(() => { this.initializing = null; });
    return this.initializing;
  }

  status(): ProgressSyncStatus {
    if (!this.allowed()) return "revoked";
    if (this.saving) return "saving";
    const row = this.session?.snapshot();
    if (row?.conflict && !row.provisional) return "conflict";
    if (this.problem) return this.problem;
    if (this.phase !== "ready" || !row) return "pending";
    if (!this.session!.storageAvailable || !this.io.repository.isDurable()) return "storage-error";
    return this.saved() ? "saved" : "pending";
  }

  /** Persist play immediately; network debounce must not delay recovery capture. */
  capture(): boolean {
    if (!this.allowed()) return false;
    let durable = false;
    try {
      if (!this.session) {
        const raw = JSON.stringify(newProvisionalJournal(this.io.appId, this.io.ownerId, this.io.writerId, this.io.getLive()));
        this.io.repository.persist(raw, []);
        this.install(raw);
      }
      const captured = this.session!.capture(this.io.getLive());
      const raw = JSON.stringify(this.session!.snapshot());
      const pending = this.io.repository.snapshot()?.current;
      // Failed structural transitions may have queued another candidate. Capture
      // the still-current session exactly, retaining that candidate before retry.
      if (captured && (!this.io.repository.isDurable() || pending !== raw)) {
        this.io.repository.persist(raw, pending && pending !== raw ? [pending] : []);
      }
      durable = captured && this.io.repository.isDurable() && this.io.repository.snapshot()?.current === raw;
    } catch { /* Unknown local shapes remain in their original game store. */ }
    if (!durable) this.problem = "storage-error";
    this.io.onChange?.();
    return durable;
  }

  /** Local preservation starts before GET and never waits on unrelated source capture. */
  bootstrap(): Promise<boolean> {
    if (this.bootstrapping) return this.bootstrapping;
    this.capture();
    this.bootstrapping = this.bootstrapOnce().catch(() => this.block()).finally(() => { this.bootstrapping = null; });
    return this.bootstrapping;
  }

  private async bootstrapOnce(): Promise<boolean> {
    const { repository } = this.io;
    if (!await this.captureLatest() || !this.allowed()) return this.block();
    const inventory = await repository.recover();
    if (!this.allowed() || inventory.unavailable) return this.block();
    const resolved = resolvedJournalSources(inventory.copies, this.io.appId, this.io.ownerKey);
    if (!resolved) return this.block();
    this.copies = this.pendingCopies(inventory.copies, resolved);
    if (this.session!.snapshot()!.provisional && !repository.snapshot()?.recovery?.adoptedSources.length && this.copies.length === 1) {
      const source = this.copies[0];
      const row = parseProgressJournal<T>(source.envelope.current, this.io.appId, this.io.ownerId)!;
      if (sameProgress(row.live, this.io.getLive()) && !source.envelope.recovery?.adoptedSources.some(id => resolved.has(id))) {
        if (!await this.captureLatest()) return this.block();
        const expectedProvisional = JSON.stringify(this.session!.snapshot());
        let promoted = false;
        const raw = await repository.adopt(source.sourceId, { expectedProvisional, onPromoted: next => {
          this.install(next); promoted = true;
        } });
        if (!this.allowed() || (!raw && !promoted)) return this.block();
        if (!await this.captureLatest()) return this.block();
      }
    }
    return this.allowed() && await this.captureLatest();
  }

  private saved(): boolean {
    const row = this.session?.snapshot();
    return this.allowed() && this.phase === "ready" && Boolean(row && !row.sent && !row.conflict && !row.forceWrite
      && sameProgress(row.live, row.acknowledged.data) && sameProgress(this.io.getLive(), row.live)
      && this.io.repository.isDurable() && this.io.repository.snapshot()?.current === JSON.stringify(row));
  }

  private canonical(response: ProgressResponse): ProgressSnapshot<T> | null {
    if (!this.allowed()) return null;
    const body = response.body;
    if (response.status === 409 && body && typeof body === "object" && "code" in body && body.code === "owner_changed") {
      this.alive = false;
      this.io.onOwnerChanged?.();
      return null;
    }
    return body && typeof body === "object" && "protocol" in body && body.protocol === 1
      && isProgressSnapshot<T>(this.io.appId, body) ? { data: body.data, revision: body.revision } : null;
  }

  private payload(request: ProgressRequest<T>): ProgressWrite<T> {
    return { data: request.data, merge: true, baseRevision: request.base.revision, expectedOwnerId: this.io.ownerId,
      ...(this.session?.snapshot()?.forceWrite ? { resolution: true as const } : {}) };
  }

  /** One immutable HTTP operation at a time. Concurrent callers still capture later play. */
  save(): Promise<ProgressSaveResult> {
    this.capture();
    if (this.saving) return this.saving;
    this.saving = this.saveOnce().catch(() => {
      if (this.allowed()) this.problem = "network-error";
      return { ok: false, status: null };
    }).finally(() => { this.saving = null; this.io.onChange?.(); });
    this.io.onChange?.();
    return this.saving;
  }

  private async saveOnce(): Promise<ProgressSaveResult> {
    const failed = (status: number | null = null): ProgressSaveResult => ({ ok: false, status });
    if (!this.allowed()) return failed();
    this.problem = null;
    if (this.initializing) await this.initializing;
    if (!this.allowed()) return failed();
    if (!this.session || this.phase !== "ready") {
      if (!await this.bootstrap() || !this.allowed()) { this.problem = "storage-error"; return failed(); }
      const response = await this.transport.read();
      const canonical = this.canonical(response);
      if (response.status !== 200 || !canonical) { this.problem = "network-error"; return failed(response.status); }
      if (!await this.initializeShared(canonical) || !this.allowed()) { this.problem = "storage-error"; return failed(); }
    }
    if (!await this.captureLatest() || !this.allowed()) { this.problem = "storage-error"; return failed(); }
    const session = this.session!;
    if (session.snapshot()!.conflict) return failed(409);
    const inherited = this.io.repository.snapshot()?.recovery?.adoptedSources ?? [];
    if (inherited.length && !this.explicitChoice) {
      const adoption = await this.io.repository.adoptionStatus();
      if (adoption === "unavailable") { this.problem = "storage-error"; return failed(); }
      if (adoption === "resolved") {
        const response = await this.transport.read(), canonical = this.canonical(response);
        if (response.status !== 200 || !canonical) { this.problem = "network-error"; return failed(response.status); }
        if (!await this.captureLatest() || !this.allowed()) return failed();
        if (session.requireChoice(canonical) === "blocked") this.problem = "storage-error";
        await this.refreshCopies();
        return failed(409);
      }
    }
    if (!this.allowed()) return failed();
    // A sent operation from a prior call, beacon or crash is uncertain. Only a
    // fresh GET can permit exact replay or prove it redundant, never a timer.
    if (session.snapshot()!.sent) {
      const response = await this.transport.read();
      const canonical = this.canonical(response);
      if (response.status !== 200 || !canonical) { this.problem = "network-error"; return failed(response.status); }
      if (!await this.captureLatest() || !this.allowed() || !session.capture(this.io.getLive())) {
        this.problem = "storage-error"; return failed();
      }
      const result = session.observe(canonical);
      if (result === "blocked" || result === "ignored") { this.problem = "storage-error"; return failed(); }
      if (!this.allowed()) return failed();
      this.io.applyLive(session.snapshot()!.live);
      if (result === "conflict") return failed(409);
    }
    if (!this.allowed()) return failed();
    // Untouched defaults are not a new cloud save. Explicit choices are exempt.
    const row = session.snapshot()!;
    if (!row.forceWrite && !row.sent && this.io.isUntouched(this.io.getLive())) return this.finishSave(null);
    let request = session.prepare(this.io.getLive());
    if (!request && !session.storageAvailable) {
      await this.io.repository.settle();
      if (!this.allowed()) return failed();
      request = session.prepare(this.io.getLive());
    }
    if (!request) return this.finishSave(null);
    let response: ProgressResponse;
    try { response = await this.transport.write(this.payload(request)); }
    catch {
      session.uncertain(request.id);
      if (this.allowed()) this.problem = "network-error";
      return failed();
    }
    if (!this.allowed()) return failed(response.status);
    const canonical = this.canonical(response);
    const rejected = response.status === 409 && response.body !== null && typeof response.body === "object"
      && "code" in response.body && response.body.code === "revision_conflict";
    if (!canonical || (response.status !== 200 && !rejected)) {
      session.uncertain(request.id);
      this.problem = "network-error";
      return failed(response.status);
    }
    const result = session.receive(request.id, canonical, response.status === 200 ? "accepted" : "rejected", this.io.getLive());
    if (result === "blocked" || result === "ignored") {
      session.uncertain(request.id);
      this.problem = result === "blocked" ? "storage-error" : "network-error";
      return failed(response.status);
    }
    if (!this.allowed()) return failed(response.status);
    this.io.applyLive(session.snapshot()!.live);
    if (!session.snapshot()!.forceWrite) this.explicitChoice = false;
    return this.finishSave(response.status);
  }

  private async finishSave(status: number | null): Promise<ProgressSaveResult> {
    if (!this.allowed() || !this.session) return { ok: false, status };
    const row = this.session.snapshot()!;
    const envelope = this.io.repository.snapshot();
    const sources = envelope?.recovery?.adoptedSources ?? [];
    if (sources.length && envelope && !row.sent && !row.conflict && !row.forceWrite) {
      if (!await this.io.repository.resolve(sources, envelope.current)) this.problem = "storage-error";
      else this.copies = [];
    }
    if (!this.allowed()) return { ok: false, status };
    this.capture();
    return { ok: this.problem === null && this.saved(), status };
  }

  choice(): ProgressChoice<T> | null {
    if (!this.allowed()) return null;
    const row = this.session?.snapshot();
    return this.phase === "ready" && row?.conflict && !row.provisional ? { remote: cloneProgress(row.conflict.remote), local: cloneProgress(this.io.getLive()),
      copies: cloneProgress(this.copies), alternatives: this.alternatives() } : null;
  }

  alternatives(): ProgressAlternative<T>[] {
    if (!this.allowed()) return [];
    const alternatives: ProgressAlternative<T>[] = [];
    const sources = this.copies.flatMap(source =>
      [source.envelope.current, ...source.envelope.originals.map(original => original.raw)]
        .map(raw => ({ sourceId: source.sourceId, raw })));
    for (const original of this.io.repository.snapshot()?.originals ?? []) {
      if (!original.choice) continue;
      const row = parseProgressJournal<T>(original.raw, this.io.appId, this.io.ownerId);
      if (row) sources.push({ raw: original.raw,
        sourceId: journalSourceId(this.io.ownerKey, this.io.appId, row.writerId, original.raw) });
    }
    for (const { raw, sourceId } of sources) {
      const row = parseProgressJournal<T>(raw, this.io.appId, this.io.ownerId)!;
      for (const [section, data] of [["live", row.live], ["sent", row.sent?.data], ["base", row.acknowledged.data],
        ["conflict", row.conflict?.remote.data]] as const) {
        if (data && !alternatives.some(copy => sameProgress(copy.data, data))) alternatives.push({
          id: JSON.stringify([sourceId, journalOriginalId(raw), section]), sourceId, data: cloneProgress(data),
        });
      }
    }
    return alternatives;
  }

  /** The caller passes the exact view rendered when the player pressed a choice. */
  choose(displayed: ProgressChoice<T>, selected: ProgressSelection<T>): Promise<ProgressSaveResult> {
    if (this.saving || this.initializing) return Promise.resolve({ ok: false, status: null });
    this.saving = this.chooseOnce(displayed, selected).catch(() => {
      if (this.allowed()) this.problem = "network-error";
      return { ok: false, status: null };
    }).finally(() => { this.saving = null; this.io.onChange?.(); });
    this.io.onChange?.();
    return this.saving;
  }

  private async chooseOnce(displayed: ProgressChoice<T>, selected: ProgressSelection<T>): Promise<ProgressSaveResult> {
    const failed = (status: number | null = null): ProgressSaveResult => ({ ok: false, status });
    const unchanged = () => this.allowed() && this.session !== null
      && sameProgress(this.session.snapshot()?.conflict?.remote, displayed.remote)
      && sameProgress(this.io.getLive(), displayed.local) && sameProgress(this.copies, displayed.copies);
    if (!unchanged()) return failed(409);
    this.problem = null;
    const selectedData = selected === "local" ? displayed.local : selected === "server" ? displayed.remote.data
      : "empty" in selected ? (displayed.remote.data === null ? selected.empty : null)
        : displayed.alternatives.find(copy => copy.id === selected.alternativeId)?.data;
    if (!selectedData) return failed(409);
    const selectedRetained = typeof selected === "object" && "alternativeId" in selected
      ? displayed.alternatives.find(copy => copy.id === selected.alternativeId) : null;
    const retainedUnchanged = () => !selectedRetained || this.alternatives().some(copy => sameProgress(copy, selectedRetained));
    if (!retainedUnchanged()) return failed(409);
    if (!await this.captureLatest() || !unchanged() || !retainedUnchanged()) { this.problem = "storage-error"; return failed(); }
    const response = await this.transport.read();
    const canonical = this.canonical(response);
    if (response.status !== 200 || !canonical) { this.problem = "network-error"; return failed(response.status); }
    if (!unchanged() || !retainedUnchanged()) return failed(409);
    if (!sameProgress(canonical, displayed.remote)) {
      const result = this.session!.observe(canonical);
      if (result === "blocked") this.problem = "storage-error";
      return failed(409);
    }
    const repository = this.io.repository;
    const current = repository.snapshot()?.current;
    if (!current || !await repository.retainSources(displayed.copies, current) || !unchanged() || !retainedUnchanged()) {
      this.problem = "storage-error";
      await this.refreshCopies();
      return failed();
    }
    // One transition pins the displayed local before installing the selection.
    // Capturing selectedData first would compact away the unchosen local copy.
    const session = this.session!;
    let chosen = session.choose(displayed.remote, { data: selectedData });
    if (!chosen) {
      await repository.settle();
      if (!unchanged() || !retainedUnchanged()) { session.capture(this.io.getLive()); return failed(409); }
      chosen = session.choose(displayed.remote, { data: selectedData });
    }
    if (!chosen || !this.allowed()) { this.problem = "storage-error"; return failed(); }
    this.explicitChoice = true;
    this.io.applyLive(session.snapshot()!.live);
    return this.saveOnce();
  }

  /** A queued beacon is never an ACK. Oversized payloads stay pending for HTTP. */
  flush(): "retained" | "queued" | "refused" {
    if (!this.capture() || !this.allowed() || !this.session || this.phase !== "ready"
      || this.saving || this.initializing || !this.transport.beacon) return "retained";
    const row = this.session.snapshot()!;
    if (row.conflict || row.sent || this.io.repository.snapshot()?.recovery?.adoptedSources.length
      || (!row.forceWrite && this.io.isUntouched(row.live))) return "retained";
    const preview = JSON.stringify(this.payload({ id: "preview", data: row.live, base: row.acknowledged }));
    if (new TextEncoder().encode(preview).byteLength > PROGRESS_BEACON_BYTES) return "retained";
    const request = this.session.prepare(this.io.getLive());
    if (!request) return "retained";
    this.session.uncertain(request.id);
    const payload = JSON.stringify(this.payload(request));
    if (new TextEncoder().encode(payload).byteLength > PROGRESS_BEACON_BYTES) return "retained";
    let queued = false;
    try { queued = this.transport.beacon(payload); } catch { /* Leave the operation uncertain. */ }
    this.io.onChange?.();
    return queued ? "queued" : "refused";
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
    if (this.capture()) return true;
    await this.io.repository.settle();
    return this.allowed() && this.capture();
  }

  private pendingCopies(copies: JournalCopy[], resolved: Set<string>): JournalCopy[] {
    return copies.filter(copy => {
      if (copy.writerId === this.io.writerId || resolved.has(copy.sourceId)) return false;
      const row = parseProgressJournal<T>(copy.envelope.current, this.io.appId, this.io.ownerId)!;
      return row.sent !== null || row.conflict !== null || row.forceWrite
        || !sameProgress(row.live, row.acknowledged.data) || Boolean(copy.envelope.recovery?.adoptedSources.length);
    });
  }

  private async refreshCopies(): Promise<boolean> {
    const inventory = await this.io.repository.recover();
    if (!this.allowed() || inventory.unavailable) return false;
    const resolved = resolvedJournalSources(inventory.copies, this.io.appId, this.io.ownerKey);
    if (!resolved) return false;
    this.copies = this.pendingCopies(inventory.copies, resolved);
    return true;
  }

  private async initializeOnce(canonical: ProgressSnapshot<T>): Promise<boolean> {
    const { repository } = this.io;
    if (!this.allowed() || !isProgressSnapshot<T>(this.io.appId, canonical)) return this.block();
    if (this.phase === "ready" && this.session && !this.session.snapshot()!.provisional) return this.observeInitialization(canonical);
    if (!await this.bootstrap() || !this.allowed()) return this.block();
    // Promotion and GET each await external work. Re-inventory before using
    // recovered lineage or applying the remote snapshot to the mounted store.
    const inventory = await repository.recover();
    if (!this.allowed() || inventory.unavailable) return this.block();
    const resolved = resolvedJournalSources(inventory.copies, this.io.appId, this.io.ownerKey);
    if (!resolved) return this.block();
    this.copies = this.pendingCopies(inventory.copies, resolved);
    if (!await this.captureLatest() || !this.allowed()) return this.block();
    const session = this.session!, row = session.snapshot()!;
    if (!row.provisional) {
      const ancestors = repository.snapshot()?.recovery?.adoptedSources ?? [];
      if (ancestors.some(id => resolved.has(id)) || this.copies.some(copy => !ancestors.includes(copy.sourceId))) {
        if (session.requireChoice(canonical) === "blocked") return this.block();
      }
      return this.observeInitialization(canonical);
    }
    const expectedLive = cloneProgress(this.io.getLive());
    const untouched = this.copies.length === 0 && this.io.isUntouched(expectedLive);
    const adoptingCloud = untouched && canonical.data !== null && !sameProgress(expectedLive, canonical.data);
    const target = adoptingCloud ? canonical.data! : expectedLive;
    const related = this.copies.length === 0 && (untouched || sameProgress(expectedLive, canonical.data) || canonical.revision === null);
    let reconciled = session.reconcileProvisional(canonical, target, related);
    if (!reconciled) {
      await repository.settle();
      if (!this.allowed()) return this.block();
      if (!sameProgress(this.io.getLive(), expectedLive)) {
        session.capture(this.io.getLive());
        return this.block();
      }
      reconciled = session.reconcileProvisional(canonical, target, related);
    }
    if (!reconciled || !this.allowed()) return this.block();
    if (!sameProgress(this.io.getLive(), expectedLive)) {
      if (!session.capture(this.io.getLive()) || session.requireChoice(canonical) === "blocked") return this.block();
    } else this.io.applyLive(session.snapshot()!.live);
    this.phase = "ready";
    this.problem = null;
    return true;
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
