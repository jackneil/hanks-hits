import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress, PROGRESS_NAMESPACE } from "@/lib/owner-bound-progress/core";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { cloneProgress, newProgressJournal, progressJournalKey } from "../progressJournal";
import { nextJournalEnvelope } from "../progressJournalEnvelope";
import { ProgressJournalDatabase } from "../progressJournalDatabase";
import { ProgressJournalRepository } from "../progressJournalRepository";
import { ProgressSyncSession } from "../progressSyncSession";
import { journalSourceId, resolvedJournalSources } from "../progressJournalRecovery";

class MemoryStorage {
  data = new Map<string, string>();
  failWrite = false;
  failRead = false;
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { if (this.failRead) throw Error("read unavailable"); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw Error("quota"); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const close: Array<() => void> = [];
afterEach(() => { close.splice(0).forEach(fn => fn()); });
const appId = "drawing-app" as const, ownerId = "owner";
const defaults = () => cloneProgress(useDrawingStore.getState().getProgress());
const art = (id: string, bytes = 0) => ({ id, name: id, dataUrl: "x".repeat(bytes) || id, thumbnail: id,
  createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" });
const journal = (writerId = "writer", name?: string, bytes = 0) => {
  const data = { ...defaults(), savedArtworks: name ? [art(name, bytes)] : [] };
  return newProgressJournal(appId, ownerId, writerId, { data, revision: "a".repeat(64) }, data, true);
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const local = new MemoryStorage(), factory = new IDBFactory();
  const authority = createOwnerBoundProgress({ storage: () => local, sessionStorage: () => new MemoryStorage() });
  await authority.updateSession("authenticated", ownerId);
  const lease = authority.captureLease()!;
  const database = new ProgressJournalDatabase(factory), words = new LocalWordsDatabase(factory, "repository-words");
  close.push(() => { database.close(); words.close(); });
  const options = { authority, lease, database, words, appId, ownerId, writerId: "writer", maySave: () => true };
  const create = (patch: Partial<Parameters<typeof ProgressJournalRepository.create>[0]> = {}) => ProgressJournalRepository.create({ ...options, ...patch });
  const physical = (writer = "writer") => PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, progressJournalKey(appId, writer)]);
  return { local, factory, authority, lease, database, words, create, physical };
}

describe("owner-bound journal repository", () => {
  async function pendingRecovery() {
    const h = await fixture(), original = (await h.create({ writerId: "original" })).repository;
    const pending = journal("original", "only-drawing"); pending.acknowledged.data = { ...defaults(), savedArtworks: [] };
    const raw = JSON.stringify(pending);
    original.persist(raw, []); await original.settle();
    const { repository, recovery } = await h.create();
    const source = recovery.copies[0];
    const adopted = (await repository.adopt(source.sourceId))!;
    const session = new ProgressSyncSession<ReturnType<typeof defaults>>(adopted, appId, ownerId,
      { maySave: () => h.authority.isCurrent(h.lease), persist: repository.persist, requestId: () => "fresh" });
    return { h, original, repository, source, session, raw, pending };
  }

  async function acknowledge(session: ProgressSyncSession<ReturnType<typeof defaults>>, repository: ProgressJournalRepository) {
    const initial = session.snapshot()!;
    expect(session.observe(initial.acknowledged)).toBe("pending");
    const request = session.prepare(initial.live)!;
    expect(session.receive(request.id, { data: request.data, revision: "b".repeat(64) }, "accepted", initial.live)).toBe("saved");
    await repository.settle();
    return repository.snapshot()!.current;
  }

  it("records an exact source receipt only after ACK and word capture, without deleting the original", async () => {
    const { h, repository, source, session } = await pendingRecovery();
    const before = h.local.data.get(h.physical("original"));
    expect(await repository.resolve([source.sourceId], repository.snapshot()!.current)).toBe(false);
    const acknowledged = await acknowledge(session, repository);
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(true);
    expect(repository.snapshot()!.recovery).toEqual({ version: 1, adoptedSources: [],
      resolutions: [{ sourceId: source.sourceId, revision: "b".repeat(64), preservedOriginals: [] }] });
    expect(h.local.data.get(h.physical("original"))).toBe(before);
    expect((await h.words.listSources(h.lease.ownerKey)).some(record => record.raw === source.envelope.current)).toBe(true);
    const cold = (await h.create({ writerId: "cold" })).repository;
    expect(await cold.adopt(source.sourceId)).toBeNull();
  });

  it("fences a second recovery tab once the exact adopted copy is resolved elsewhere", async () => {
    const { h, repository, source, session } = await pendingRecovery();
    const other = (await h.create({ writerId: "other-recovery" })).repository;
    expect(await other.adopt(source.sourceId)).not.toBeNull();
    expect(await other.adoptionStatus()).toBe("clear");
    const acknowledged = await acknowledge(session, repository);
    await repository.resolve([source.sourceId], acknowledged);
    expect(await other.adoptionStatus()).toBe("resolved");
    expect(other.snapshot()!.current).toContain("only-drawing");
  });

  it("does not resolve a later source version or unrelated source under an old ACK", async () => {
    const { original, repository, source, session, pending } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository);
    pending.serial++; pending.live.stats.totalDrawTime++;
    original.persist(JSON.stringify(pending), []); await original.settle();
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(true);
    const later = (await repository.recover()).copies.find(copy => copy.writerId === "original")!;
    expect(later.sourceId).not.toBe(source.sourceId);
    expect(await repository.resolve([later.sourceId], acknowledged)).toBe(false);
    expect(repository.snapshot()!.recovery!.resolutions.map(item => item.sourceId)).toEqual([source.sourceId]);
  });

  it("retains unresolved provenance on capture failure and retries partial capture safely", async () => {
    const { h, repository, source, session } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository);
    vi.spyOn(h.words, "capture").mockRejectedValueOnce(Error("quota"));
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(false);
    expect(repository.snapshot()!.recovery!.adoptedSources).toContain(source.sourceId);
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(true);
  });

  it.each(["edit", "revoke"])("does not publish a receipt after %s during word capture", async action => {
    const { h, repository, source, session } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository), gate = deferred<void>(), entered = deferred<void>();
    const capture = h.words.capture.bind(h.words);
    vi.spyOn(h.words, "capture").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return capture(...args); });
    const resolving = repository.resolve([source.sourceId], acknowledged);
    await entered.promise;
    if (action === "revoke") h.authority.revoke();
    else { const live = session.snapshot()!.live; live.stats.totalDrawTime++; session.capture(live); await repository.settle(); }
    gate.resolve();
    expect(await resolving).toBe(false);
    const rows = await h.database.list(h.lease.ownerKey, 0);
    const own = rows.find(row => row.writerId === "writer")!;
    expect(JSON.parse(own.raw).recovery.resolutions).toEqual([]);
    if (action === "edit") expect(JSON.parse(own.raw).current).not.toBe(acknowledged);
  });

  it("keeps a failed receipt write invisible to other recovery tabs until it is durable", async () => {
    const { h, repository, source, session } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository);
    h.local.failWrite = true;
    const put = vi.spyOn(h.database, "put").mockRejectedValue(Error("quota"));
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(false);
    const inventory = await repository.recover();
    expect(inventory.copies.find(copy => copy.writerId === "writer")!.envelope.recovery!.resolutions).toEqual([]);
    put.mockRestore();
    expect(await repository.retry()).toBe(true);
    expect((await repository.recover()).copies.find(copy => copy.writerId === "writer")!.envelope.recovery!.resolutions).toHaveLength(1);
  });

  it("blocks adoption and dispatch checks when a backend cannot be inspected", async () => {
    const { h, source, repository } = await pendingRecovery();
    vi.spyOn(h.database, "list").mockRejectedValue(Error("unavailable"));
    expect(await repository.adoptionStatus()).toBe("unavailable");
    const cold = (await h.create({ writerId: "cold" })).repository;
    expect(await cold.adopt(source.sourceId)).toBeNull();
  });

  it("can retry an adoption whose first writes failed without claiming durability early", async () => {
    const { h, source } = await pendingRecovery();
    const cold = (await h.create({ writerId: "cold" })).repository;
    h.local.failWrite = true;
    const put = vi.spyOn(h.database, "put").mockRejectedValue(Error("quota"));
    expect(await cold.adopt(source.sourceId)).toBeNull();
    expect(cold.isDurable()).toBe(false);
    put.mockRestore();
    expect(await cold.adopt(source.sourceId)).not.toBeNull();
    expect(cold.isDurable()).toBe(true);
  });

  it("resolves inherited exact sources after cold recovery even when the ancestor writer advanced", async () => {
    const { h, original, pending, source } = await pendingRecovery();
    pending.serial++; pending.live.stats.totalDrawTime++;
    original.persist(JSON.stringify(pending), []); await original.settle();
    h.database.close();
    const database = new ProgressJournalDatabase(h.factory); close.push(() => database.close());
    const { repository, recovery } = await h.create({ writerId: "cold", database });
    const intermediate = recovery.copies.find(copy => copy.writerId === "writer")!;
    const raw = (await repository.adopt(intermediate.sourceId))!;
    expect(repository.snapshot()!.recovery!.adoptedSources).toEqual([intermediate.sourceId, source.sourceId]);
    const session = new ProgressSyncSession<ReturnType<typeof defaults>>(raw, appId, ownerId,
      { maySave: () => true, persist: repository.persist, requestId: () => "cold-request" });
    const acknowledged = await acknowledge(session, repository);
    expect(await repository.resolve([intermediate.sourceId, source.sourceId], acknowledged)).toBe(true);
    expect(repository.snapshot()!.recovery!.adoptedSources).toEqual([]);
    expect((await h.words.listSources(h.lease.ownerKey)).some(record => record.raw === source.envelope.current)).toBe(true);
    const inventory = await repository.recover();
    const resolved = resolvedJournalSources(inventory.copies, appId, h.lease.ownerKey)!;
    expect(resolved.has(source.sourceId)).toBe(true);
    expect(resolved.has(inventory.copies.find(copy => copy.writerId === "original")!.sourceId)).toBe(false);
  });

  it("does not suppress a retained alternative added under the same source identity during capture", async () => {
    const { h, repository, source, session, original, raw } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository), gate = deferred<void>(), entered = deferred<void>();
    const capture = h.words.capture.bind(h.words);
    vi.spyOn(h.words, "capture").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return capture(...args); });
    const resolving = repository.resolve([source.sourceId], acknowledged);
    await entered.promise;
    const late = JSON.stringify(journal("original", "late-alternative"));
    original.persist(raw, [late]); await original.settle();
    gate.resolve();
    expect(await resolving).toBe(true);
    const inventory = await repository.recover();
    expect(inventory.copies.find(copy => copy.writerId === "original")!.sourceId).toBe(source.sourceId);
    expect(resolvedJournalSources(inventory.copies, appId, h.lease.ownerKey)!.has(source.sourceId)).toBe(false);
    const cold = (await h.create({ writerId: "cold" })).repository;
    expect(await cold.adopt(source.sourceId)).not.toBeNull();
    expect(cold.snapshot()!.originals.some(item => item.raw === late)).toBe(true);
  });

  it("does not adopt until the original envelope archive is durable", async () => {
    const { h, source } = await pendingRecovery();
    const cold = (await h.create({ writerId: "cold" })).repository;
    const archive = vi.spyOn(h.database, "archive").mockRejectedValueOnce(Error("quota"));
    expect(await cold.adopt(source.sourceId)).toBeNull();
    expect(cold.snapshot()).toBeNull();
    expect(await cold.adopt(source.sourceId)).not.toBeNull();
    expect(archive).toHaveBeenCalledTimes(2);
  });

  it("rejects a corrupt archived ancestor instead of interpreting it as preservation proof", async () => {
    const { h, source, session, repository } = await pendingRecovery();
    const acknowledged = await acknowledge(session, repository);
    vi.spyOn(h.database, "archivedSources").mockResolvedValue([{ ownerKey: h.lease.ownerKey, appId, sourceId: source.sourceId, raw: "unreadable" }]);
    expect(await repository.resolve([source.sourceId], acknowledged)).toBe(false);
    expect(repository.snapshot()!.recovery!.resolutions).toEqual([]);
  });

  it("recovers exact bytes from a new document and refuses to reuse any recovered writer", async () => {
    const h = await fixture(), { repository } = await h.create();
    const raw = JSON.stringify(journal(), null, 2);
    expect(repository.persist(raw, [])).toBe(true);
    await repository.settle();
    const { recovery } = await h.create({ writerId: "next" });
    expect(recovery.unavailable).toBe(false);
    expect(recovery.copies).toHaveLength(1);
    expect(recovery.copies[0].envelope.current).toBe(raw);
    await expect(h.create()).rejects.toThrow("new journal writer");
  });

  it("requires exact asynchronous receipts before the session can send after quota refusal", async () => {
    const h = await fixture(), { repository } = await h.create();
    const start = journal();
    repository.persist(JSON.stringify(start), []); await repository.settle();
    h.local.failWrite = true;
    const requestId = vi.fn(() => "one-request");
    const session = new ProgressSyncSession(JSON.stringify(start), appId, ownerId,
      { maySave: () => true, persist: repository.persist, requestId });
    const live = { ...start.live, settings: { ...start.live.settings, showGrid: true } };
    expect(session.prepare(live)).toBeNull();
    expect(repository.isDurable()).toBe(false);
    await repository.settle();
    expect(session.prepare(live)).toBeNull(); // capture durable, prepared request still awaiting its receipt
    await repository.settle();
    const request = session.prepare(live)!;
    expect(request.id).toBe("one-request");
    expect(requestId).toHaveBeenCalledTimes(1);
    const rows = await h.database.list(h.lease.ownerKey, 0);
    expect(JSON.parse(JSON.parse(rows[0].raw).current).sent).toEqual(request);
    const physical = h.authority.readDurableScoped(progressJournalKey(appId, "writer"));
    expect(physical.status).toBe("durable");
    if (physical.status === "durable") expect(JSON.parse(physical.raw!).current).toBe(JSON.stringify(start));
  });

  it("does not mistake memory fallback or a late old receipt for the current save", async () => {
    const h = await fixture(), first = deferred<"durable">(), second = deferred<"durable">();
    const put = vi.spyOn(h.database, "put").mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const onDurable = vi.fn(), { repository } = await h.create({ onDurable });
    h.local.failWrite = true;
    const old = JSON.stringify(journal()), changed = journal(); changed.serial++; changed.live.stats.totalDrawTime++;
    expect(repository.persist(old, [])).toBe(false);
    expect(repository.persist(JSON.stringify(changed), [old])).toBe(false);
    expect(h.authority.readScoped(progressJournalKey(appId, "writer"))).not.toBeNull();
    expect(h.authority.readDurableScoped(progressJournalKey(appId, "writer"))).toEqual({ status: "missing" });
    first.resolve("durable");
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(repository.isDurable()).toBe(false); expect(onDurable).not.toHaveBeenCalled();
    second.resolve("durable"); await repository.settle();
    expect(repository.isDurable()).toBe(true); expect(onDurable).toHaveBeenCalledTimes(1);
  });

  it("recovers an oversized IndexedDB generation rather than the older local copy", async () => {
    const h = await fixture(), { repository } = await h.create();
    const old = JSON.stringify(journal()); repository.persist(old, []); await repository.settle();
    h.local.failWrite = true;
    const next = journal("writer", "large", 140_492); next.serial++;
    expect(repository.persist(JSON.stringify(next), [old])).toBe(false); await repository.settle();
    h.database.close(); const cold = new ProgressJournalDatabase(h.factory); close.push(() => cold.close());
    const { recovery } = await h.create({ writerId: "cold", database: cold });
    expect(recovery.unavailable).toBe(false);
    expect(JSON.parse(recovery.copies[0].envelope.current)).toEqual(next);
    expect(recovery.copies[0].envelope.generation).toBe(2);
  });

  it("preserves unique original words atomically until capture succeeds", async () => {
    const h = await fixture(), { repository } = await h.create();
    const original = JSON.stringify(journal("writer", "only-original"), null, 2), next = JSON.stringify(journal("writer", "replacement"));
    expect(repository.persist(next, [original])).toBe(true); await repository.settle();
    const capture = vi.spyOn(h.words, "capture").mockRejectedValueOnce(Error("quota"));
    await repository.drain();
    expect(repository.snapshot()!.originals.map(item => item.raw)).toContain(original);
    capture.mockRestore();
    expect(await repository.retry()).toBe(true);
    expect(repository.snapshot()!.originals).toEqual([]);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every(source => source.raw === original)).toBe(true);
    const { recovery } = await h.create({ writerId: "cold" });
    expect(recovery.copies[0].envelope.originals).toEqual([]);
  });

  it("does not lose a newer edit made while word capture is awaiting storage", async () => {
    const h = await fixture(), { repository } = await h.create();
    const original = JSON.stringify(journal("writer", "old")), next = JSON.stringify(journal("writer", "next"));
    repository.persist(next, [original]); await repository.settle();
    const gate = deferred<void>(), entered = deferred<void>(), capture = h.words.capture.bind(h.words);
    vi.spyOn(h.words, "capture").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return capture(...args); });
    const draining = repository.drain(); await entered.promise;
    const later = journal("writer", "later"); later.serial = 4;
    repository.persist(JSON.stringify(later), [next]);
    gate.resolve(); await draining;
    expect(repository.snapshot()!.current).toBe(JSON.stringify(later));
    expect(repository.snapshot()!.originals.map(item => item.raw)).toContain(next);
    expect(repository.snapshot()!.originals.map(item => item.raw)).not.toContain(original);
    await repository.retry();
    expect(repository.snapshot()!.originals).toEqual([]);
  });

  it("revokes pending receipts and capture permission when the document owner changes", async () => {
    const h = await fixture(), gate = deferred<"durable">();
    vi.spyOn(h.database, "put").mockImplementation(() => gate.promise);
    const onDurable = vi.fn(), { repository } = await h.create({ onDurable });
    h.local.failWrite = true; repository.persist(JSON.stringify(journal()), []);
    h.authority.revoke(); gate.resolve("durable");
    expect(await repository.settle()).toBe(false); expect(onDurable).not.toHaveBeenCalled();
    expect(repository.snapshot()).toBeNull(); expect(await repository.drain()).toBe(false);
    expect(repository.persist(JSON.stringify(journal()), [])).toBe(false);
  });

  it("fences explicit deleted-owner checkpoints even when a local write could succeed", async () => {
    const h = await fixture(), { repository } = await h.create();
    await h.database.deleteOwner(h.lease.ownerKey);
    expect(repository.persist(JSON.stringify(journal()), [])).toBe(false);
    expect(await repository.settle()).toBe(false);
    expect(repository.persist(JSON.stringify(journal()), [])).toBe(false);
    await expect(h.create({ writerId: "new" })).rejects.toThrow("deleted");
  });

  it("recovers its own successful write after an unavailable immediate readback", async () => {
    const h = await fixture(), { repository } = await h.create();
    const read = h.authority.readDurableScoped.bind(h.authority);
    vi.spyOn(h.authority, "readDurableScoped").mockImplementationOnce(read).mockReturnValueOnce({ status: "unavailable" });
    const raw = JSON.stringify(journal());
    expect(repository.persist(raw, [])).toBe(false);
    await repository.settle();
    expect(repository.persist(raw, [])).toBe(true);
    expect(repository.snapshot()!.current).toBe(raw);
  });

  it.each([false, true])("can verify a formerly unreadable local write with IndexedDB unavailable and writes blocked=%s", async blockWrites => {
    const h = await fixture(), { repository } = await h.create();
    vi.spyOn(h.database, "put").mockRejectedValue(Error("unavailable"));
    const read = h.authority.readDurableScoped.bind(h.authority);
    vi.spyOn(h.authority, "readDurableScoped").mockImplementationOnce(read).mockReturnValueOnce({ status: "unavailable" });
    const raw = JSON.stringify(journal());
    expect(repository.persist(raw, [])).toBe(false);
    expect(await repository.settle()).toBe(false);
    h.local.failWrite = blockWrites;
    expect(repository.persist(raw, [])).toBe(true);
    expect(repository.snapshot()!.current).toBe(raw);
  });

  it("blocks synchronous session preparation as soon as another local client starts deleting its owner", async () => {
    const h = await fixture(), { repository } = await h.create(), start = journal();
    repository.persist(JSON.stringify(start), []); await repository.settle();
    const session = new ProgressSyncSession(JSON.stringify(start), appId, ownerId,
      { maySave: () => true, persist: repository.persist, requestId: () => "request" });
    const another = new ProgressJournalDatabase(h.factory); close.push(() => another.close());
    const deleting = another.deleteOwner(h.lease.ownerKey);
    expect(repository.persist(JSON.stringify(start), [])).toBe(false);
    expect(session.prepare({ ...start.live, settings: { ...start.live.settings, showGrid: true } })).toBeNull();
    await deleting;
    expect(repository.isDurable()).toBe(false);
  });

  it("permanently fences a duplicate writer after a database generation collision", async () => {
    const h = await fixture();
    h.local.failWrite = true;
    const a = (await h.create()).repository, b = (await h.create()).repository;
    const rawA = JSON.stringify(journal("writer", "a"));
    a.persist(rawA, []); await a.settle();
    const rowB = journal("writer", "b");
    b.persist(JSON.stringify(rowB), []); expect(await b.settle()).toBe(false);
    rowB.serial++; rowB.live.stats.totalDrawTime++;
    expect(b.persist(JSON.stringify(rowB), [])).toBe(false);
    expect(await b.settle()).toBe(false);
    expect(JSON.parse((await h.database.list(h.lease.ownerKey, 0))[0].raw).current).toBe(rawA);
  });

  it("keeps independent writers isolated and never replaces another writer's physical bytes", async () => {
    const h = await fixture(), a = (await h.create()).repository, b = (await h.create({ writerId: "second" })).repository;
    const rawA = JSON.stringify(journal()), rawB = JSON.stringify(journal("second", "second"));
    a.persist(rawA, []); b.persist(rawB, []); await Promise.all([a.settle(), b.settle()]);
    const physicalA = h.local.data.get(h.physical());
    const nextB = journal("second", "changed"); nextB.serial++;
    b.persist(JSON.stringify(nextB), [rawB]); await b.settle();
    expect(h.local.data.get(h.physical())).toBe(physicalA);
    expect((await a.recover()).copies).toHaveLength(2);
  });

  it.each(["different", null])("blocks an unexpected same-key replacement before writing either backend (%s)", async unexpected => {
    const h = await fixture(), { repository } = await h.create();
    const raw = JSON.stringify(journal()); repository.persist(raw, []); await repository.settle();
    const outer = JSON.parse(h.local.data.get(h.physical())!); outer.raw = unexpected;
    h.local.data.set(h.physical(), JSON.stringify(outer));
    const put = vi.spyOn(h.database, "put");
    expect(repository.persist(raw, [])).toBe(false); expect(await repository.settle()).toBe(false);
    expect(put).not.toHaveBeenCalled();
    expect(JSON.parse(h.local.data.get(h.physical())!).raw).toBe(unexpected);
  });

  it.each(["local", "database"])("does not silently reuse an unreadable %s writer", async backend => {
    const h = await fixture();
    if (backend === "local") h.local.data.set(h.physical(), "future or damaged envelope");
    else await h.database.put({ ownerKey: h.lease.ownerKey, appId, writerId: "writer", generation: 1, raw: "future" }, 0);
    await expect(h.create()).rejects.toThrow("new journal writer");
    const { recovery } = await h.create({ writerId: "fresh" });
    expect(recovery).toEqual({ copies: [], unavailable: true });
  });

  it("reports disagreeing same-generation backends and unreadable backend availability", async () => {
    const h = await fixture(), { repository } = await h.create();
    repository.persist(JSON.stringify(journal()), []); await repository.settle();
    const different = nextJournalEnvelope(null, JSON.stringify(journal("writer", "different")), [], { appId, ownerId, writerId: "writer" });
    h.authority.writeScoped(progressJournalKey(appId, "writer"), JSON.stringify(different));
    expect((await h.create({ writerId: "cold" })).recovery.unavailable).toBe(true);
    h.local.failRead = true;
    expect((await h.create({ writerId: "fresh" })).recovery.unavailable).toBe(true);
  });

  it("leaves foreign recovery metadata unreadable instead of applying its receipts", async () => {
    const h = await fixture(), { repository } = await h.create();
    repository.persist(JSON.stringify(journal()), []); await repository.settle();
    const envelope = repository.snapshot()!;
    envelope.recovery = { version: 1, adoptedSources: [], resolutions: [{
      sourceId: journalSourceId(`u_${"f".repeat(20)}`, appId, "other", "foreign"), revision: "b".repeat(64),
    }] };
    const raw = JSON.stringify(envelope);
    h.authority.writeScoped(progressJournalKey(appId, "writer"), raw);
    const recovery = (await h.create({ writerId: "cold" })).recovery;
    expect(recovery.unavailable).toBe(true);
    expect(recovery.copies[0].envelope.recovery!.resolutions).toEqual([]);
    const physical = h.authority.readDurableScoped(progressJournalKey(appId, "writer"));
    expect(physical).toEqual({ status: "durable", raw });
  });

  it("does not require IndexedDB availability for a physically verified local checkpoint", async () => {
    const h = await fixture();
    vi.spyOn(h.database, "ownerEpoch").mockRejectedValue(Error("unavailable"));
    vi.spyOn(h.database, "list").mockRejectedValue(Error("unavailable"));
    vi.spyOn(h.database, "put").mockRejectedValue(Error("unavailable"));
    const { repository, recovery } = await h.create();
    expect(recovery.unavailable).toBe(true);
    expect(repository.persist(JSON.stringify(journal()), [])).toBe(true);
    expect(await repository.settle()).toBe(true);
  });

  it("validates the fresh writer before touching storage", async () => {
    const h = await fixture(), epoch = vi.spyOn(h.database, "ownerEpoch");
    await expect(h.create({ writerId: "../wrong" })).rejects.toThrow("Invalid journal writer");
    expect(epoch).not.toHaveBeenCalled();
  });

  it("bounds redundant originals through 1000 unresolved-conflict timer updates", async () => {
    const h = await fixture(), { repository } = await h.create();
    const row = journal("writer", "picture");
    row.conflict = { remote: row.acknowledged, reason: "concurrent-edit", paths: [] };
    let raw = JSON.stringify(row);
    repository.persist(raw, []);
    for (let i = 0; i < 1000; i++) {
      const previous = raw; row.serial++; row.live.stats.totalDrawTime++;
      raw = JSON.stringify(row);
      expect(repository.persist(raw, [previous])).toBe(true);
    }
    await repository.settle();
    expect(repository.snapshot()!.originals).toEqual([]);
    expect(JSON.stringify(repository.snapshot()).length).toBeLessThan(raw.length * 1.3);
  });

  it("pins the user's conflict alternative until the chosen save is acknowledged", async () => {
    const h = await fixture(), { repository } = await h.create();
    const prior = journal("writer", "unique-original");
    prior.conflict = { remote: prior.acknowledged, reason: "concurrent-edit", paths: [] };
    const chosen = journal("writer", "chosen"); chosen.serial = prior.serial + 1; chosen.forceWrite = true;
    const original = JSON.stringify(prior);
    repository.persist(JSON.stringify(chosen), [original]); await repository.settle();
    await repository.drain();
    expect(repository.snapshot()!.originals).toEqual([{ raw: original, choice: true }]);
    expect(await h.words.listSources(h.lease.ownerKey)).toHaveLength(0);
    chosen.forceWrite = false; chosen.serial++;
    repository.persist(JSON.stringify(chosen), []); await repository.settle();
    const sourceId = (await repository.recover()).copies[0].sourceId;
    await repository.drain();
    expect(repository.snapshot()!.originals).toEqual([]);
    expect((await h.words.listSources(h.lease.ownerKey)).every(source => source.raw === original)).toBe(true);
    expect((await repository.recover()).copies[0].sourceId).toBe(sourceId);
  });

  it("refuses unknown originals and leaves the prior physical copy intact", async () => {
    const h = await fixture(), { repository } = await h.create();
    const original = JSON.stringify(journal("writer", "only-copy"));
    repository.persist(original, []); await repository.settle();
    const savedBytes = h.local.data.get(h.physical());
    expect(repository.persist(JSON.stringify(journal()), [JSON.stringify({ ...journal(), version: 999 })])).toBe(false);
    expect(h.local.data.get(h.physical())).toBe(savedBytes);
  });

  it("refuses to prune captures on disk if both replacement writes fail", async () => {
    const h = await fixture(), { repository } = await h.create();
    const original = JSON.stringify(journal("writer", "only-copy"));
    repository.persist(JSON.stringify(journal()), [original]); await repository.settle();
    const savedBytes = h.local.data.get(h.physical());
    h.local.failWrite = true;
    const put = vi.spyOn(h.database, "put").mockRejectedValue(Error("quota"));
    expect(await repository.drain()).toBe(false);
    expect(h.local.data.get(h.physical())).toBe(savedBytes);
    expect((await h.create({ writerId: "cold" })).recovery.copies[0].envelope.originals.map(item => item.raw)).toEqual([original]);
    put.mockRestore();
    expect(await repository.retry()).toBe(true);
    expect(repository.snapshot()!.originals).toEqual([]);
  });

  it("keeps capture receipts compact across distinct large image revisions", async () => {
    const h = await fixture(), { repository } = await h.create();
    let raw = JSON.stringify(journal("writer", "image-0", 70_000));
    repository.persist(raw, []); await repository.settle();
    for (let i = 1; i <= 20; i++) {
      const previous = raw; raw = JSON.stringify(journal("writer", `image-${i}`, 70_000));
      repository.persist(raw, [previous]); await repository.settle(); await repository.drain();
    }
    expect(repository.snapshot()!.originals).toEqual([]);
    const receipts = [...(repository as unknown as { captured: Set<string> }).captured];
    expect(receipts).toHaveLength(20);
    expect(receipts.reduce((bytes, receipt) => bytes + receipt.length, 0)).toBeLessThan(2_000);
    expect((await h.words.listSources(h.lease.ownerKey)).length).toBeGreaterThanOrEqual(20);
  });
});
