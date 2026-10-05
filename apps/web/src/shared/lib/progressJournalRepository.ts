import type { ValidAppId } from "@hank-neil/db/schema";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import type { createOwnerBoundProgress, ProgressLease } from "@/lib/owner-bound-progress/core";
import type { MigrationDatabase } from "@/lib/local-words/migration";
import { captureProgressJournalWords } from "@/lib/local-words/progressJournalSources";
import { parseProgressJournal, progressJournalKey, PROGRESS_JOURNAL_PREFIX } from "./progressJournal";
import { DeletedJournalOwnerError, JournalWriterConflictError, type JournalCheckpoint, type ProgressJournalDatabase } from "./progressJournalDatabase";
import { journalOriginalRetention, nextJournalEnvelope, readJournalEnvelope, type JournalAddress, type JournalEnvelope } from "./progressJournalEnvelope";
import { sameProgress } from "./progressStamp";

type Authority = Pick<ReturnType<typeof createOwnerBoundProgress>, "isCurrent" | "readDurableScoped" | "writeScoped" | "listDurableScoped">;
type Database = Pick<ProgressJournalDatabase, "ownerEpoch" | "isOwnerDeleted" | "put" | "list">;
export type JournalCopy = { sourceId: string; writerId: string; envelope: JournalEnvelope };
type RepositoryOptions = {
  authority: Authority; database: Database; words: MigrationDatabase;
  lease: ProgressLease; appId: ValidAppId; ownerId: string; writerId: string;
  maySave: () => boolean; onDurable?: () => void;
};
export type JournalRecovery = { copies: JournalCopy[]; unavailable: boolean };
const digest = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");
const sourceId = (owner: string, app: ValidAppId, writer: string, raw: string) => JSON.stringify([owner, app, writer, digest(raw)]);

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

  private constructor(private readonly io: RepositoryOptions) {
    this.lease = { ...io.lease };
    this.address = { appId: io.appId, ownerId: io.ownerId, writerId: io.writerId };
    this.key = progressJournalKey(io.appId, io.writerId);
  }

  static async create(io: RepositoryOptions): Promise<{ repository: ProgressJournalRepository; recovery: JournalRecovery }> {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(io.writerId)) throw new Error("Invalid journal writer");
    const repository = new ProgressJournalRepository(io);
    if (io.database.isOwnerDeleted(repository.lease.ownerKey)) throw new DeletedJournalOwnerError();
    if (!repository.allowed() || await ownerKeyFor(io.ownerId) !== repository.lease.ownerKey || !repository.allowed()) throw new Error("Journal owner changed");
    try { repository.epoch = await io.database.ownerEpoch(repository.lease.ownerKey); }
    catch (error) { if (error instanceof DeletedJournalOwnerError) throw error; }
    const recovery = await repository.recover();
    if (!repository.allowed()) throw new Error("Journal owner changed");
    const local = io.authority.readDurableScoped(repository.key, repository.lease);
    if (local.status === "durable" || repository.observedWriters.has(io.writerId)) throw new Error("A new journal writer is required");
    return { repository, recovery };
  }

  private allowed(): boolean { return !this.revoked && !this.io.database.isOwnerDeleted(this.lease.ownerKey)
    && this.io.maySave() && this.io.authority.isCurrent(this.lease); }

  /** Cold recovery must inspect BOTH backends before deciding which generation wins. */
  async recover(): Promise<JournalRecovery> {
    if (!this.allowed()) return { copies: [], unavailable: true };
    const rows: Array<{ writerId: string; raw: string; generation?: number }> = [];
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
    if (!this.allowed()) return { copies: [], unavailable: true };
    const latest = new Map<string, JournalCopy>();
    for (const row of rows) {
      const envelope = readJournalEnvelope(row.raw, { ...this.address, writerId: row.writerId });
      if (!envelope || (row.generation !== undefined && row.generation !== envelope.generation)) { unavailable = true; continue; }
      const prior = latest.get(row.writerId);
      if (prior && prior.envelope.generation > envelope.generation) continue;
      if (prior?.envelope.generation === envelope.generation) {
        if (!sameProgress(prior.envelope, envelope)) unavailable = true;
        continue;
      }
      latest.set(row.writerId, { sourceId: sourceId(this.lease.ownerKey, this.address.appId, row.writerId, envelope.current), writerId: row.writerId, envelope });
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
  persist = (next: string, originals: readonly string[]): boolean => {
    if (!this.allowed()) return false;
    try {
      let candidate = this.compact(nextJournalEnvelope(this.current, next, originals, this.address));
      if (this.current && candidate.current === this.current.current && sameProgress(candidate.originals, this.current.originals)) candidate = this.current;
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
  };

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
