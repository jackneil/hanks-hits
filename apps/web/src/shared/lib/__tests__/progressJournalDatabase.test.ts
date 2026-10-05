import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DeletedJournalOwnerError, ProgressJournalDatabase, type JournalCheckpoint } from "../progressJournalDatabase";

const ownerKey = `u_${"a".repeat(20)}`, other = `u_${"b".repeat(20)}`;
const row = (generation = 1, raw = "exact journal bytes"): JournalCheckpoint => ({ ownerKey, appId: "drawing-app", writerId: "writer", generation, raw });
const setup = () => { const factory = new IDBFactory(); return { factory, db: new ProgressJournalDatabase(factory) }; };

describe("large progress journal checkpoints", () => {
  it("survives a cold database reopen with bytes larger than a small synchronous storage budget", async () => {
    const { db, factory } = setup(), original = row(1, "x".repeat(4 * 1024 * 1024));
    expect(await db.put(original, 0)).toBe("durable");
    db.close();
    const cold = new ProgressJournalDatabase(factory);
    expect(await cold.list(ownerKey, 0)).toEqual([original]);
    cold.close();
  });
  it("does not let a late lower-generation commit replace newer progress", async () => {
    const { db } = setup();
    expect(await db.put(row(4, "new"), 0)).toBe("durable");
    expect(await db.put(row(3, "late old"), 0)).toBe("superseded");
    expect(await db.list(ownerKey, 0)).toEqual([row(4, "new")]);
    db.close();
  });
  it("accepts an exact repeated receipt but rejects reused generations with different bytes", async () => {
    const { db } = setup();
    await db.put(row(), 0);
    expect(await db.put(row(), 0)).toBe("durable");
    await expect(db.put(row(1, "different"), 0)).rejects.toThrow("generation conflicts");
    expect(await db.list(ownerKey, 0)).toEqual([row()]);
    db.close();
  });
  it("isolates owners and writers even when other address components match", async () => {
    const { db } = setup();
    await db.put(row(), 0);
    const second = { ...row(), ownerKey: other }, third = { ...row(), writerId: "other-writer" };
    await db.put(second, 0); await db.put(third, 0);
    expect(await db.list(other, 0)).toEqual([second]);
    expect(await db.list(ownerKey, 0)).toHaveLength(2);
    db.close();
  });
  it("rejects a stale epoch without writing a checkpoint", async () => {
    const { db } = setup();
    await expect(db.put(row(), 1)).rejects.toThrow("epoch changed");
    expect(await db.list(ownerKey, 0)).toEqual([]);
    db.close();
  });
  it("permanently fences old and newly opened writers after explicit owner deletion", async () => {
    const { db, factory } = setup();
    await db.put(row(), 0); await db.put({ ...row(), ownerKey: other }, 0);
    const late = new ProgressJournalDatabase(factory);
    await db.deleteOwner(ownerKey);
    await expect(late.put(row(2), 0)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    await expect(late.ownerEpoch(ownerKey)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    expect(await db.list(other, 0)).toHaveLength(1);
    db.close(); late.close();
  });
  it("snapshots caller metadata before opening storage", async () => {
    const { db } = setup(), incoming = row();
    const pending = db.put(incoming, 0);
    incoming.ownerKey = other; incoming.raw = "mutated";
    await pending;
    expect(await db.list(ownerKey, 0)).toEqual([row()]);
    expect(await db.list(other, 0)).toEqual([]);
    db.close();
  });
  it("compares the last receipt atomically rather than letting a larger generation claim another writer", async () => {
    const { db } = setup();
    const original = row(3, "original");
    await db.put(original, 0, null);
    await expect(db.put(row(4, "foreign"), 0, null)).rejects.toThrow("generation conflicts");
    await expect(db.put(row(4, "foreign"), 0, { generation: 2, raw: "older" })).rejects.toThrow("generation conflicts");
    expect(await db.put(row(4, "own next"), 0, original)).toBe("durable");
    expect(await db.put(row(4, "own next"), 0, original)).toBe("durable");
    expect(await db.list(ownerKey, 0)).toEqual([row(4, "own next")]);
    db.close();
  });
  it.each(["InvalidStateError", "UnknownError"])("reopens after %s without a browser close event", async name => {
    const { db } = setup();
    await db.put(row(), 0);
    const cached = (db as unknown as { connection: IDBDatabase }).connection;
    vi.spyOn(cached, "transaction").mockImplementation(() => { throw new DOMException("Lost connection", name); });
    await expect(db.list(ownerKey, 0)).rejects.toMatchObject({ name });
    expect(await db.list(ownerKey, 0)).toEqual([row()]);
    db.close();
  });
  it("does not revive a database closed during opening", async () => {
    const { db } = setup();
    const pending = db.put(row(), 0); db.close();
    await expect(pending).rejects.toThrow("closed");
  });
});
