import { VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";
import { isOwnerKey } from "@/shared/clips/library/ownerKey";
import { isJournalSourceId, journalOriginalId } from "./progressJournalRecovery";

export type JournalCheckpoint = {
  ownerKey: string;
  appId: ValidAppId;
  writerId: string;
  generation: number;
  /** Exact serialized envelope, including originals awaiting preservation. */
  raw: string;
};
export type JournalArchive = { ownerKey: string; appId: ValidAppId; sourceId: string; raw: string };
export const PROGRESS_JOURNAL_DB = "hh-progress-journals:v1";
export class DeletedJournalOwnerError extends Error {
  constructor() { super("This owner's recovery copies were deleted."); this.name = "DeletedJournalOwnerError"; }
}
export class JournalWriterConflictError extends Error {
  constructor() { super("Journal checkpoint generation conflicts"); this.name = "JournalWriterConflictError"; }
}
// Share explicit deletion intent across database clients in this document.
// Cross-document account changes must also revoke the owner authority's lease.
const deletedOwners = new WeakMap<IDBFactory, Map<string, Set<string>>>();
const owner = (key: string) => { if (!isOwnerKey(key)) throw new Error("Invalid journal owner"); };
const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("Journal storage request failed"));
});
const completed = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("Journal storage transaction aborted"));
  tx.onerror = () => reject(tx.error ?? new Error("Journal storage transaction failed"));
});

/**
 * Large checkpoints do not need to fit a second time in localStorage. An exact
 * transaction completion is the durable receipt; neither a queued request nor
 * an in-memory read is one. Opening the database has no import-time side effect.
 */
export class ProgressJournalDatabase {
  private connection: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private closed = false;
  constructor(private readonly factory?: IDBFactory, private readonly name = PROGRESS_JOURNAL_DB) {}

  private deletionFence(): Set<string> | undefined {
    const factory = this.factory ?? globalThis.indexedDB;
    if (!factory) return undefined;
    let names = deletedOwners.get(factory);
    if (!names) { names = new Map(); deletedOwners.set(factory, names); }
    let owners = names.get(this.name);
    if (!owners) { owners = new Set(); names.set(this.name, owners); }
    return owners;
  }

