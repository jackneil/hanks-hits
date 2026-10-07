// @vitest-environment node
import { forceCloseDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeletedWordOwnerError, LocalWordsDatabase, StaleOwnerEpochError,
  type SourceRecord, type WordRecord,
} from "../database";

const A = "u_aaaaaaaaaaaaaaaaaaaa";
const B = "u_bbbbbbbbbbbbbbbbbbbb";
const NAME = "local-words-test";
const word = (value: unknown, appId = "drum-machine", ownerKey = A, field = "name"): WordRecord =>
  ({ ownerKey, appId, entityKey: "beat-1", field, value });
function source(digest = "first", appId = "drum-machine", ownerKey = A): SourceRecord {
  const sourceKey = `${appId}-state`, sourceVersion = 1;
  return {
    id: JSON.stringify([ownerKey, appId, sourceKey, sourceVersion, digest]),
    ownerKey, appId, sourceKey, sourceVersion, digest, raw: `original-${digest}`,
    fields: [{ path: "savedBeats[0].name", value: digest, identity: { id: "beat-1" } }],
  };
}

let factory: IDBFactory;
let db: LocalWordsDatabase;
let peers: LocalWordsDatabase[];
beforeEach(() => {
  factory = new IDBFactory();
  db = new LocalWordsDatabase(factory, NAME);
  peers = [db];
});
afterEach(() => { vi.restoreAllMocks(); peers.forEach(peer => peer.close()); });
function peer() {
  const next = new LocalWordsDatabase(factory, NAME);
  peers.push(next);
  return next;
}

