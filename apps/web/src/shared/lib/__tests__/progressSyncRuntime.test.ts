import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { cloneProgress, newProgressJournal } from "../progressJournal";
import { ProgressJournalDatabase } from "../progressJournalDatabase";
import { ProgressJournalRepository } from "../progressJournalRepository";
import { PROGRESS_BEACON_BYTES, ProgressSyncRuntime } from "../progressSyncRuntime";
import { ProgressSyncSession } from "../progressSyncSession";
import type { ProgressResponse, ProgressTransport, ProgressWrite } from "../progressSyncTransport";

const closes: Array<() => void> = [];
afterEach(() => closes.splice(0).forEach(close => close()));
const defaults = () => cloneProgress(useDrawingStore.getState().getProgress());
type Drawing = ReturnType<typeof defaults>;
const art = (id: string) => ({ id, name: id, dataUrl: id, thumbnail: id,
  createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" });
const painted = (id: string): Drawing => ({ ...defaults(), savedArtworks: [art(id)], lastModified: 10 });
const cloud = (data: Drawing | null, revision: string | null = "a".repeat(64)) => ({ data, revision });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(initial = defaults(), transport?: ProgressTransport<Drawing>) {
  const storage = new Map<string, string>();
  const local = { get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, raw: string) => { storage.set(key, raw); },
    removeItem: (key: string) => { storage.delete(key); } };
  const authority = createOwnerBoundProgress({ storage: () => local, sessionStorage: () => local });
  await authority.updateSession("authenticated", "owner");
  const lease = authority.captureLease()!, factory = new IDBFactory();
  const database = new ProgressJournalDatabase(factory), words = new LocalWordsDatabase(factory, "runtime-words");
  closes.push(() => { database.close(); words.close(); });
  const create = async (writerId: string) => (await ProgressJournalRepository.create({
    authority, lease, database, words, appId: "drawing-app", ownerId: "owner", writerId,
    maySave: () => authority.isCurrent(lease),
  })).repository;
  const repository = await create("mounted");
  let live = cloneProgress(initial);
  const applyLive = vi.fn((data: Drawing) => { live = cloneProgress(data); });
  const runtime = new ProgressSyncRuntime({ appId: "drawing-app", ownerId: "owner", ownerKey: lease.ownerKey,
    writerId: "mounted", repository, maySave: () => authority.isCurrent(lease), getLive: () => live, applyLive,
    transport, isUntouched: data => (data.savedArtworks ?? []).length === 0 && data.lastModified <= 0, requestId: () => "request" });
  const source = async (writer: string, data = initial) => {
    const repo = await create(writer);
    const row = newProgressJournal("drawing-app", "owner", writer, cloud(defaults()), data, true);
    repo.persist(JSON.stringify(row), []); await repo.settle();
    return repo;
  };
  return { runtime, repository, database, authority, local, source, create, applyLive, getLive: () => cloneProgress(live),
    edit: (data: Drawing) => { live = cloneProgress(data); } };
}

describe("shared progress runtime initialization", () => {
  it("adopts cloud only after preserving an untouched local copy durably", async () => {
    const h = await fixture();
    expect(await h.runtime.initialize(cloud(painted("cloud")))).toBe(true);
    expect(h.getLive()).toEqual(painted("cloud"));
    expect(h.repository.isDurable()).toBe(true);
    expect(h.runtime.snapshot()).toMatchObject({ phase: "ready", journal: { acknowledged: cloud(painted("cloud")), sent: null, conflict: null } });
  });

  it("retains unrelated touched local and cloud copies as an explicit conflict", async () => {
    const h = await fixture(painted("local"));
    expect(await h.runtime.initialize(cloud(painted("cloud")))).toBe(true);
    expect(h.getLive()).toEqual(painted("local"));
    expect(h.runtime.snapshot().journal!.conflict!.remote).toEqual(cloud(painted("cloud")));
  });

  it("distinguishes never-created absence from a deletion fence", async () => {
    for (const revision of [null, "a".repeat(64)]) {
      const h = await fixture(painted("local"));
      expect(await h.runtime.initialize({ data: null, revision })).toBe(true);
      expect(Boolean(h.runtime.snapshot().journal!.conflict)).toBe(revision !== null);
      expect(h.getLive()).toEqual(painted("local"));
    }
  });

  it("captures play made while a matching source archive waits before observing cloud", async () => {
    const h = await fixture(painted("old"));
    await h.source("original", painted("old"));
    const entered = deferred(), release = deferred(), archive = h.database.archive.bind(h.database);
    vi.spyOn(h.database, "archive").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return archive(...args);
    });
    const initializing = h.runtime.initialize(cloud(painted("old"), "b".repeat(64)));
    await entered.promise;
    h.edit({ ...painted("old"), savedArtworks: [art("old"), art("during-archive")] });
    release.resolve();
    expect(await initializing).toBe(true);
    expect(h.getLive().savedArtworks?.map(row => row.id)).toEqual(["old", "during-archive"]);
    expect(h.runtime.snapshot().journal!.live).toEqual(h.getLive());
    expect(h.repository.isDurable()).toBe(true);
  });

  it("retries the archived adoption ID when the original writer advances after checkpoint failure", async () => {
    const h = await fixture(painted("old"));
    const original = await h.source("original", painted("old"));
    const write = vi.spyOn(h.local, "setItem").mockImplementation(() => { throw Error("quota"); });
    const put = vi.spyOn(h.database, "put").mockRejectedValueOnce(Error("quota"));
    expect(await h.runtime.initialize(cloud(painted("old"), "b".repeat(64)))).toBe(false);
    expect(h.repository.snapshot()).not.toBeNull();
    write.mockRestore(); put.mockRestore();
    const newer = JSON.parse(original.snapshot()!.current);
    newer.serial++;
    original.persist(JSON.stringify(newer), []); await original.settle();
    expect(await h.runtime.initialize(cloud(painted("old"), "b".repeat(64)))).toBe(true);
    expect(h.runtime.snapshot().journal!.live).toEqual(painted("old"));
  });

  it("converts an adoption resolved elsewhere during storage failure into a preserved choice", async () => {
    const h = await fixture(painted("old"));
    await h.source("original", painted("old"));
    const write = vi.spyOn(h.local, "setItem").mockImplementation(() => { throw Error("quota"); });
    const put = vi.spyOn(h.database, "put").mockRejectedValueOnce(Error("quota"));
    expect(await h.runtime.initialize(cloud(painted("old"), "b".repeat(64)))).toBe(false);
    const sourceId = h.repository.snapshot()!.recovery!.adoptedSources[0];
    write.mockRestore(); put.mockRestore();
    const remote = await h.create("resolver");
    const raw = (await remote.adopt(sourceId))!;
    const resolver = new ProgressSyncSession<Drawing>(raw, "drawing-app", "owner", {
      maySave: () => true, persist: remote.persist, requestId: () => "resolver-request",
    });
    expect(resolver.observe(cloud(defaults()))).toBe("pending");
    const request = resolver.prepare(painted("old"))!;
    expect(resolver.receive(request.id, cloud(painted("old"), "b".repeat(64)), "accepted", painted("old"))).toBe("saved");
    expect(await remote.resolve([sourceId], remote.snapshot()!.current)).toBe(true);
    expect(await h.runtime.initialize(cloud(painted("old"), "b".repeat(64)))).toBe(true);
    expect(h.runtime.snapshot().journal!.conflict).not.toBeNull();
    expect(h.runtime.snapshot().journal!.sent).not.toBeNull();
    expect(h.getLive()).toEqual(painted("old"));
  });

  it("keeps malformed local progress intact and blocks adoption", async () => {
    const h = await fixture();
    h.edit({ ...painted("local"), unknownField: "preserve" } as Drawing);
    expect(await h.runtime.initialize(cloud(painted("cloud")))).toBe(false);
    expect(h.applyLive).not.toHaveBeenCalled();
    expect(h.getLive()).toMatchObject({ unknownField: "preserve" });
  });

  it("requires a choice for multiple independent pending copies even if one equals cloud", async () => {
    const h = await fixture(painted("one"));
    await h.source("one", painted("one")); await h.source("two", painted("two"));
    expect(await h.runtime.initialize(cloud(painted("one")))).toBe(true);
    expect(h.runtime.snapshot().copies).toHaveLength(2);
    expect(h.runtime.snapshot().journal!.conflict).not.toBeNull();
    expect(h.getLive()).toEqual(painted("one"));
  });

  it("blocks cloud adoption when either recovery inventory is unavailable", async () => {
    const h = await fixture();
    vi.spyOn(h.database, "list").mockRejectedValueOnce(Error("unavailable"));
    expect(await h.runtime.initialize(cloud(painted("cloud")))).toBe(false);
    expect(h.applyLive).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().phase).toBe("blocked");
    expect(await h.runtime.initialize(cloud(painted("cloud")))).toBe(true);
  });

  it("keeps edits made while the first cloud-adoption checkpoint waits for IndexedDB", async () => {
    const h = await fixture(), entered = deferred(), release = deferred();
    vi.spyOn(h.local, "setItem").mockImplementation(() => { throw Error("quota"); });
    const put = h.database.put.bind(h.database);
    vi.spyOn(h.database, "put").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return put(...args);
    });
    const initializing = h.runtime.initialize(cloud(painted("cloud")));
    await entered.promise; h.edit(painted("during-checkpoint")); release.resolve();
    // With only async storage, the conflict observation can need one more exact receipt retry.
    await initializing;
    await h.repository.settle();
    await h.runtime.initialize(cloud(painted("cloud")));
    expect(h.getLive()).toEqual(painted("during-checkpoint"));
    expect(h.runtime.snapshot().journal!.live).toEqual(h.getLive());
    expect(h.runtime.snapshot().journal!.conflict).not.toBeNull();
    expect(h.applyLive.mock.calls.every(([data]) => data.savedArtworks?.some(row => row.id === "during-checkpoint"))).toBe(true);
  });

  it("reveals and applies nothing after an owner change during recovery archival", async () => {
    const h = await fixture(painted("old")); await h.source("original", painted("old"));
    const entered = deferred(), release = deferred(), archive = h.database.archive.bind(h.database);
    vi.spyOn(h.database, "archive").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return archive(...args);
    });
    const initializing = h.runtime.initialize(cloud(painted("cloud")));
    await entered.promise; h.authority.revoke(); release.resolve();
    expect(await initializing).toBe(false);
    expect(h.applyLive).not.toHaveBeenCalled();
    expect(h.runtime.snapshot()).toEqual({ phase: "revoked", journal: null, copies: [] });
  });
});