  isOwnerDeleted(ownerKey: string): boolean { return this.deletionFence()?.has(ownerKey) ?? false; }

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error("Journal storage is closed"));
    if (this.connection) return Promise.resolve(this.connection);
    if (this.opening) return this.opening;
    const factory = this.factory ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error("Journal storage is unavailable"));
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(this.name, 2);
      let rejected = false;
      req.onupgradeneeded = event => {
        if (event.oldVersion < 1) {
          req.result.createObjectStore("checkpoints", { keyPath: ["ownerKey", "appId", "writerId"] }).createIndex("owner", "ownerKey");
          req.result.createObjectStore("owners", { keyPath: "ownerKey" });
        }
        if (event.oldVersion < 2) {
          const archives = req.result.createObjectStore("archives", { keyPath: ["ownerKey", "appId", "sourceId", "digest"] });
          archives.createIndex("owner", "ownerKey");
          archives.createIndex("source", ["ownerKey", "appId", "sourceId"]);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("Could not open journal storage"));
      req.onblocked = () => { rejected = true; reject(new Error("Journal storage upgrade is blocked")); };
      req.onsuccess = () => {
        const db = req.result;
        if (this.closed || rejected) { db.close(); reject(new Error("Journal storage is closed")); return; }
        this.connection = db;
        const forget = () => { if (this.connection === db) this.connection = null; };
        db.onversionchange = () => { db.close(); forget(); };
        db.onclose = forget;
        resolve(db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  private async run<T>(mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    if (this.closed) throw new Error("Journal storage is closed");
    const invalidate = (error: unknown) => {
      // Match LocalWordsDatabase: Safari may lose a cached connection without
      // delivering onclose. Reject this attempt and reopen on the next one.
      const name = error !== null && typeof error === "object" && "name" in error ? error.name : undefined;
      if (name === "InvalidStateError" || name === "UnknownError") {
        db.close();
        if (this.connection === db) this.connection = null;
      }
    };
    let tx: IDBTransaction;
    try { tx = db.transaction(["owners", "checkpoints", "archives"], mode); }
    catch (error) { invalidate(error); throw error; }
    const done = completed(tx);
    // Observe a possible abort while body awaits an IDB request.
    void done.catch(() => undefined);
    try { const value = await body(tx); await done; return value; }
    catch (error) { try { tx.abort(); } catch { /* Already terminal. */ } await done.catch(() => undefined); invalidate(error); throw error; }
  }

  private async epoch(tx: IDBTransaction, ownerKey: string, expected?: number): Promise<number> {
    owner(ownerKey);
    if (this.isOwnerDeleted(ownerKey)) throw new DeletedJournalOwnerError();
    const row = await request<{ ownerKey: string; epoch: number; deleted?: boolean } | undefined>(tx.objectStore("owners").get(ownerKey));
    if (row?.deleted) { this.deletionFence()?.add(ownerKey); throw new DeletedJournalOwnerError(); }
    const epoch = row?.epoch ?? 0;
    if (expected !== undefined && epoch !== expected) throw new Error("Journal owner epoch changed");
    return epoch;
  }

  ownerEpoch(ownerKey: string): Promise<number> {
    return this.run("readonly", tx => this.epoch(tx, ownerKey));
  }

  async put(checkpoint: JournalCheckpoint, expectedEpoch: number,
    previous?: Pick<JournalCheckpoint, "generation" | "raw"> | null): Promise<"durable" | "superseded"> {
    const row = { ...checkpoint };
    const expected = previous ? { ...previous } : previous;
    owner(row.ownerKey);
    if (!VALID_APP_IDS.includes(row.appId) || !/^[a-zA-Z0-9-]{1,100}$/.test(row.writerId)
      || !Number.isSafeInteger(row.generation) || row.generation < 0 || typeof row.raw !== "string") throw new Error("Invalid journal checkpoint");
    return this.run("readwrite", async tx => {
      await this.epoch(tx, row.ownerKey, expectedEpoch);
      const store = tx.objectStore("checkpoints");
      const prior = await request<JournalCheckpoint | undefined>(store.get([row.ownerKey, row.appId, row.writerId]));
      if (prior?.generation === row.generation && prior.raw === row.raw) return "durable";
      // Repository writers compare their last exact receipt, including absence
      // on the first write. A larger generation cannot claim somebody else's key.
      if (expected !== undefined && (expected === null ? Boolean(prior)
        : !prior || prior.generation !== expected.generation || prior.raw !== expected.raw)) throw new JournalWriterConflictError();
      if (prior && prior.generation > row.generation) return "superseded";
      if (prior?.generation === row.generation) {
        if (prior.raw !== row.raw) throw new JournalWriterConflictError();
        return "durable";
      }
      await request(store.put(row));
      return "durable";
    });
  }

  get(ownerKey: string, appId: ValidAppId, writerId: string, expectedEpoch: number): Promise<JournalCheckpoint | undefined> {
    return this.run("readonly", async tx => {
      await this.epoch(tx, ownerKey, expectedEpoch);
      return request<JournalCheckpoint | undefined>(tx.objectStore("checkpoints").get([ownerKey, appId, writerId]));
    });
  }

  list(ownerKey: string, expectedEpoch: number): Promise<JournalCheckpoint[]> {
    return this.run("readonly", async tx => {
      await this.epoch(tx, ownerKey, expectedEpoch);
      return request<JournalCheckpoint[]>(tx.objectStore("checkpoints").index("owner").getAll(ownerKey));
    });
  }

  /** Immutable source variants survive a writer advancing and recovery chains. */
  async archive(source: JournalArchive, expectedEpoch: number): Promise<void> {
    const row = { ...source, digest: journalOriginalId(source.raw) };
    owner(row.ownerKey);
    if (!VALID_APP_IDS.includes(row.appId) || !isJournalSourceId(row.sourceId, row.appId, row.ownerKey)
      || typeof row.raw !== "string") throw new Error("Invalid journal source archive");
    await this.run("readwrite", async tx => {
      await this.epoch(tx, row.ownerKey, expectedEpoch);
      const store = tx.objectStore("archives");
      const prior = await request<JournalArchive | undefined>(store.get([row.ownerKey, row.appId, row.sourceId, row.digest]));
      if (prior) {
        if (prior.raw !== row.raw) throw new Error("Journal source archive conflicts");
      } else await request(store.add(row));
    });
  }

  archivedSources(ownerKey: string, appId: ValidAppId, sourceId: string, expectedEpoch: number): Promise<JournalArchive[]> {
    owner(ownerKey);
    if (!isJournalSourceId(sourceId, appId, ownerKey)) return Promise.reject(new Error("Invalid journal source identity"));
    return this.run("readonly", async tx => {
      await this.epoch(tx, ownerKey, expectedEpoch);
      const rows = await request<JournalArchive[]>(tx.objectStore("archives").index("source").getAll([ownerKey, appId, sourceId]));
      return rows.map(row => ({ ownerKey: row.ownerKey, appId: row.appId, sourceId: row.sourceId, raw: row.raw }));
    });
  }

  /** Explicit owner deletion only; the tombstone fences writers holding epoch 0. */
  deleteOwner(ownerKey: string): Promise<void> {
    owner(ownerKey);
    // Fence synchronous dispatch immediately, including while deletion awaits
    // its transaction. A failed deletion remains conservatively fenced here.
    this.deletionFence()?.add(ownerKey);
    return this.run("readwrite", async tx => {
      const owners = tx.objectStore("owners");
      const prior = await request<{ epoch: number } | undefined>(owners.get(ownerKey));
      const keys = await request(tx.objectStore("checkpoints").index("owner").getAllKeys(ownerKey));
      for (const key of keys) await request(tx.objectStore("checkpoints").delete(key));
      const archives = await request(tx.objectStore("archives").index("owner").getAllKeys(ownerKey));
      for (const key of archives) await request(tx.objectStore("archives").delete(key));
      await request(owners.put({ ownerKey, epoch: (prior?.epoch ?? 0) + 1, deleted: true }));
    });
  }

  close(): void { this.closed = true; this.connection?.close(); this.connection = null; }
}
