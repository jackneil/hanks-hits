/** Durable device-only words. Importing this module never opens browser storage. */
import { isOwnerKey } from "@/shared/clips/library/ownerKey";
import { sameProgress } from "@/shared/lib/progressStamp";
import type { WordField } from "../progress-words";

export interface WordRecord {
  ownerKey: string;
  appId: string;
  entityKey: string;
  field: string;
  value: unknown;
}

export interface SourceRecord {
  id: string;
  ownerKey: string;
  appId: string;
  sourceKey: string;
  sourceVersion: string | number;
  digest: string;
  raw?: string;
  fields: WordField[];
}

export type CommitSourceOutcome = "committed" | "already-committed" | "conflict" | "missing";
type Receipt = SourceRecord;
const STORES = ["words", "sources", "receipts", "owners"];
export const LOCAL_WORDS_DB_NAME = "hh-words:v1";

/** Account IDs are never reused; deletion permanently forbids future writes. */
export class DeletedWordOwnerError extends Error {
  constructor() {
    super("This owner's local words were deleted.");
    this.name = "DeletedWordOwnerError";
  }
}

export class StaleOwnerEpochError extends Error {
  constructor() {
    super("The local word owner changed or was deleted.");
    this.name = "StaleOwnerEpochError";
  }
}

function owner(key: string): void {
  if (!isOwnerKey(key)) throw new Error("Invalid local word owner key.");
}
function key(record: WordRecord): string[] {
  return [record.ownerKey, record.appId, record.entityKey, record.field];
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Local word storage request failed."));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Local word storage transaction aborted."));
    tx.onerror = () => reject(tx.error ?? new Error("Local word storage transaction failed."));
  });
}

export class LocalWordsDatabase {
  private connection: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(private readonly factory?: IDBFactory, private readonly name = LOCAL_WORDS_DB_NAME) {}