function wire(initial = cloud(defaults())) {
  let canonical = cloneProgress(initial), serial = 10;
  const read = vi.fn(async (): Promise<ProgressResponse> => ({ status: 200, body: { protocol: 1, ...cloneProgress(canonical) } }));
  const write = vi.fn(async (payload: ProgressWrite<Drawing>): Promise<ProgressResponse> => {
    expect(payload.expectedOwnerId).toBe("owner");
    expect(payload.merge).toBe(true);
    if (payload.baseRevision !== canonical.revision) return { status: 409,
      body: { code: "revision_conflict", protocol: 1, ...cloneProgress(canonical) } };
    canonical = cloud(cloneProgress(payload.data), (++serial).toString(16).padStart(64, "0"));
    return { status: 200, body: { protocol: 1, ...cloneProgress(canonical) } };
  });
  const beacon = vi.fn((payload: string) => payload.length > 0);
  return { read, write, beacon, get: () => cloneProgress(canonical), set: (next: ReturnType<typeof cloud>) => { canonical = cloneProgress(next); } };
}
const changed = (data: Drawing, settings: object): Drawing => ({ ...cloneProgress(data),
  settings: { ...data.settings, ...settings }, lastModified: data.lastModified + 1 });

describe("shared progress network runtime", () => {
  it("sends a fresh initial save with explicit absence and owner, then reports the actual ACK", async () => {
    const network = wire({ data: null, revision: null });
    const h = await fixture(painted("first"), network);
    expect(await h.runtime.save()).toEqual({ ok: true, status: 200 });
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(network.write.mock.calls[0][0]).toMatchObject({ data: painted("first"), baseRevision: null, expectedOwnerId: "owner" });
    expect(h.runtime.status()).toBe("saved");
    expect(h.runtime.snapshot().journal!.acknowledged).toEqual(network.get());
  });

  it("captures changes during one HTTP request and leaves later play pending", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get());
    const entered = deferred(), release = deferred(), post = network.write.getMockImplementation()!;
    network.write.mockImplementationOnce(async body => { entered.resolve(); await release.promise; return post(body); });
    h.edit(changed(initial, { showGrid: true }));
    const first = h.runtime.save(); await entered.promise;
    h.edit(changed(h.getLive(), { soundEnabled: false }));
    const second = h.runtime.save();
    expect(second).toBe(first);
    expect(h.runtime.flush()).toBe("retained");
    expect(network.beacon).not.toHaveBeenCalled();
    release.resolve();
    expect(await first).toEqual({ ok: false, status: 200 });
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(h.getLive().settings.soundEnabled).toBe(false);
    expect(h.runtime.status()).toBe("pending");
    expect(await h.runtime.save()).toEqual({ ok: true, status: 200 });
    expect(network.get().data!.settings).toMatchObject({ showGrid: true, soundEnabled: false });
  });

  it("rebases a known rejected independent edit once, without an uncontrolled retry loop", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get());
    h.edit(changed(initial, { showGrid: true }));
    network.set(cloud(changed(initial, { soundEnabled: false }), "b".repeat(64)));
    expect(await h.runtime.save()).toEqual({ ok: false, status: 409 });
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(h.getLive().settings).toMatchObject({ showGrid: true, soundEnabled: false });
    expect(await h.runtime.save()).toEqual({ ok: true, status: 200 });
    expect(network.write.mock.calls[1][0].baseRevision).toBe("b".repeat(64));
  });

  it("recognizes a lost ACK through GET without replaying the accepted request", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); h.edit(changed(initial, { showGrid: true }));
    const post = network.write.getMockImplementation()!;
    network.write.mockImplementationOnce(async body => { await post(body); throw Error("lost response"); });
    expect((await h.runtime.save()).ok).toBe(false);
    expect(h.runtime.status()).toBe("network-error");
    expect(await h.runtime.save()).toEqual({ ok: true, status: null });
    expect(network.read).toHaveBeenCalledTimes(1);
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(h.runtime.snapshot().journal!.sent).toBeNull();
  });

  it("never replays a lost-ACK addition after another device deleted it", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get());
    h.edit({ ...initial, savedArtworks: [art("start"), art("deleted-later")] });
    const post = network.write.getMockImplementation()!;
    network.write.mockImplementationOnce(async body => { await post(body); throw Error("lost response"); });
    await h.runtime.save();
    network.set(cloud(initial, "c".repeat(64)));
    expect(await h.runtime.save()).toEqual({ ok: false, status: 409 });
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(h.runtime.status()).toBe("conflict");
    expect(h.getLive().savedArtworks).toHaveLength(2);
  });

  it.each([true, false, "throw"])("treats beacon result %s as uncertain and never saved", async outcome => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); h.edit(changed(initial, { showGrid: true }));
    network.beacon.mockImplementation(() => { if (outcome === "throw") throw Error("quota"); return outcome === true; });
    expect(h.runtime.flush()).toBe(outcome === true ? "queued" : "refused");
    expect(h.runtime.status()).toBe("pending");
    expect(h.runtime.snapshot().journal!.sent).not.toBeNull();
    expect(h.runtime.flush()).toBe("retained");
    expect(network.beacon).toHaveBeenCalledTimes(1);
    expect((await h.runtime.save()).ok).toBe(true);
    expect(network.read).toHaveBeenCalledTimes(1);
  });

  it("keeps an oversized unload pending and sends it through ordinary HTTP", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get());
    const large = { ...painted("large"), savedArtworks: [{ ...art("large"), dataUrl: "😀".repeat(PROGRESS_BEACON_BYTES) }] };
    h.edit(large);
    expect(h.runtime.flush()).toBe("retained");
    expect(network.beacon).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().journal!.sent).toBeNull();
    expect((await h.runtime.save()).ok).toBe(true);
    expect(network.get().data).toEqual(large);
  });

  it("waits for an exact asynchronous checkpoint before network dispatch", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); await h.repository.settle();
    const entered = deferred(), release = deferred(), put = h.database.put.bind(h.database);
    vi.spyOn(h.local, "setItem").mockImplementation(() => { throw Error("quota"); });
    vi.spyOn(h.database, "put").mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return put(...args); });
    h.edit(changed(initial, { showGrid: true }));
    const saving = h.runtime.save(); await entered.promise;
    expect(network.write).not.toHaveBeenCalled();
    release.resolve(); await saving; await h.repository.settle();
    // ACK persistence may itself require an async retry before the UI can claim saved.
    await h.runtime.save(); await h.repository.settle();
    expect(network.get().data!.settings.showGrid).toBe(true);
    expect(network.write).toHaveBeenCalledTimes(1);
  });

  it("ignores a late successful response after the mounted owner is revoked", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); h.edit(changed(initial, { showGrid: true }));
    h.applyLive.mockClear();
    const entered = deferred(), release = deferred(), post = network.write.getMockImplementation()!;
    network.write.mockImplementationOnce(async body => { entered.resolve(); await release.promise; return post(body); });
    const saving = h.runtime.save(); await entered.promise; h.authority.revoke(); release.resolve();
    expect((await saving).ok).toBe(false);
    expect(h.applyLive).not.toHaveBeenCalled();
    expect(h.runtime.status()).toBe("revoked");
  });

  it("revokes on owner_changed without adopting the current cookie owner's data", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); h.edit(changed(initial, { showGrid: true }));
    network.write.mockResolvedValueOnce({ status: 409, body: { code: "owner_changed" } });
    expect((await h.runtime.save()).ok).toBe(false);
    expect(h.runtime.snapshot()).toEqual({ phase: "revoked", journal: null, copies: [] });
  });

  it("keeps an invalid success response uncertain instead of acknowledging it", async () => {
    const initial = painted("start"), network = wire(cloud(initial)), h = await fixture(initial, network);
    await h.runtime.initialize(network.get()); h.edit(changed(initial, { showGrid: true }));
    network.write.mockResolvedValueOnce({ status: 200, body: { success: true } });
    expect((await h.runtime.save()).ok).toBe(false);
    expect(h.runtime.snapshot().journal!.sent).not.toBeNull();
    expect(h.runtime.status()).toBe("network-error");
  });
});

