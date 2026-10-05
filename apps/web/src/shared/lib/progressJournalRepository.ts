import type { ValidAppId } from "@hank-neil/db/schema";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import type { createOwnerBoundProgress, ProgressLease } from "@/lib/owner-bound-progress/core";
import type { MigrationDatabase } from "@/lib/local-words/migration";
import { captureProgressJournalWords } from "@/lib/local-words/progressJournalSources";
import { parseProgressJournal, progressJournalKey, PROGRESS_JOURNAL_PREFIX } from "./progressJournal";
import { DeletedJournalOwnerError, JournalWriterConflictError, type JournalCheckpoint, type ProgressJournalDatabase } from "./progressJournalDatabase";
import { journalOriginalRetention, nextJournalEnvelope, readJournalEnvelope, type JournalAddress, type JournalEnvelope, type JournalOriginal } from "./progressJournalEnvelope";
import { sameProgress } from "./progressStamp";
import { adoptJournalCopy, emptyJournalRecovery, isJournalRecovery, journalOriginalId, journalSourceId, resolvedJournalSources,
  type JournalCopy, type JournalRecoveryMetadata } from "./progressJournalRecovery";

type Authority = Pick<ReturnType<typeof createOwnerBoundProgress>, "isCurrent" | "readDurableScoped" | "writeScoped" | "listDurableScoped">;
type Database = Pick<ProgressJournalDatabase, "ownerEpoch" | "isOwnerDeleted" | "put" | "get" | "list" | "archive" | "archivedSources">;
export type { JournalCopy } from "./progressJournalRecovery";
type RepositoryOptions = {
  authority: Authority; database: Database; words: MigrationDatabase;
  lease: ProgressLease; appId: ValidAppId; ownerId: string; writerId: string;
  maySave: () => boolean; onDurable?: () => void;
  /** Read-only compatibility sources participate in every complete inventory. */
  additionalRecovery?: () => JournalRecovery | Promise<JournalRecovery>;
};
export type JournalRecovery = { copies: JournalCopy[]; unavailable: boolean };
const digest = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");

/**
 * Each instance owns a NEW writer key. It never writes a recovered writer's key.
 * The synchronous envelope is the fast path. A failed write can become durable
 * through an exact IndexedDB receipt; queued work or memory equality cannot.
 */
export class ProgressJournalRepository {
  private readonly lease: ProgressLease;
  private readonly address: JournalAddress;
  private readonly key: string;
  private epoch = 0;
  private revoked = false;
  private current: JournalEnvelope | null = null;
  private durable: string | null = null;
  private localRaw: string | null = null;
  private attemptedLocalRaw: string | null = null;
  private databaseReceipt: Pick<JournalCheckpoint, "generation" | "raw"> | null = null;
  private pending: JournalEnvelope | null = null;
  private flight: Promise<void> | null = null;
  private draining: Promise<boolean> | null = null;
  private readonly captured = new Set<string>();
  private readonly observedWriters = new Set<string>();
  private adoptionDraft: { sourceId: string; raw: string } | null = null;

  private constructor(private readonly io: RepositoryOptions) {
    this.lease = { ...io.lease };
    this.address = { appId: io.appId, ownerId: io.ownerId, writerId: io.writerId };
    this.key = progressJournalKey(io.appId, io.writerId);
  }

