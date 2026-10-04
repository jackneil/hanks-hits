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