  private current(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new DOMException("Local word storage is closed.", "InvalidStateError"));
    if (this.connection) return Promise.resolve(this.connection);
    if (this.opening) return this.opening;
    const factory = this.factory ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error("Local word storage is unavailable."));
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(this.name, 1);
      let rejected = false;
      req.onupgradeneeded = () => {
        const db = req.result;
        const words = db.createObjectStore("words", { keyPath: ["ownerKey", "appId", "entityKey", "field"] });
        words.createIndex("owner", "ownerKey");
        words.createIndex("ownerApp", ["ownerKey", "appId"]);
        for (const name of ["sources", "receipts"]) {
          db.createObjectStore(name, { keyPath: "id" }).createIndex("owner", "ownerKey");
        }
        db.createObjectStore("owners", { keyPath: "ownerKey" });
      };
      req.onblocked = () => {
        rejected = true;
        reject(new Error("Local word storage is blocked by another tab."));
      };
      req.onerror = () => reject(req.error ?? new Error("Could not open local word storage."));
      req.onsuccess = () => {
        const db = req.result;
        if (this.closed || rejected) {
          db.close();
          reject(new DOMException("Local word storage is closed.", "InvalidStateError"));
          return;
        }
        this.connection = db;
        const forget = () => { if (this.connection === db) this.connection = null; };
        db.onversionchange = () => { db.close(); forget(); };
        db.onclose = forget;
        resolve(db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.current();
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      // A backgrounded Safari tab can lose its connection without a close event.
      // Forget it for the caller's retry. Never report a failed write as durable.
      if (error instanceof Error && ["InvalidStateError", "UnknownError"].includes(error.name)) {
        db.close();
        if (this.connection === db) this.connection = null;
      }
      throw error;
    }
    const done = completed(tx);
    void done.catch(() => undefined);
    try {
      const value = await body(tx);
      await done;
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* Already finished or aborted. */ }
      await done.catch(() => undefined);
      if (error instanceof Error && ["InvalidStateError", "UnknownError"].includes(error.name)) {
        db.close();
        if (this.connection === db) this.connection = null;
      }
      throw error;
    }
  }

  private async epoch(tx: IDBTransaction, ownerKey: string, expected?: number): Promise<number> {
    owner(ownerKey);
    const row = await request<{ ownerKey: string; epoch: number } | undefined>(tx.objectStore("owners").get(ownerKey));
    const epoch = row?.epoch ?? 0;
    if (expected !== undefined && epoch > 0) throw new DeletedWordOwnerError();
    if (expected !== undefined && expected !== epoch) throw new StaleOwnerEpochError();
    return epoch;
  }

  ownerEpoch(ownerKey: string): Promise<number> {
    return this.run(["owners"], "readonly", tx => this.epoch(tx, ownerKey));
  }

  async capture(source: SourceRecord, expectedEpoch: number): Promise<void> {
    // Snapshot before the first await: callers cannot change captured ownership
    // or bytes while the database opens or a preceding transaction finishes.
    const captured = structuredClone(source);
    const expectedId = JSON.stringify([captured.ownerKey, captured.appId, captured.sourceKey, captured.sourceVersion, captured.digest]);
    if (captured.id !== expectedId) throw new Error("Local word source identity does not match its content identity.");
    await this.run(["owners", "sources", "receipts"], "readwrite", async tx => {
      await this.epoch(tx, captured.ownerKey, expectedEpoch);
      const receipt = await request<Receipt | undefined>(tx.objectStore("receipts").get(captured.id));
      if (receipt) {
        if (!sameProgress(receipt, captured)) throw new Error("Local word receipt identity conflicts.");
        return;
      }
      const sources = tx.objectStore("sources");
      const prior = await request<SourceRecord | undefined>(sources.get(captured.id));
      if (prior) {
        if (!sameProgress(prior, captured)) throw new Error("Local word source identity conflicts.");
        return;
      }
      await request(sources.add(captured));
    });
  }

  async commitSource(sourceId: string, records: WordRecord[], expectedEpoch: number): Promise<CommitSourceOutcome> {
    const captured = structuredClone(records);
    return this.run(STORES, "readwrite", async tx => {
      const source = await request<SourceRecord | undefined>(tx.objectStore("sources").get(sourceId));
      const receipt = await request<Receipt | undefined>(tx.objectStore("receipts").get(sourceId));
      const origin = source ?? receipt;
      if (!origin) return "missing";
      await this.epoch(tx, origin.ownerKey, expectedEpoch);
      this.validateRecords(captured, origin.ownerKey, origin.appId);
      if (!source) return "already-committed";
      if (source.fields.length && !captured.length) throw new Error("Cannot retire an unmapped local word source.");
      const words = tx.objectStore("words");
      for (const record of captured) {
        const prior = await request<WordRecord | undefined>(words.get(key(record)));
        if (prior && !sameProgress(prior.value, record.value)) return "conflict";
      }
      // One transaction: no final fields or receipt survive unless retirement
      // of this exact source also commits. Other source versions stay intact.
      for (const record of captured) await request(words.put(record));
      await request(tx.objectStore("receipts").add(source));
      await request(tx.objectStore("sources").delete(sourceId));
      return "committed";
    });
  }

  /** Read one immutable capture across its atomic move into committed receipts. */
  readCapturedSource(ownerKey: string, sourceId: string, expectedEpoch: number): Promise<SourceRecord | null> {
    return this.run(["owners", "sources", "receipts"], "readonly", async tx => {
      await this.epoch(tx, ownerKey, expectedEpoch);
      const source = await request<SourceRecord | undefined>(tx.objectStore("sources").get(sourceId));
      const receipt = await request<Receipt | undefined>(tx.objectStore("receipts").get(sourceId));
      const origin = source ?? receipt;
      if (!origin) return null;
      const copies = [source, receipt].filter((record): record is SourceRecord => record !== undefined);
      if (copies.every(record => isOwnerKey(record.ownerKey) && record.ownerKey !== ownerKey)) return null;
      if (source && receipt && !sameProgress(source, receipt)) {
        throw new Error("Local word captured source copies conflict.");
      }
      for (const record of copies) {
        if (record.ownerKey !== ownerKey || typeof record.appId !== "string" || typeof record.sourceKey !== "string"
          || typeof record.digest !== "string" || !(typeof record.sourceVersion === "string"
            || (typeof record.sourceVersion === "number" && Number.isFinite(record.sourceVersion)))
          || record.id !== sourceId
          || record.id !== JSON.stringify([record.ownerKey, record.appId, record.sourceKey, record.sourceVersion, record.digest])) {
          throw new Error("Local word captured source identity is invalid.");
        }
      }
      return structuredClone(origin);
    });
  }

  listSources(ownerKey: string): Promise<SourceRecord[]> {
    owner(ownerKey);
    return this.run(["sources"], "readonly", tx => request(tx.objectStore("sources").index("owner").getAll(ownerKey)));
  }

  /** Complete committed sources remain recoverable even if a projection missed a field. */
  listCommittedSources(ownerKey: string): Promise<SourceRecord[]> {
    owner(ownerKey);
    return this.run(["receipts"], "readonly", tx => request(tx.objectStore("receipts").index("owner").getAll(ownerKey)));
  }

  readWords(ownerKey: string, appId: string): Promise<WordRecord[]> {
    owner(ownerKey);
    return this.run(["words"], "readonly", tx => request(tx.objectStore("words").index("ownerApp").getAll([ownerKey, appId])));
  }

  private validateRecords(records: WordRecord[], ownerKey: string, appId?: string): void {
    owner(ownerKey);
    const keys = new Set<string>();
    for (const record of records) {
      if (record.ownerKey !== ownerKey || (appId !== undefined && record.appId !== appId)) {
        throw new Error("Local word records belong to a different owner or app.");
      }
      const id = JSON.stringify(key(record));
      if (keys.has(id)) throw new Error("Duplicate local word field in one write.");
      keys.add(id);
    }
  }

  async writeWords(records: WordRecord[], expectedEpoch: number): Promise<void> {
    const captured = structuredClone(records);
    if (!captured.length) return;
    const ownerKey = captured[0].ownerKey;
    this.validateRecords(captured, ownerKey);
    await this.run(["owners", "words"], "readwrite", async tx => {
      await this.epoch(tx, ownerKey, expectedEpoch);
      for (const record of captured) await request(tx.objectStore("words").put(record));
    });
  }

  deleteOwner(ownerKey: string): Promise<number> {
    return this.run(STORES, "readwrite", async tx => {
      const epoch = await this.epoch(tx, ownerKey) + 1;
      await request(tx.objectStore("owners").put({ ownerKey, epoch }));
      for (const name of ["words", "sources", "receipts"]) {
        const store = tx.objectStore(name);
        const keys = await request(store.index("owner").getAllKeys(ownerKey));
        for (const key of keys) await request(store.delete(key));
      }
      return epoch;
    });
  }

  close(): void {
    this.closed = true;
    this.connection?.close();
    this.connection = null;
  }
}