describe("explicit runtime recovery choices", () => {
  it("pins the unchosen numeric local copy before a lost choice acknowledgement", async () => {
    const local = { ...defaults(), lastModified: 1, settings: { ...defaults().settings, showGrid: true } };
    const remote = { ...defaults(), lastModified: 2, settings: { ...defaults().settings, soundEnabled: false } };
    const network = wire(cloud(remote)), h = await fixture(local, network);
    await h.runtime.initialize(network.get());
    network.write.mockRejectedValueOnce(Error("offline"));
    expect((await h.runtime.choose(h.runtime.choice()!, "server")).ok).toBe(false);
    expect(h.repository.snapshot()!.originals.some(original => original.choice
      && JSON.stringify(JSON.parse(original.raw).live) === JSON.stringify(local))).toBe(true);
  });

  it.each(["local", "server"] as const)("conditionally commits the exact %s choice", async selected => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.runtime.initialize(network.get());
    expect(await h.runtime.choose(h.runtime.choice()!, selected)).toEqual({ ok: true, status: 200 });
    expect(network.write).toHaveBeenCalledTimes(1);
    expect(network.write.mock.calls[0][0]).toMatchObject({ data: painted(selected === "local" ? "local" : "cloud"),
      baseRevision: "a".repeat(64), expectedOwnerId: "owner" });
    expect(h.runtime.status()).toBe("saved");
  });

  it("requires a new choice if the displayed local copy changes", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.runtime.initialize(network.get());
    const displayed = h.runtime.choice()!;
    h.edit(painted("newer"));
    expect((await h.runtime.choose(displayed, "server")).ok).toBe(false);
    expect(network.write).not.toHaveBeenCalled();
    expect(h.getLive()).toEqual(painted("newer"));
  });

  it("refreshes a changed cloud revision without committing an old choice", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.runtime.initialize(network.get());
    const displayed = h.runtime.choice()!;
    network.set(cloud(painted("new-cloud"), "b".repeat(64)));
    expect(await h.runtime.choose(displayed, "local")).toEqual({ ok: false, status: 409 });
    expect(network.write).not.toHaveBeenCalled();
    expect(h.runtime.choice()!.remote).toEqual(network.get());
    expect((await h.runtime.choose(h.runtime.choice()!, "local")).ok).toBe(true);
  });

  it("does not auto-rebase an explicit choice rejected by a later independent cloud edit", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.runtime.initialize(network.get());
    const post = network.write.getMockImplementation()!;
    network.write.mockImplementationOnce(async body => {
      network.set(cloud({ ...painted("cloud"), settings: { ...painted("cloud").settings, showGrid: true } }, "b".repeat(64)));
      return post(body);
    });
    expect(await h.runtime.choose(h.runtime.choice()!, "server")).toEqual({ ok: false, status: 409 });
    expect(h.runtime.status()).toBe("conflict");
    expect(network.write).toHaveBeenCalledTimes(1);
    expect((await h.runtime.save()).ok).toBe(false);
    expect(network.write).toHaveBeenCalledTimes(1);
  });

  it("starts fresh against a deletion fence only after an explicit validated choice", async () => {
    const network = wire(cloud(null)), h = await fixture(painted("local"), network);
    await h.runtime.initialize(network.get());
    expect((await h.runtime.choose(h.runtime.choice()!, "server")).ok).toBe(false);
    expect((await h.runtime.choose(h.runtime.choice()!, { empty: defaults() })).ok).toBe(true);
    expect(network.get().data).toEqual(defaults());
    expect(network.write.mock.calls[0][0].baseRevision).toBe("a".repeat(64));
  });

  it("archives every displayed recovery copy before selecting one alternative", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.source("first", painted("first")); await h.source("second", painted("second"));
    await h.runtime.initialize(network.get());
    const displayed = h.runtime.choice()!;
    const alternative = h.runtime.alternatives().find(copy => copy.data.savedArtworks?.[0]?.id === "second")!;
    expect((await h.runtime.choose(displayed, { alternativeId: alternative.id })).ok).toBe(true);
    expect(network.get().data).toEqual(painted("second"));
    expect(h.repository.snapshot()!.recovery!.resolutions.map(row => row.sourceId).sort())
      .toEqual(displayed.copies.map(copy => copy.sourceId).sort());
    expect(h.runtime.choice()).toBeNull();
  });

  it("refreshes a recovery copy that advances after display instead of wedging the choice", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    const source = await h.source("first", painted("first"));
    await h.runtime.initialize(network.get());
    const displayed = h.runtime.choice()!;
    const row = JSON.parse(source.snapshot()!.current); row.serial++; row.live = painted("new-first");
    source.persist(JSON.stringify(row), []); await source.settle();
    expect((await h.runtime.choose(displayed, "local")).ok).toBe(false);
    expect(network.write).not.toHaveBeenCalled();
    expect(h.runtime.choice()!.copies).not.toEqual(displayed.copies);
    expect(h.runtime.alternatives().some(copy => copy.data.savedArtworks?.[0]?.id === "new-first")).toBe(true);
    expect((await h.runtime.choose(h.runtime.choice()!, "local")).ok).toBe(true);
  });

  it("keeps edits made while source archival waits and requires a renewed choice", async () => {
    const network = wire(cloud(painted("cloud"))), h = await fixture(painted("local"), network);
    await h.source("first", painted("first")); await h.runtime.initialize(network.get());
    const entered = deferred(), release = deferred(), archive = h.database.archive.bind(h.database);
    vi.spyOn(h.database, "archive").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return archive(...args);
    });
    const choosing = h.runtime.choose(h.runtime.choice()!, "server"); await entered.promise;
    h.edit(painted("during-choice")); release.resolve();
    expect((await choosing).ok).toBe(false);
    expect(network.write).not.toHaveBeenCalled();
    expect(h.getLive()).toEqual(painted("during-choice"));
    expect((await h.runtime.choose(h.runtime.choice()!, "local")).ok).toBe(true);
    expect(network.get().data).toEqual(painted("during-choice"));
  });
});