function putCapturedCopy(storeName: "sources" | "receipts", record: unknown): Promise<void> {
  const connection = (db as unknown as { connection: IDBDatabase }).connection;
  return new Promise((resolve, reject) => {
    const tx = connection.transaction([storeName], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Fixture transaction failed."));
    tx.objectStore(storeName).put(record);
  });
}

describe("local word transactions", () => {
  it("does not open storage at construction, and reports unavailable storage", async () => {
    const open = vi.spyOn(factory, "open");
    const lazy = new LocalWordsDatabase(factory, "lazy"); peers.push(lazy);
    expect(open).not.toHaveBeenCalled();
    await lazy.ownerEpoch(A);
    expect(open).toHaveBeenCalledOnce();
    const unavailable = new LocalWordsDatabase(); peers.push(unavailable);
    await expect(unavailable.ownerEpoch(A)).rejects.toThrow("unavailable");
  });

  it("keeps concurrent different-app sources and commits across connections", async () => {
    const other = peer();
    const drum = source(), pet = source("pet", "virtual-pet");
    await Promise.all([db.capture(drum, 0), other.capture(pet, 0)]);
    expect(await db.listSources(A)).toHaveLength(2);
    await Promise.all([
      db.commitSource(drum.id, [word("beat")], 0),
      other.commitSource(pet.id, [word("pet", "virtual-pet")], 0),
    ]);
    expect(await db.readWords(A, "drum-machine")).toEqual([word("beat")]);
    expect(await db.readWords(A, "virtual-pet")).toEqual([word("pet", "virtual-pet")]);
    expect(await db.listSources(A)).toEqual([]);
  });

  it("captures immutable versions, retires only the chosen source, and retries without resurrection", async () => {
    const first = source(), second = source("changed");
    await db.capture(first, 0);
    await db.capture(first, 0);
    await db.capture(second, 0);
    await expect(db.commitSource(first.id, [word("first")], 0)).resolves.toBe("committed");
    await expect(db.commitSource(first.id, [word("first")], 0)).resolves.toBe("already-committed");
    await db.capture(first, 0);
    expect(await db.listSources(A)).toEqual([second]);
    await expect(db.capture({ ...second, raw: "different bytes with reused digest" }, 0)).rejects.toThrow("identity conflicts");
    expect(await db.listSources(A)).toEqual([second]);
  });

  it("retains complete source bytes and unmapped fields after a partial projection", async () => {
    const original = source();
    original.fields.push({ path: "savedBeats[1].name", value: "unmapped", identity: { id: "beat-2" } });
    await db.capture(original, 0);
    await db.commitSource(original.id, [word("first")], 0);
    expect(await db.listSources(A)).toEqual([]);
    expect(await db.listCommittedSources(A)).toEqual([original]);
    await expect(db.capture({ ...original, raw: "mutated after retirement" }, 0)).rejects.toThrow("receipt identity conflicts");
    expect(await db.listCommittedSources(B)).toEqual([]);
    await db.deleteOwner(A);
    expect(await db.listCommittedSources(A)).toEqual([]);
  });

  it("does not silently replace existing words or partially commit a conflicting candidate", async () => {
    const old = source();
    await db.writeWords([word("player edit")], 0);
    await db.capture(old, 0);
    await expect(db.commitSource(old.id, [word("first"), word("extra", "drum-machine", A, "other")], 0)).resolves.toBe("conflict");
    expect(await db.readWords(A, "drum-machine")).toEqual([word("player edit")]);
    expect(await db.listSources(A)).toEqual([old]);
    await db.writeWords([word("first")], 0);
    await expect(db.commitSource(old.id, [word("first")], 0)).resolves.toBe("committed");
  });

  it("serializes competing commits for one field, retaining the losing candidate", async () => {
    const other = peer(), first = source(), second = source("second");
    await Promise.all([db.capture(first, 0), other.capture(second, 0)]);
    const outcomes = await Promise.all([
      db.commitSource(first.id, [word("first")], 0),
      other.commitSource(second.id, [word("second")], 0),
    ]);
    expect(outcomes.sort()).toEqual(["committed", "conflict"]);
    expect(await db.listSources(A)).toHaveLength(1);
    expect(await db.readWords(A, "drum-machine")).toHaveLength(1);
  });

  it("checks owner/app boundaries and does not retire unmapped candidates", async () => {
    const captured = source(); await db.capture(captured, 0);
    await expect(db.commitSource(captured.id, [word("wrong", "drum-machine", B)], 0)).rejects.toThrow("different owner or app");
    await expect(db.commitSource(captured.id, [word("wrong", "weather")], 0)).rejects.toThrow("different owner or app");
    await expect(db.commitSource(captured.id, [], 0)).rejects.toThrow("unmapped");
    await expect(db.writeWords([word("A"), word("B", "drum-machine", B)], 0)).rejects.toThrow("different owner or app");
    await expect(db.writeWords([word("one"), word("two")], 0)).rejects.toThrow("Duplicate");
    expect(await db.listSources(A)).toEqual([captured]);
    expect(await db.readWords(B, "drum-machine")).toEqual([]);
  });

  it("snapshots caller inputs before opening the connection", async () => {
    const captured = source();
    const pending = db.capture(captured, 0);
    captured.raw = "changed after invocation";
    captured.fields[0].value = "changed";
    await pending;
    expect(await db.listSources(A)).toEqual([source()]);
    const words = [word({ nested: "original" })];
    const write = db.writeWords(words, 0);
    (words[0].value as { nested: string }).nested = "mutated";
    await write;
    expect(await db.readWords(A, "drum-machine")).toEqual([word({ nested: "original" })]);
  });

  it("rejects bad owner keys and mismatched source identity without storing values", async () => {
    await expect(db.ownerEpoch("raw-user-id")).rejects.toThrow("Invalid local word owner");
    await expect(db.capture({ ...source(), id: "wrong" }, 0)).rejects.toThrow("identity");
    await expect(db.capture(source(), 5)).rejects.toBeInstanceOf(StaleOwnerEpochError);
    expect(await db.listSources(A)).toEqual([]);
  });

  it("does not report capture durable when the transaction aborts after request success", async () => {
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      const result = add.apply(this, args);
      if (this.name === "sources") result.addEventListener("success", () => this.transaction.abort());
      return result;
    });
    await expect(db.capture(source(), 0)).rejects.toThrow();
    expect(await db.listSources(A)).toEqual([]);
    vi.restoreAllMocks();
    await db.capture(source(), 0);
    expect(await db.listSources(A)).toEqual([source()]);
  });

  it("rolls back a successful final-field request when receipt insertion aborts", async () => {
    const captured = source(); await db.capture(captured, 0);
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      const result = add.apply(this, args);
      if (this.name === "receipts") this.transaction.abort();
      return result;
    });
    await expect(db.commitSource(captured.id, [word("first")], 0)).rejects.toThrow();
    expect(await db.readWords(A, "drum-machine")).toEqual([]);
    expect(await db.listSources(A)).toEqual([captured]);
    vi.restoreAllMocks();
    await expect(db.commitSource(captured.id, [word("first")], 0)).resolves.toBe("committed");
  });

  it("keeps the source when an uncloneable final field fails", async () => {
    const captured = source(); await db.capture(captured, 0);
    await expect(db.commitSource(captured.id, [word(() => undefined)], 0)).rejects.toThrow();
    expect(await db.listSources(A)).toEqual([captured]);
  });

  it("permanently tombstones a deleted owner, including attempts that reread its epoch", async () => {
    const first = source(), pending = source("pending");
    await db.capture(first, 0);
    await db.commitSource(first.id, [word("first")], 0);
    await db.capture(pending, 0);
    await db.writeWords([word("B", "drum-machine", B)], 0);
    await db.writeWords([word("guest", "drum-machine", "guest")], 0);
    expect(await db.deleteOwner(A)).toBe(1);
    const other = peer();
    expect(await other.ownerEpoch(A)).toBe(1);
    expect(await other.readWords(A, "drum-machine")).toEqual([]);
    expect(await other.listSources(A)).toEqual([]);
    for (const epoch of [0, 1]) {
      await expect(other.capture(first, epoch)).rejects.toBeInstanceOf(DeletedWordOwnerError);
      await expect(other.writeWords([word("resurrect")], epoch)).rejects.toBeInstanceOf(DeletedWordOwnerError);
    }
    expect(await other.commitSource(first.id, [word("first")], 0)).toBe("missing");
    expect(await other.readWords(B, "drum-machine")).toEqual([word("B", "drum-machine", B)]);
    expect(await other.readWords("guest", "drum-machine")).toEqual([word("guest", "drum-machine", "guest")]);
  });

  it("serializes deletion against another tab's queued write", async () => {
    await db.ownerEpoch(A);
    const other = peer(); await other.ownerEpoch(A);
    const deleted = db.deleteOwner(A);
    const late = other.writeWords([word("late")], 0);
    await expect(deleted).resolves.toBe(1);
    await expect(late).rejects.toBeInstanceOf(DeletedWordOwnerError);
    expect(await db.readWords(A, "drum-machine")).toEqual([]);
  });

  it("keeps deletion atomic when removing a source fails", async () => {
    const captured = source(); await db.capture(captured, 0); await db.writeWords([word("kept")], 0);
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["delete"]>) {
      if (this.name === "sources") throw new DOMException("Denied", "QuotaExceededError");
      return remove.apply(this, args);
    });
    await expect(db.deleteOwner(A)).rejects.toThrow("Denied");
    expect(await db.ownerEpoch(A)).toBe(0);
    expect(await db.listSources(A)).toEqual([captured]);
    expect(await db.readWords(A, "drum-machine")).toEqual([word("kept")]);
  });

  it("can reopen after a browser connection close, but not after explicit close", async () => {
    await db.writeWords([word("durable")], 0);
    const connection = (db as unknown as { connection: IDBDatabase }).connection;
    // fake-indexeddb 6.2.5 types this instance helper as taking a constructor.
    (forceCloseDatabase as unknown as (database: IDBDatabase) => void)(connection);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await db.readWords(A, "drum-machine")).toEqual([word("durable")]);
    db.close();
    await expect(db.ownerEpoch(A)).rejects.toMatchObject({ name: "InvalidStateError" });
  });
});

