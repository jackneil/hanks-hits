import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { cloneProgress, newProgressJournal } from "../progressJournal";
import { ProgressJournalDatabase } from "../progressJournalDatabase";
import { ProgressJournalRepository } from "../progressJournalRepository";
import { ProgressSyncRuntime } from "../progressSyncRuntime";
import { ProgressSyncSession } from "../progressSyncSession";

const closes: Array<() => void> = [];
afterEach(() => closes.splice(0).forEach(close => close()));
const defaults = () => cloneProgress(useDrawingStore.getState().getProgress());
type Drawing = ReturnType<typeof defaults>;
const art = (id: string) => ({ id, name: id, dataUrl: id, thumbnail: id,
  createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" });
const painted = (id: string): Drawing => ({ ...defaults(), savedArtworks: [art(id)], lastModified: 10 });
const cloud = (data: Drawing | null, revision = "a".repeat(64)) => ({ data, revision });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(initial = defaults()) {
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
    isUntouched: data => (data.savedArtworks ?? []).length === 0 && data.lastModified <= 0, requestId: () => "request" });
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