describe("inherited operations resolved by another writer", () => {
  it("offers a preserved choice instead of retrying or wedging the old operation", async () => {
    const network = wire(cloud(defaults())), h = await fixture(painted("old"), network);
    await h.source("original", painted("old"));
    await h.runtime.initialize(network.get());
    const sourceId = h.repository.snapshot()!.recovery!.adoptedSources[0];
    const remote = await h.create("resolver"), raw = (await remote.adopt(sourceId))!;
    const resolver = new ProgressSyncSession<Drawing>(raw, "drawing-app", "owner", {
      maySave: () => true, persist: remote.persist, requestId: () => "resolver-request",
    });
    expect(resolver.observe(network.get())).toBe("pending");
    const request = resolver.prepare(painted("old"))!;
    network.set(cloud(painted("old"), "b".repeat(64)));
    expect(resolver.receive(request.id, network.get(), "accepted", painted("old"))).toBe("saved");
    expect(await remote.resolve([sourceId], remote.snapshot()!.current)).toBe(true);
    expect(await h.runtime.save()).toEqual({ ok: false, status: 409 });
    expect(h.runtime.choice()).not.toBeNull();
    expect(network.write).not.toHaveBeenCalled();
    expect((await h.runtime.choose(h.runtime.choice()!, "local")).ok).toBe(true);
    expect(h.runtime.status()).toBe("saved");
  });
});