describe("exact captured source lookup", () => {
  it("returns the chosen pending capture without interpreting or changing its bytes", async () => {
    const original = source(), newer = source("newer");
    original.raw = "original\n\ud800";
    original.sourceVersion = "preservation:v1:legacy-parser:v1:extraction:1";
    original.id = JSON.stringify([A, original.appId, original.sourceKey, original.sourceVersion, original.digest]);
    original.fields.push({ path: "savedBeats[1].name", value: "unmapped", identity: { id: "beat-2" } });
    await db.capture(original, 0);
    await db.capture(newer, 0);

    expect(await db.readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(await db.readCapturedSource(A, source("missing").id, 0)).toBeNull();
    expect(await db.listSources(A)).toEqual([original, newer]);
    expect(await db.listCommittedSources(A)).toEqual([]);
    expect(await db.readWords(A, "drum-machine")).toEqual([]);
  });

  it("returns the same complete capture from its committed receipt", async () => {
    const original = source();
    original.fields.push({ path: "savedBeats[1].name", value: "unmapped", identity: { id: "beat-2" } });
    await db.capture(original, 0);
    await db.commitSource(original.id, [word("first")], 0);

    expect(await peer().readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(await db.listSources(A)).toEqual([]);
    expect(await db.listCommittedSources(A)).toEqual([original]);
    expect(await db.readWords(A, "drum-machine")).toEqual([word("first")]);
  });

  it("keeps a coherent capture while another connection queues its transfer", async () => {
    const original = source(), other = peer();
    await db.capture(original, 0);
    await other.ownerEpoch(A);
    let transfer: Promise<unknown> | undefined;
    const get = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["get"]>) {
      const result = get.apply(this, args);
      if (this.name === "sources" && this.transaction.mode === "readonly" && args[0] === original.id) {
        result.addEventListener("success", () => {
          transfer = other.commitSource(original.id, [word("first")], 0);
        }, { once: true });
      }
      return result;
    });

    expect(await db.readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(transfer).toBeDefined();
    await expect(transfer).resolves.toBe("committed");
    vi.restoreAllMocks();
    expect(await other.readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(await db.listSources(A)).toEqual([]);
    expect(await db.listCommittedSources(A)).toEqual([original]);
  });

  it("checks the epoch and capture in one snapshot when deletion is queued during the read", async () => {
    const original = source(), other = peer();
    await db.capture(original, 0);
    await other.ownerEpoch(A);
    let deletion: Promise<number> | undefined;
    const get = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["get"]>) {
      const result = get.apply(this, args);
      if (this.name === "owners" && this.transaction.mode === "readonly" && args[0] === A) {
        result.addEventListener("success", () => {
          deletion = other.deleteOwner(A);
        }, { once: true });
      }
      return result;
    });

    expect(await db.readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(deletion).toBeDefined();
    await expect(deletion).resolves.toBe(1);
    vi.restoreAllMocks();
    await expect(db.readCapturedSource(A, original.id, 0)).rejects.toBeInstanceOf(DeletedWordOwnerError);
    expect(await db.listSources(A)).toEqual([]);
  });

  it("denies foreign pending and committed IDs while leaving the other owner intact", async () => {
    const own = source(), foreignPending = source("foreign-pending", "drum-machine", B);
    const foreignCommitted = source("foreign-committed", "drum-machine", B);
    await db.capture(own, 0);
    await db.capture(foreignPending, 0);
    await db.capture(foreignCommitted, 0);
    await db.commitSource(foreignCommitted.id, [word("private B", "drum-machine", B)], 0);
    const before = {
      sources: await db.listSources(B), receipts: await db.listCommittedSources(B),
      words: await db.readWords(B, "drum-machine"), epoch: await db.ownerEpoch(B),
    };

    expect(await db.readCapturedSource(A, foreignPending.id, 0)).toBeNull();
    expect(await db.readCapturedSource(A, foreignCommitted.id, 0)).toBeNull();
    expect(await db.readCapturedSource(B, own.id, 0)).toBeNull();
    expect(await db.readCapturedSource(A, own.id, 0)).toEqual(own);
    expect({
      sources: await db.listSources(B), receipts: await db.listCommittedSources(B),
      words: await db.readWords(B, "drum-machine"), epoch: await db.ownerEpoch(B),
    }).toEqual(before);
  });

  it("rejects invalid owners and stale or deleted epochs even for missing IDs", async () => {
    const original = source();
    await db.capture(original, 0);
    await expect(db.readCapturedSource("raw-user-id", original.id, 0)).rejects.toThrow("Invalid local word owner");
    await expect(db.readCapturedSource(A, original.id, 5)).rejects.toBeInstanceOf(StaleOwnerEpochError);
    await expect(db.readCapturedSource(A, source("missing").id, 5)).rejects.toBeInstanceOf(StaleOwnerEpochError);
    await db.deleteOwner(A);
    for (const epoch of [0, 1]) {
      await expect(db.readCapturedSource(A, original.id, epoch)).rejects.toBeInstanceOf(DeletedWordOwnerError);
      await expect(db.readCapturedSource(A, source("missing").id, epoch)).rejects.toBeInstanceOf(DeletedWordOwnerError);
    }
  });

  it("rejects a lookup queued behind another connection's deletion", async () => {
    const original = source(), other = peer();
    await db.capture(original, 0);
    await other.ownerEpoch(A);
    const deletion = other.deleteOwner(A);
    const lookup = db.readCapturedSource(A, original.id, 0);
    await expect(lookup).rejects.toBeInstanceOf(DeletedWordOwnerError);
    await expect(deletion).resolves.toBe(1);
  });

  it("returns defensive copies from pending and committed storage", async () => {
    const original = source();
    await db.capture(original, 0);
    for (const committed of [false, true]) {
      if (committed) await db.commitSource(original.id, [word("first")], 0);
      const returned = await db.readCapturedSource(A, original.id, 0);
      expect(returned).not.toBeNull();
      returned!.raw = "caller edit";
      returned!.fields[0].value = "caller edit";
      returned!.fields[0].identity.id = "caller identity";
      returned!.fields.push({ path: "extra", value: "caller extra", identity: {} });
      expect(await db.readCapturedSource(A, original.id, 0)).toEqual(original);
    }
    expect(await db.listCommittedSources(A)).toEqual([original]);
  });

  it("accepts identical copies without retiring or replacing either copy", async () => {
    const original = source();
    await db.capture(original, 0);
    await putCapturedCopy("receipts", original);
    expect(await db.readCapturedSource(A, original.id, 0)).toEqual(original);
    expect(await db.listSources(A)).toEqual([original]);
    expect(await db.listCommittedSources(A)).toEqual([original]);
  });

  it("rejects contradictory copies with a redacted error and preserves both", async () => {
    const original = source(), conflicting = { ...original, raw: "private contradictory bytes" };
    await db.capture(original, 0);
    await putCapturedCopy("receipts", conflicting);
    await expect(db.readCapturedSource(A, original.id, 0)).rejects.toThrow("Local word captured source copies conflict.");
    expect(await db.listSources(A)).toEqual([original]);
    expect(await db.listCommittedSources(A)).toEqual([conflicting]);
    expect(await db.readWords(A, "drum-machine")).toEqual([]);
  });

  it("rejects contradictory ownership between copies without returning either owner's data", async () => {
    const original = source(), conflicting = { ...original, ownerKey: B };
    await db.capture(original, 0);
    await putCapturedCopy("receipts", conflicting);
    for (const ownerKey of [A, B]) {
      await expect(db.readCapturedSource(ownerKey, original.id, 0)).rejects.toThrow("Local word captured source copies conflict.");
    }
    expect(await db.listSources(A)).toEqual([original]);
    expect(await db.listCommittedSources(B)).toEqual([conflicting]);
  });

  it.each(["sources", "receipts"] as const)("rejects a malformed canonical identity in %s without disclosing or changing it", async storeName => {
    const original = source();
    await db.capture(original, 0);
    if (storeName === "receipts") await db.commitSource(original.id, [word("first")], 0);
    const malformed = { ...original, sourceKey: "private wrong source key" };
    await putCapturedCopy(storeName, malformed);
    await expect(db.readCapturedSource(A, original.id, 0)).rejects.toThrow("Local word captured source identity is invalid.");
    expect(await (storeName === "sources" ? db.listSources(A) : db.listCommittedSources(A))).toEqual([malformed]);
  });

  it.each([undefined, null, Number.NaN])("rejects malformed identity tuple values even if their JSON encoding matches (%s)", async sourceVersion => {
    const malformed = { ...source(), sourceVersion };
    malformed.id = JSON.stringify([A, malformed.appId, malformed.sourceKey, sourceVersion, malformed.digest]);
    await db.ownerEpoch(A);
    await putCapturedCopy("sources", malformed);
    await expect(db.readCapturedSource(A, malformed.id, 0)).rejects.toThrow("Local word captured source identity is invalid.");
  });
});
