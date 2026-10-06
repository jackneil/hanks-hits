import { IDBCursor as FakeCursor, IDBFactory, IDBIndex as FakeIndex } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeletedJournalOwnerError, ProgressJournalDatabase, type JournalArchive, type JournalCheckpoint, type JournalPageCursor, type JournalPageOptions } from "../progressJournalDatabase";
import { journalOriginalId, journalSourceId } from "../progressJournalRecovery";

const ownerKey = `u_${"a".repeat(20)}`, other = `u_${"b".repeat(20)}`;
const row = (generation = 1, raw = "exact journal bytes"): JournalCheckpoint => ({ ownerKey, appId: "drawing-app", writerId: "writer", generation, raw });
const setup = () => { const factory = new IDBFactory(); return { factory, db: new ProgressJournalDatabase(factory) }; };
const connection = (db: ProgressJournalDatabase) => (db as unknown as { connection: IDBDatabase }).connection;
const changeStorage = (db: ProgressJournalDatabase, change: (tx: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
  const tx = connection(db).transaction(["owners", "checkpoints", "archives"], "readwrite");
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  change(tx);
});
const observeCheckpointCursors = (observe: (cursor: IDBCursorWithValue | null, tx: IDBTransaction) => void) => {
  const original = FakeIndex.prototype.openCursor;
  vi.spyOn(FakeIndex.prototype, "openCursor").mockImplementation(function (this: IDBIndex, ...args) {
    const req = original.apply(this, args);
    if (this.name === "owner" && this.objectStore.name === "checkpoints" && this.objectStore.transaction.mode === "readonly") {
      req.addEventListener("success", () => observe(req.result, this.objectStore.transaction));
    }
    return req;
  });
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("large progress journal checkpoints", () => {
  it("keeps immutable archive variants and finds them after cold reopen", async () => {
    const { db, factory } = setup(), sourceId = journalSourceId(ownerKey, "drawing-app", "writer", "current");
    const archive = { ownerKey, appId: "drawing-app" as const, sourceId, raw: "first envelope" };
    await db.archive(archive, 0); await db.archive(archive, 0);
    await db.archive({ ...archive, raw: "same current with another original" }, 0);
    db.close();
    const cold = new ProgressJournalDatabase(factory);
    expect((await cold.archivedSources(ownerKey, "drawing-app", sourceId, 0)).map(row => row.raw).sort()).toEqual(["first envelope", "same current with another original"]);
    const first = await cold.archivePage(ownerKey, 0, { maxRows: 1 });
    expect(first.rows).toHaveLength(1);
    const next = await cold.archivePage(ownerKey, 0, { cursor: first.nextCursor });
    expect([...first.rows, ...next.rows].map(row => row.raw).sort()).toEqual(["first envelope", "same current with another original"]);
    expect(next.nextCursor).toBeNull();
    await expect(cold.archivedSources(other, "drawing-app", sourceId, 0)).rejects.toThrow("Invalid journal source identity");
    cold.close();
  });

  it("deletes archives with their owner and fences late archival writes", async () => {
    const { db, factory } = setup(), sourceId = journalSourceId(ownerKey, "drawing-app", "writer", "current");
    const archive = { ownerKey, appId: "drawing-app" as const, sourceId, raw: "original" };
    await db.archive(archive, 0);
    const foreign = { ...archive, ownerKey: other, sourceId: journalSourceId(other, "drawing-app", "writer", "current") };
    await db.archive(foreign, 0);
    const late = new ProgressJournalDatabase(factory);
    await db.deleteOwner(ownerKey);
    await expect(late.archive(archive, 0)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    await expect(late.archivedSources(ownerKey, "drawing-app", sourceId, 0)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    expect(await db.archivedSources(other, "drawing-app", foreign.sourceId, 0)).toEqual([foreign]);
    const connection = (db as unknown as { connection: IDBDatabase }).connection;
    const remaining = await new Promise<number>((resolve, reject) => {
      const count = connection.transaction("archives").objectStore("archives").index("owner").count(ownerKey);
      count.onsuccess = () => resolve(count.result); count.onerror = () => reject(count.error);
    });
    expect(remaining).toBe(0);
    db.close(); late.close();
  });

  it("upgrades a version-1 database without losing checkpoints or owner tombstones", async () => {
    const factory = new IDBFactory();
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("hh-progress-journals:v1", 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("checkpoints", { keyPath: ["ownerKey", "appId", "writerId"] }).createIndex("owner", "ownerKey");
        open.result.createObjectStore("owners", { keyPath: "ownerKey" });
      };
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction(["checkpoints", "owners"], "readwrite");
      tx.objectStore("checkpoints").put(row());
      tx.objectStore("owners").put({ ownerKey: other, epoch: 1, deleted: true });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    legacy.close();
    const db = new ProgressJournalDatabase(factory);
    expect(await db.list(ownerKey, 0)).toEqual([row()]);
    expect((await db.checkpointPage(ownerKey, 0)).rows).toEqual([row()]);
    await expect(db.archivePage(other, 1)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    await expect(db.ownerEpoch(other)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    const sourceId = journalSourceId(ownerKey, "drawing-app", "writer", "current");
    await db.archive({ ownerKey, appId: "drawing-app", sourceId, raw: "archive" }, 0);
    expect(await db.archivedSources(ownerKey, "drawing-app", sourceId, 0)).toHaveLength(1);
    expect((await db.archivePage(ownerKey, 0)).rows.map(item => item.raw)).toEqual(["archive"]);
    db.close();
  });
  it("survives a cold database reopen with bytes larger than a small synchronous storage budget", async () => {
    const { db, factory } = setup(), original = row(1, "x".repeat(4 * 1024 * 1024));
    expect(await db.put(original, 0)).toBe("durable");
    db.close();
    const cold = new ProgressJournalDatabase(factory);
    expect(await cold.list(ownerKey, 0)).toEqual([original]);
    expect(await cold.checkpointPage(ownerKey, 0)).toEqual({ rows: [original], rawChars: original.raw.length, nextCursor: null });
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

describe("bounded owner journal inventory pages", () => {
  it("enumerates all owner applications and writers exactly once without the browser key-range global", async () => {
    const { db, factory } = setup();
    const checkpoints = [row(), { ...row(9, "old writer bytes"), writerId: "another" },
      { ...row(2, "cookie bytes"), appId: "cookie-clicker" as const }];
    for (const item of checkpoints) await db.put(item, 0);
    await db.put({ ...row(), ownerKey: other }, 0);
    vi.stubGlobal("IDBKeyRange", undefined);
    const found: JournalCheckpoint[] = [];
    let cursor: JournalPageCursor<"checkpoints"> | null = null;
    do {
      const page = await db.checkpointPage(ownerKey, 0, { maxRows: 1, cursor });
      found.push(...page.rows); cursor = page.nextCursor;
    } while (cursor);
    expect(found).toEqual(checkpoints.sort((a, b) => factory.cmp([a.ownerKey, a.appId, a.writerId], [b.ownerKey, b.appId, b.writerId])));
    expect((await db.checkpointPage(other, 0)).rows).toEqual([{ ...row(), ownerKey: other }]);
    // Legacy readers retain their existing shape and full-owner behavior.
    expect(await db.list(ownerKey, 0)).toEqual(found);
    db.close();
  });

  it("includes same-source digest variants and orphan archives across applications", async () => {
    const { db, factory } = setup();
    const sourceId = journalSourceId(ownerKey, "drawing-app", "writer", "current");
    const archives = [
      { ownerKey, appId: "drawing-app" as const, sourceId, raw: "first variant" },
      { ownerKey, appId: "drawing-app" as const, sourceId, raw: "second variant" },
      { ownerKey, appId: "drawing-app" as const, sourceId: journalSourceId(ownerKey, "drawing-app", "orphan", "gone"), raw: "orphan bytes" },
      { ownerKey, appId: "cookie-clicker" as const, sourceId: journalSourceId(ownerKey, "cookie-clicker", "cookie", "current"), raw: "cookie archive" },
    ];
    for (const item of archives) await db.archive(item, 0);
    await db.archive({ ...archives[0], ownerKey: other, sourceId: journalSourceId(other, "drawing-app", "writer", "current") }, 0);
    const expected = archives.map(item => ({ ...item, digest: journalOriginalId(item.raw) }))
      .sort((a, b) => factory.cmp([a.ownerKey, a.appId, a.sourceId, a.digest], [b.ownerKey, b.appId, b.sourceId, b.digest]));
    const found: Array<JournalArchive & { digest: string }> = [];
    let cursor: JournalPageCursor<"archives"> | null = null;
    do {
      const page = await db.archivePage(ownerKey, 0, { maxRows: 1, cursor });
      expect(page.rows).toHaveLength(1);
      if (page.nextCursor) expect(page.nextCursor.primaryKey).toEqual([ownerKey, page.rows[0].appId, page.rows[0].sourceId, page.rows[0].digest]);
      found.push(...page.rows); cursor = page.nextCursor;
    } while (cursor);
    expect(found).toEqual(expected);
    expect(await db.list(ownerKey, 0)).toEqual([]);
    expect((await db.archivedSources(ownerKey, "drawing-app", sourceId, 0)).map(item => item.raw).sort()).toEqual(["first variant", "second variant"]);
    db.close();
  });

  it("bounds rows and raw characters without splitting an oversized first checkpoint", async () => {
    const { db } = setup();
    const checkpoints = [{ ...row(1, "🙂"), writerId: "a" }, { ...row(1, "abcdef"), writerId: "b" }, { ...row(1, "z"), writerId: "c" }];
    for (const item of checkpoints) await db.put(item, 0);
    const first = await db.checkpointPage(ownerKey, 0, { maxRows: 2, maxRawChars: 5 });
    expect(first.rows).toEqual([checkpoints[0]]); expect(first.rawChars).toBe(2);
    const oversized = await db.checkpointPage(ownerKey, 0, { maxRawChars: 5, cursor: first.nextCursor });
    expect(oversized.rows).toEqual([checkpoints[1]]); expect(oversized.rawChars).toBe(6);
    const last = await db.checkpointPage(ownerKey, 0, { maxRows: 1, maxRawChars: 5, cursor: oversized.nextCursor });
    expect(last).toEqual({ rows: [checkpoints[2]], rawChars: 1, nextCursor: null });
    db.close();
  });

  it("bounds archive raw characters while preserving malformed and future raw strings exactly", async () => {
    const { db, factory } = setup();
    const raws = ["  {broken\u0000\ud800\n", '{"version":999,"originals":["opaque"]}', "small"];
    const archives = raws.map((raw, i) => ({ ownerKey, appId: "drawing-app" as const,
      sourceId: journalSourceId(ownerKey, "drawing-app", `writer-${i}`, "current"), raw }));
    for (const archive of archives) await db.archive(archive, 0);
    await db.put(row(1, raws[0]), 0);
    expect((await db.checkpointPage(ownerKey, 0)).rows[0].raw).toBe(raws[0]);
    const expected = archives.map(item => ({ ...item, digest: journalOriginalId(item.raw) }))
      .sort((a, b) => factory.cmp([a.ownerKey, a.appId, a.sourceId, a.digest], [b.ownerKey, b.appId, b.sourceId, b.digest]));
    const found: Array<JournalArchive & { digest: string }> = [];
    let cursor: JournalPageCursor<"archives"> | null = null;
    do {
      const page = await db.archivePage(ownerKey, 0, { maxRows: 2, maxRawChars: 1, cursor });
      expect(page.rows).toHaveLength(1); expect(page.rawChars).toBe(page.rows[0].raw.length);
      found.push(...page.rows); cursor = page.nextCursor;
    } while (cursor);
    expect(found).toEqual(expected);
    db.close();
  });

  it("uses finite default row and raw-character budgets", async () => {
    const { db } = setup();
    for (let i = 0; i < 101; i++) await db.put({ ...row(1, "x"), writerId: `writer-${String(i).padStart(3, "0")}` }, 0);
    const first = await db.checkpointPage(ownerKey, 0);
    expect(first.rows).toHaveLength(100); expect(first.rawChars).toBe(100);
    expect((await db.checkpointPage(ownerKey, 0, { cursor: first.nextCursor })).rows).toHaveLength(1);
    const archive = { ownerKey, appId: "drawing-app" as const, sourceId: journalSourceId(ownerKey, "drawing-app", "a", "current"), raw: "x".repeat(256 * 1024) };
    await db.archive(archive, 0);
    await db.archive({ ...archive, sourceId: journalSourceId(ownerKey, "drawing-app", "b", "current"), raw: "next" }, 0);
    const archiveFirst = await db.archivePage(ownerKey, 0);
    expect(archiveFirst.rows).toHaveLength(1); expect(archiveFirst.rawChars).toBe(256 * 1024);
    expect((await db.archivePage(ownerKey, 0, { cursor: archiveFirst.nextCursor })).rows.map(item => item.raw)).toEqual(["next"]);
    db.close();
  });

  it("returns an empty terminal page for owners with no records", async () => {
    const { db } = setup();
    expect(await db.checkpointPage(ownerKey, 0)).toEqual({ rows: [], rawChars: 0, nextCursor: null });
    expect(await db.archivePage(ownerKey, 0)).toEqual({ rows: [], rawChars: 0, nextCursor: null });
    db.close();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "1"])("rejects invalid page budgets %s before opening storage", async budget => {
    const { db, factory } = setup(), open = vi.spyOn(factory, "open");
    await expect(db.checkpointPage(ownerKey, 0, { maxRows: budget } as JournalPageOptions<"checkpoints">)).rejects.toThrow("page budget");
    await expect(db.archivePage(ownerKey, 0, { maxRawChars: budget } as JournalPageOptions<"archives">)).rejects.toThrow("page budget");
    expect(open).not.toHaveBeenCalled(); db.close();
  });

  it("rejects malformed options and invalid owner epochs before opening storage", async () => {
    const { db, factory } = setup(), open = vi.spyOn(factory, "open");
    for (const options of [null, [], "bad", { surprise: 1 }]) {
      await expect(db.checkpointPage(ownerKey, 0, options as JournalPageOptions<"checkpoints">)).rejects.toThrow("page options");
    }
    for (const epoch of [-1, 1.5, NaN, Infinity]) await expect(db.archivePage(ownerKey, epoch)).rejects.toThrow("owner epoch");
    await expect(db.checkpointPage("invalid owner", 0)).rejects.toThrow("Invalid journal owner");
    expect(open).not.toHaveBeenCalled(); db.close();
  });

  it("rejects cursors moved to another owner, store, epoch or malformed full primary key", async () => {
    const { db } = setup();
    await db.put({ ...row(), writerId: "a" }, 0); await db.put({ ...row(), writerId: "b" }, 0);
    const cursor = (await db.checkpointPage(ownerKey, 0, { maxRows: 1 })).nextCursor!;
    const bad = [[], "bad", { ...cursor, kind: "archives" }, { ...cursor, ownerKey: other }, { ...cursor, epoch: 1 },
      { ...cursor, primaryKey: [other, "drawing-app", "a"] }, { ...cursor, primaryKey: [ownerKey, "unknown-app", "a"] },
      { ...cursor, primaryKey: [ownerKey, "drawing-app", "invalid writer"] }, { ...cursor, primaryKey: [ownerKey, "drawing-app"] },
      { ...cursor, primaryKey: [ownerKey, "drawing-app", "a", "extra"] }, { ...cursor, extra: true }];
    for (const incoming of bad) {
      await expect(db.checkpointPage(ownerKey, 0, { cursor: incoming } as JournalPageOptions<"checkpoints">)).rejects.toThrow("page cursor");
    }
    await expect(db.checkpointPage(other, 0, { cursor })).rejects.toThrow("page cursor");
    await expect(db.checkpointPage(ownerKey, 1, { cursor })).rejects.toThrow("page cursor");
    await expect(db.archivePage(ownerKey, 0, { cursor } as unknown as JournalPageOptions<"archives">)).rejects.toThrow("page cursor");
    const sourceId = journalSourceId(ownerKey, "drawing-app", "writer", "current");
    await db.archive({ ownerKey, appId: "drawing-app", sourceId, raw: "a" }, 0);
    await db.archive({ ownerKey, appId: "drawing-app", sourceId, raw: "b" }, 0);
    const archive = (await db.archivePage(ownerKey, 0, { maxRows: 1 })).nextCursor!;
    for (const primaryKey of [[ownerKey, "drawing-app", sourceId], [ownerKey, "drawing-app", "invalid source", archive.primaryKey[3]],
      [ownerKey, "drawing-app", sourceId, "invalid digest"]]) {
      await expect(db.archivePage(ownerKey, 0, { cursor: { ...archive, primaryKey } } as unknown as JournalPageOptions<"archives">)).rejects.toThrow("page cursor");
    }
    db.close();
  });

  it("snapshots page options and the nested cursor before awaiting storage", async () => {
    const { db, factory } = setup();
    const checkpoints = ["a", "b", "c"].map(writerId => ({ ...row(), writerId }));
    for (const checkpoint of checkpoints) await db.put(checkpoint, 0);
    const first = await db.checkpointPage(ownerKey, 0, { maxRows: 1 }); db.close();
    const cold = new ProgressJournalDatabase(factory);
    const options = { maxRows: 1, cursor: first.nextCursor! };
    const pending = cold.checkpointPage(ownerKey, 0, options);
    options.maxRows = 99; options.cursor.ownerKey = other; (options.cursor.primaryKey as unknown as string[])[2] = "c";
    const page = await pending;
    expect(page.rows).toEqual([checkpoints[1]]); expect(page.nextCursor?.primaryKey).toEqual([ownerKey, "drawing-app", "b"]);
    cold.close();
  });

  it("seeks by full primary key rather than rescanning every previous owner row", async () => {
    const { db } = setup();
    for (let i = 0; i < 30; i++) await db.put({ ...row(), writerId: `writer-${String(i).padStart(2, "0")}` }, 0);
    const first = await db.checkpointPage(ownerKey, 0, { maxRows: 25 });
    const seek = vi.spyOn(FakeCursor.prototype, "continuePrimaryKey");
    let reads = 0; observeCheckpointCursors(() => { reads++; });
    const next = await db.checkpointPage(ownerKey, 0, { maxRows: 1, cursor: first.nextCursor });
    expect(next.rows.map(item => item.writerId)).toEqual(["writer-25"]);
    expect(seek).toHaveBeenCalledWith(ownerKey, [ownerKey, "drawing-app", "writer-24"]);
    expect(reads).toBeLessThanOrEqual(4);
    db.close();
  });

  it("continues when the boundary record vanished and exposes new rows as a separate page snapshot", async () => {
    const { db } = setup();
    const firstRow = { ...row(), writerId: "a" }, lastRow = { ...row(), writerId: "c" };
    await db.put(firstRow, 0); await db.put(lastRow, 0);
    const first = await db.checkpointPage(ownerKey, 0, { maxRows: 1 });
    await changeStorage(db, tx => { tx.objectStore("checkpoints").delete([ownerKey, "drawing-app", "a"]); });
    const inserted = { ...row(1, "new insertion"), writerId: "b" }, advanced = { ...lastRow, generation: 2, raw: "newer bytes" };
    await db.put(inserted, 0); await db.put(advanced, 0);
    const next = await db.checkpointPage(ownerKey, 0, { cursor: first.nextCursor });
    expect(next).toEqual({ rows: [inserted, advanced], rawChars: inserted.raw.length + advanced.raw.length, nextCursor: null });
    db.close();
  });

  it("rejects a page after the durable owner epoch changed", async () => {
    const { db } = setup();
    await db.put({ ...row(), writerId: "a" }, 0); await db.put({ ...row(), writerId: "b" }, 0);
    const first = await db.checkpointPage(ownerKey, 0, { maxRows: 1 });
    await changeStorage(db, tx => { tx.objectStore("owners").put({ ownerKey, epoch: 1 }); });
    await expect(db.checkpointPage(ownerKey, 0, { cursor: first.nextCursor })).rejects.toThrow("epoch changed");
    await expect(db.checkpointPage(ownerKey, 1, { cursor: first.nextCursor })).rejects.toThrow("page cursor");
    db.close();
  });

  it("rejects explicit deletion started while a readonly cursor is outstanding", async () => {
    const { db, factory } = setup(), deleting = new ProgressJournalDatabase(factory);
    await db.put(row(), 0); await deleting.ownerEpoch(ownerKey);
    let deletion: Promise<void> | undefined;
    observeCheckpointCursors(cursor => { if (cursor && !deletion) deletion = deleting.deleteOwner(ownerKey); });
    await expect(db.checkpointPage(ownerKey, 0)).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    expect(deletion).toBeDefined(); await deletion;
    db.close(); deleting.close();
  });

  it("fences both kinds of continuation after deletion between pages", async () => {
    const { db } = setup();
    for (const writerId of ["a", "b"]) {
      await db.put({ ...row(), writerId }, 0);
      await db.archive({ ownerKey, appId: "drawing-app", sourceId: journalSourceId(ownerKey, "drawing-app", writerId, "current"), raw: writerId }, 0);
    }
    const checkpoints = await db.checkpointPage(ownerKey, 0, { maxRows: 1 });
    const archives = await db.archivePage(ownerKey, 0, { maxRows: 1 });
    await db.deleteOwner(ownerKey);
    await expect(db.checkpointPage(ownerKey, 0, { cursor: checkpoints.nextCursor })).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    await expect(db.archivePage(ownerKey, 0, { cursor: archives.nextCursor })).rejects.toBeInstanceOf(DeletedJournalOwnerError);
    db.close();
  });

  it("rejects a transaction aborted after the cursor successfully returned all rows", async () => {
    const { db } = setup(); await db.put(row(), 0);
    let terminalCursorSucceeded = false;
    observeCheckpointCursors((cursor, tx) => {
      if (!cursor) { terminalCursorSucceeded = true; queueMicrotask(() => tx.abort()); }
    });
    await expect(db.checkpointPage(ownerKey, 0)).rejects.toThrow("transaction aborted");
    expect(terminalCursorSucceeded).toBe(true);
    vi.restoreAllMocks();
    expect((await db.checkpointPage(ownerKey, 0)).rows).toEqual([row()]);
    db.close();
  });
});