  /** Writer readiness does not await unrelated recovery or guest-word preservation. */
  static async open(io: RepositoryOptions): Promise<ProgressJournalRepository> {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(io.writerId)) throw new Error("Invalid journal writer");
    const repository = new ProgressJournalRepository(io);
    if (io.database.isOwnerDeleted(repository.lease.ownerKey)) throw new DeletedJournalOwnerError();
    if (!repository.allowed() || await ownerKeyFor(io.ownerId) !== repository.lease.ownerKey || !repository.allowed()) throw new Error("Journal owner changed");
    try { repository.epoch = await io.database.ownerEpoch(repository.lease.ownerKey); }
    catch (error) { if (error instanceof DeletedJournalOwnerError) throw error; }
    let prior: JournalCheckpoint | undefined;
    try { prior = await io.database.get(repository.lease.ownerKey, io.appId, io.writerId, repository.epoch); }
    catch (error) { if (error instanceof DeletedJournalOwnerError) throw error; }
    if (!repository.allowed()) throw new Error("Journal owner changed");
    const local = io.authority.readDurableScoped(repository.key, repository.lease);
    if (local.status === "durable" || prior) throw new Error("A new journal writer is required");
    return repository;
  }

  static async create(io: RepositoryOptions): Promise<{ repository: ProgressJournalRepository; recovery: JournalRecovery }> {
    const repository = await ProgressJournalRepository.open(io);
    const recovery = await repository.recover();
    if (!repository.allowed()) throw new Error("Journal owner changed");
    if (repository.observedWriters.has(io.writerId)) throw new Error("A new journal writer is required");
    return { repository, recovery };
  }

  private allowed(): boolean { return !this.revoked && !this.io.database.isOwnerDeleted(this.lease.ownerKey)
    && this.io.maySave() && this.io.authority.isCurrent(this.lease); }

  /** Cold recovery must inspect BOTH backends before deciding which generation wins. */
  async recover(): Promise<JournalRecovery> {
    if (!this.allowed()) return { copies: [], unavailable: true };
    const rows: Array<{ writerId: string; raw: string; generation?: number; sourceId?: string }> = [];
    let unavailable = false;
    const prefix = `${PROGRESS_JOURNAL_PREFIX}${this.address.appId}-`;
    const listing = this.io.authority.listDurableScoped(prefix, this.lease);
    unavailable = !listing.available;
    for (const key of listing.keys) {
      if (!key.endsWith("-storage")) { unavailable = true; continue; }
      const writerId = key.slice(prefix.length, -"-storage".length);
      this.observedWriters.add(writerId);
      const physical = this.io.authority.readDurableScoped(key, this.lease);
      if (physical.status === "unavailable") { unavailable = true; continue; }
      if (physical.status !== "durable" || physical.raw === null) continue;
      rows.push({ writerId, raw: physical.raw });
    }
    try {
      for (const row of await this.io.database.list(this.lease.ownerKey, this.epoch)) {
        if (row.ownerKey !== this.lease.ownerKey) { unavailable = true; continue; }
        if (row.appId === this.address.appId) { this.observedWriters.add(row.writerId); rows.push(row); }
      }
    } catch { unavailable = true; }
    if (this.io.additionalRecovery) {
      try {
        const additional = await this.io.additionalRecovery();
        unavailable ||= additional.unavailable;
        for (const source of additional.copies) {
          this.observedWriters.add(source.writerId);
          rows.push({ writerId: source.writerId, sourceId: source.sourceId, raw: JSON.stringify(source.envelope) });
        }
      } catch { unavailable = true; }
    }
    if (!this.allowed()) return { copies: [], unavailable: true };
    const latest = new Map<string, JournalCopy>();
    for (const row of rows) {
      const envelope = readJournalEnvelope(row.raw, { ...this.address, writerId: row.writerId });
      if (!envelope || (row.generation !== undefined && row.generation !== envelope.generation)) { unavailable = true; continue; }
      if (envelope.recovery && !isJournalRecovery(envelope.recovery, this.address.appId, this.lease.ownerKey)) { unavailable = true; continue; }
      if (row.sourceId !== undefined && row.sourceId !== journalSourceId(this.lease.ownerKey, this.address.appId, row.writerId, envelope.current)) {
        unavailable = true; continue;
      }
      const prior = latest.get(row.writerId);
      if (prior && prior.envelope.generation > envelope.generation) continue;
      if (prior?.envelope.generation === envelope.generation) {
        if (!sameProgress(prior.envelope, envelope)) unavailable = true;
        continue;
      }
      latest.set(row.writerId, { sourceId: journalSourceId(this.lease.ownerKey, this.address.appId, row.writerId, envelope.current), writerId: row.writerId, envelope });
    }
    return { copies: [...latest.values()], unavailable };
  }

  snapshot(): JournalEnvelope | null { return this.allowed() && this.current ? structuredClone(this.current) : null; }
  isDurable(): boolean { return this.allowed() && this.current !== null && this.durable === JSON.stringify(this.current); }

  private compact(envelope: JournalEnvelope): JournalEnvelope {
    return { ...envelope, originals: envelope.originals.filter(original => {
      const retention = journalOriginalRetention(original, envelope.current, this.address);
      return retention === "pinned" || (retention === "capture" && !this.captured.has(digest(original.raw)));
    }) };
  }

  /** Satisfies the state machine's persist callback, including exact async retries. */
  persist = (next: string, originals: readonly string[]): boolean => this.write(next, originals);

  private write(next: string, originals: readonly string[], recovery?: JournalRecoveryMetadata, imported?: readonly JournalOriginal[]): boolean {
    if (!this.allowed()) return false;
    try {
      let candidate = nextJournalEnvelope(this.current, next, originals, this.address);
      if (recovery) candidate.recovery = structuredClone(recovery);
      if (imported) {
        const pinned = new Set(imported.filter(item => item.choice).map(item => item.raw));
        candidate.originals = candidate.originals.map(item => ({ ...item, choice: item.choice || pinned.has(item.raw) }));
      }
      candidate = this.compact(candidate);
      if (this.current && candidate.current === this.current.current && sameProgress(candidate.originals, this.current.originals)
        && sameProgress(candidate.recovery, this.current.recovery)) candidate = this.current;
      const raw = JSON.stringify(candidate);
      const physical = this.io.authority.readDurableScoped(this.key, this.lease);
      // An unexpected write to this supposedly unique key is not ours to replace.
      const existing = physical.status === "durable" ? physical.raw : null;
      if (physical.status === "durable" && existing !== null && existing === this.attemptedLocalRaw) this.localRaw = existing;
      if (physical.status !== "unavailable" && (existing !== this.localRaw
        || (physical.status === "durable" && existing === null))) {
        this.revoked = true;
        return false;
      }
      if (physical.status === "durable" && existing === raw) this.durable = raw;
      if (this.current === candidate && this.durable === raw) return true;
      this.current = candidate;
      if (physical.status !== "unavailable" && existing === this.localRaw
        && this.io.authority.writeScoped(this.key, raw, this.lease)) {
        this.attemptedLocalRaw = raw;
        const check = this.io.authority.readDurableScoped(this.key, this.lease);
        if (this.allowed() && check.status === "durable" && check.raw === raw) { this.localRaw = raw; this.durable = raw; }
      }
      if (!this.allowed()) return false;
      this.enqueue(candidate);
      return this.durable === raw;
    } catch { return false; }
  }

  /** Fresh-writer adoption only, from a complete inventory with no resolution fence. */
  async adopt(sourceId: string, promotion?: { expectedProvisional: string; onPromoted: (raw: string) => void }): Promise<string | null> {
    const provisional = promotion && parseProgressJournal(promotion.expectedProvisional, this.address.appId, this.address.ownerId);
    const canPromote = () => !!provisional?.provisional && provisional.writerId === this.address.writerId
      && this.isDurable() && this.current?.current === promotion!.expectedProvisional;
    const retry = () => this.adoptionDraft !== null && this.adoptionDraft.sourceId === sourceId
      && this.snapshot()?.current === this.adoptionDraft.raw;
    if (!this.allowed() || (this.current && !retry() && !canPromote())) return null;
    const inventory = await this.recover();
    if (!this.allowed() || (this.current && !retry() && !canPromote()) || inventory.unavailable) return null;
    const resolved = resolvedJournalSources(inventory.copies, this.address.appId, this.lease.ownerKey);
    let source = inventory.copies.find(copy => copy.sourceId === sourceId);
    if (!source && retry()) source = (await this.archivedCopies(sourceId))?.sort((a, b) => b.envelope.generation - a.envelope.generation)[0];
    if (!this.allowed() || (this.current && !retry() && !canPromote())) return null;
    if (!source || !resolved || resolved.has(sourceId)
      || source.envelope.recovery?.adoptedSources.some(id => resolved.has(id))) return null;
    const adopted = adoptJournalCopy(source, { ...this.address, ownerKey: this.lease.ownerKey });
    const raw = JSON.stringify(adopted.journal);
    try { await this.io.database.archive({ ownerKey: this.lease.ownerKey, appId: this.address.appId,
      sourceId, raw: JSON.stringify(source.envelope) }, this.epoch); }
    catch { return null; }
    if (!this.allowed() || (this.current && !retry() && !canPromote())) return null;
    if (promotion) {
      const latest = await this.recover();
      const resolvedNow = resolvedJournalSources(latest.copies, this.address.appId, this.lease.ownerKey);
      if (!canPromote() || !this.allowed() || latest.unavailable || !resolvedNow || resolvedNow.has(sourceId)
        || source.envelope.recovery?.adoptedSources.some(id => resolvedNow.has(id))
        || !latest.copies.some(copy => copy.sourceId === sourceId && sameProgress(copy.envelope, source.envelope))) return null;
    }
    this.adoptionDraft = { sourceId, raw };
    const originals = [...adopted.originals, ...(promotion ? [{ raw: promotion.expectedProvisional, choice: false }] : [])];
    this.write(raw, originals.map(item => item.raw), adopted.recovery, originals);
    // Install the recovered operation synchronously before awaiting its receipt.
    // Later captures must extend it, not overwrite it with a provisional row.
    if (promotion && this.allowed() && this.current?.current === raw) promotion.onPromoted(raw);
    await this.settle();
    if (!this.isDurable() || this.snapshot()?.current !== raw) return null;
    this.adoptionDraft = null;
    return raw;
  }

  /** Attach an explicitly displayed cohort before a choice can replace its alternatives. */
  async retainSources(displayed: readonly JournalCopy[], expectedCurrent: string): Promise<boolean> {
    const ids = [...new Set(displayed.map(source => source.sourceId))];
    if (ids.length !== displayed.length) return false;
    const current = () => this.allowed() && this.isDurable() && this.current?.current === expectedCurrent;
    const expected = parseProgressJournal(expectedCurrent, this.address.appId, this.address.ownerId);
    if (!expected?.conflict || !current()) return false;
    const inventory = await this.recover();
    const resolved = resolvedJournalSources(inventory.copies, this.address.appId, this.lease.ownerKey);
    if (!current() || inventory.unavailable || !resolved) return false;
    const copies: JournalCopy[] = [];
    for (const id of ids) {
      const source = inventory.copies.find(copy => copy.sourceId === id && copy.writerId !== this.address.writerId);
      if (!source || resolved.has(id) || !sameProgress(source, displayed.find(copy => copy.sourceId === id))) return false;
      copies.push(source);
    }
    for (const source of copies) {
      try { await this.io.database.archive({ ownerKey: this.lease.ownerKey, appId: this.address.appId,
        sourceId: source.sourceId, raw: JSON.stringify(source.envelope) }, this.epoch); }
      catch { return false; }
      if (!current()) return false;
    }
    // A source may advance or be resolved while its archival transaction waits.
    const latest = await this.recover();
    const nowResolved = resolvedJournalSources(latest.copies, this.address.appId, this.lease.ownerKey);
    if (!current() || latest.unavailable || !nowResolved || copies.some(source =>
      !latest.copies.some(copy => copy.sourceId === source.sourceId && sameProgress(copy.envelope, source.envelope))
      || nowResolved.has(source.sourceId))) return false;
    const recovery = structuredClone(this.current!.recovery ?? emptyJournalRecovery());
    recovery.adoptedSources = [...new Set([...recovery.adoptedSources, ...copies.flatMap(source =>
      [source.sourceId, ...(source.envelope.recovery?.adoptedSources ?? [])])])].filter(id => !nowResolved.has(id));
    const originals = copies.flatMap(source => [source.envelope.current, ...source.envelope.originals.map(original => original.raw)])
      .map(raw => ({ raw, choice: true }));
    this.write(expectedCurrent, originals.map(original => original.raw), recovery, originals);
    await this.settle();
    return current() && ids.every(id => this.current!.recovery?.adoptedSources.includes(id));
  }

  private async archivedCopies(sourceId: string): Promise<JournalCopy[] | null> {
    try {
      const rows = await this.io.database.archivedSources(this.lease.ownerKey, this.address.appId, sourceId, this.epoch);
      if (!this.allowed()) return null;
      const writerId: string = JSON.parse(sourceId)[2];
      const copies: JournalCopy[] = [];
      for (const row of rows) {
        const envelope = readJournalEnvelope(row.raw, { ...this.address, writerId });
        if (!envelope || row.ownerKey !== this.lease.ownerKey || row.appId !== this.address.appId || row.sourceId !== sourceId
          || journalSourceId(this.lease.ownerKey, this.address.appId, writerId, envelope.current) !== sourceId
          || (envelope.recovery && !isJournalRecovery(envelope.recovery, this.address.appId, this.lease.ownerKey))) return null;
        copies.push({ sourceId, writerId, envelope });
      }
      return copies;
    } catch { return null; }
  }

  /** Check immediately before dispatching any operation inherited from another writer. */
  async adoptionStatus(): Promise<"clear" | "resolved" | "unavailable"> {
    if (!this.allowed() || !this.current) return "unavailable";
    const inventory = await this.recover();
    if (!this.allowed() || inventory.unavailable) return "unavailable";
    const resolved = resolvedJournalSources(inventory.copies, this.address.appId, this.lease.ownerKey);
    if (!resolved) return "unavailable";
    return this.current.recovery?.adoptedSources.some(id => resolved.has(id)) ? "resolved" : "clear";
  }

  /**
   * The coordinator supplies exact adopted sources and the acknowledged journal
   * it just proved. Queued beacons and pending choices cannot produce receipts.
   * Never remove the source key; later edits by that writer remain independent.
   */
  async resolve(sourceIds: readonly string[], expectedCurrent: string): Promise<boolean> {
    const ids = [...new Set(sourceIds)];
    const expected = parseProgressJournal(expectedCurrent, this.address.appId, this.address.ownerId);
    const current = () => this.allowed() && this.isDurable() && this.current?.current === expectedCurrent;
    if (!expected || expected.writerId !== this.address.writerId || expected.sent || expected.conflict
      || expected.forceWrite || expected.acknowledged.revision === null || !current()) return false;
    const provenance = this.current!.recovery?.adoptedSources ?? [];
    if (ids.some(id => !provenance.includes(id))) return false;
    const inventory = await this.recover();
    if (!current() || inventory.unavailable) return false;
    const resolved = resolvedJournalSources(inventory.copies, this.address.appId, this.lease.ownerKey);
    if (!resolved) return false;
    const coverage = new Map<string, Set<string>>();
    for (const id of ids) {
      const originals = new Set(inventory.copies.flatMap(copy => copy.envelope.recovery?.resolutions ?? [])
        .filter(receipt => receipt.sourceId === id).flatMap(receipt => receipt.preservedOriginals ?? []));
      coverage.set(id, originals);
      if (resolved.has(id)) continue;
      const archived = await this.archivedCopies(id);
      if (!archived || !current()) return false;
      const sources = [...archived, ...inventory.copies.filter(copy => copy.sourceId === id)];
      if (!sources.length) return false;
      const rawSources = new Set(sources.flatMap(source => [source.envelope.current, ...source.envelope.originals.map(item => item.raw)]));
      for (const raw of rawSources) {
        const parsed = parseProgressJournal(raw, this.address.appId, this.address.ownerId);
        if (!parsed || !current() || !await captureProgressJournalWords({ raw,
          logicalKey: progressJournalKey(this.address.appId, parsed.writerId), appId: this.address.appId,
          ownerId: this.address.ownerId, lease: this.lease, isCurrent: current, database: this.io.words }) || !current()) return false;
      }
      for (const source of sources) for (const original of source.envelope.originals) originals.add(journalOriginalId(original.raw));
    }
    if (!current()) return false;
    const recovery = structuredClone(this.current!.recovery ?? emptyJournalRecovery());
    for (const id of ids) {
      const preservedOriginals = [...coverage.get(id)!];
      if (!recovery.resolutions.some(item => item.sourceId === id
        && preservedOriginals.every(hash => item.preservedOriginals?.includes(hash)))) {
        recovery.resolutions.push({ sourceId: id, revision: expected.acknowledged.revision, preservedOriginals });
      }
    }
    recovery.adoptedSources = recovery.adoptedSources.filter(id => !ids.includes(id));
    this.write(expectedCurrent, [], recovery);
    await this.settle();
    const saved = current() && ids.every(id => this.current!.recovery?.resolutions.some(item => item.sourceId === id));
    return saved;
  }

  private enqueue(candidate: JournalEnvelope): void {
    this.pending = candidate;
    if (this.flight) return;
    this.flight = (async () => {
      while (this.pending && this.allowed()) {
        const next = this.pending;
        this.pending = null;
        const checkpoint: JournalCheckpoint = { ownerKey: this.lease.ownerKey, appId: this.address.appId,
          writerId: this.address.writerId, generation: next.generation, raw: JSON.stringify(next) };
        try {
          const result = await this.io.database.put(checkpoint, this.epoch, this.databaseReceipt);
          if (result === "superseded") { this.revoked = true; break; }
          this.databaseReceipt = { generation: checkpoint.generation, raw: checkpoint.raw };
          if (this.allowed()) {
            // A late receipt may prove an older copy, never the current copy.
            if (this.current?.generation === next.generation && JSON.stringify(this.current) === checkpoint.raw) {
              this.durable = checkpoint.raw;
              this.io.onDurable?.();
            }
          }
        } catch (error) {
          if (error instanceof DeletedJournalOwnerError || error instanceof JournalWriterConflictError) this.revoked = true;
          // Other failures keep the candidate/originals for an explicit retry.
        }
      }
    })().finally(() => {
      this.flight = null;
      if (this.pending && this.allowed()) this.enqueue(this.pending);
    });
  }

  async settle(): Promise<boolean> {
    while (this.flight) await this.flight;
    return this.isDurable();
  }

  /** Capture unique words before pruning; reread the latest in-memory envelope after every await. */
  drain(): Promise<boolean> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      const start = this.current;
      if (!start || !this.allowed()) return false;
      for (const original of start.originals) {
        if (!this.allowed()) return false;
        const live = this.current!;
        if (!live.originals.some(item => item.raw === original.raw)
          || journalOriginalRetention(original, live.current, this.address) !== "capture") continue;
        const parsed = parseProgressJournal(original.raw, this.address.appId, this.address.ownerId);
        if (!parsed || !await captureProgressJournalWords({ raw: original.raw,
          logicalKey: progressJournalKey(this.address.appId, parsed.writerId), appId: this.address.appId,
          ownerId: this.address.ownerId, lease: this.lease, isCurrent: () => this.allowed(), database: this.io.words })) continue;
        if (!this.allowed()) return false;
        // Keep compact receipt identities, never every prior image in memory.
        this.captured.add(digest(original.raw));
      }
      // persist builds from the latest candidate and atomically retains all of
      // it, including edits made while capture was awaiting IndexedDB.
      const latest = this.current;
      if (!latest || !this.allowed()) return false;
      const compacted = this.compact(latest);
      if (sameProgress(compacted.originals, latest.originals)) return this.isDurable();
      this.persist(latest.current, []);
      return this.settle();
    })().finally(() => { this.draining = null; });
    return this.draining;
  }

  async retry(): Promise<boolean> {
    if (!this.current || !this.allowed()) return false;
    this.persist(this.current.current, []);
    await this.settle();
    return this.drain();
  }
}
