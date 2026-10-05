import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { createOwnerBoundProgress, GUEST_CANDIDATE_PREFIX } from "@/lib/owner-bound-progress/core";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import { PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress/keys";
import { cloneProgress, parseProgressJournal } from "../progressJournal";
import { ProgressJournalDatabase } from "../progressJournalDatabase";
import { ProgressJournalRepository } from "../progressJournalRepository";
import { ProgressSyncRuntime } from "../progressSyncRuntime";
import { acknowledgeResolvedGuests, inventoryGuestJournals } from "../guestProgressRecovery";

const closes: Array<() => void> = [];
afterEach(() => { closes.splice(0).forEach(close => close()); vi.restoreAllMocks(); });
const bakery = (cookies = 1000) => cloneProgress({ ...useCookieClickerStore.getState().getProgress(), cookies,
  totalCookiesBaked: 5000, lastModified: 100, lastTick: 100 });
const drum = () => ({ ...cloneProgress(useDrumMachineStore.getState().getProgress()),
  savedBeats: [{ id: "beat", name: "Private song", bpm: 80, kitId: "standard", pattern: {}, createdAt: "2026-01-01" }], lastModified: 100 });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(appId: "cookie-clicker" | "drum-machine" = "cookie-clicker", raw?: string) {
  const key = PROGRESS_STORAGE_KEYS[appId], bytes = new Map<string, string>();
  const local = { get length() { return bytes.size; }, key: (i: number) => [...bytes.keys()][i] ?? null,
    getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, raw: string) => { bytes.set(key, raw); },
    removeItem: (key: string) => { bytes.delete(key); } };
  const factory = () => createOwnerBoundProgress({ storage: () => local, sessionStorage: () => local, now: () => 200 });
  const guest = factory(); await guest.updateSession("unauthenticated");
  const original = raw ?? JSON.stringify({ state: appId === "cookie-clicker" ? bakery() : { progress: drum() }, version: 0 }, null, 2);
  guest.writeScoped(key, original); expect(guest.prepareGuestHandoff()).toBe(true);
  const authority = factory(); authority.authorizeGuestHandoff(guest.getGuestHandoffProof()!);
  await authority.updateSession("authenticated", "owner");
  const lease = authority.captureLease()!, idb = new IDBFactory();
  const words = new LocalWordsDatabase(idb, "guest-words"), database = new ProgressJournalDatabase(idb);
  closes.push(() => { words.close(); database.close(); });
  const io = { authority, lease, appId, ownerId: "owner", words };
  const inventory = () => inventoryGuestJournals(io);
  const create = (writerId: string) => ProgressJournalRepository.create({ ...io, database, writerId,
    maySave: () => authority.isCurrent(lease), additionalRecovery: inventory });
  const store = createStore<{ progress: ReturnType<typeof bakery> }>()(persist(() => ({ progress: bakery(10) }), {
    name: key, storage: createJSONStorage(() => authority.createStorage(key, appId)), skipHydration: true,
    // Actual game getters own serialization; this fixture keeps the Cookie contract.
    partialize: state => state.progress,
    merge: (saved, current) => ({ ...current, progress: saved as ReturnType<typeof bakery> }),
  }));
  authority.bindPersistedStore(key, store.persist, () => { store.setState({}); });
  await authority.whenHydrated(key);
  let canonical = { data: bakery(900), revision: "a".repeat(64) }, serial = 20;
  const write = vi.fn(async (body: { data: ReturnType<typeof bakery>; baseRevision: string | null }) => {
    if (body.baseRevision !== canonical.revision) return { status: 409, body: { protocol: 1, code: "revision_conflict", ...canonical } };
    canonical = { data: cloneProgress(body.data), revision: (++serial).toString(16).padStart(64, "0") };
    return { status: 200, body: { protocol: 1, ...canonical } };
  });
  const runtime = async (writerId: string) => {
    const { repository } = await create(writerId);
    const sync = new ProgressSyncRuntime({ appId, ownerId: "owner", ownerKey: lease.ownerKey, writerId, repository,
      maySave: () => authority.isCurrent(lease), getLive: () => store.getState().progress,
      applyLive: data => store.setState({ progress: cloneProgress(data) }), isUntouched: () => false,
      requestId: () => crypto.randomUUID(), transport: { read: async () => ({ status: 200, body: { protocol: 1, ...canonical } }), write } });
    return { sync, repository };
  };
  return { ...io, bytes, local, factory, original, key, inventory, create, runtime, store, write, database, canonical: () => canonical };
}

describe("guest progress recovery barrier", () => {
  it("preserves original guest bytes and words before returning a projected generic conflict", async () => {
    const h = await fixture("drum-machine"), result = await h.inventory();
    expect(result.unavailable).toBe(false); expect(result.copies).toHaveLength(1);
    const row = parseProgressJournal(result.copies[0].envelope.current, h.appId, h.ownerId)!;
    expect(row.imported).toMatchObject({ kind: "guest-v2", raw: h.original });
    expect(JSON.stringify(row.live)).not.toContain("Private song");
    expect(row.conflict?.reason).toBe("unknown-lineage");
    const sources = await h.words.listSources("guest");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ raw: h.original, fields: [{ path: "savedBeats[0].name", value: "Private song" }] });
    expect(sources[0].id).toBe(JSON.stringify(["guest", h.appId, sources[0].sourceKey, sources[0].sourceVersion, sources[0].digest]));
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    expect(await h.inventory()).toEqual(result);
    expect(await h.words.listSources("guest")).toHaveLength(1);
  });

  it("does not expose a copy while original capture is pending or failed", async () => {
    const h = await fixture(), barrier = deferred(), originalCapture = h.words.capture.bind(h.words);
    let entered = false;
    const capture = vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      entered = true; await barrier.promise; return originalCapture(...args);
    });
    let settled = false; const pending = h.inventory().then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(entered).toBe(true)); expect(settled).toBe(false);
    barrier.resolve(); expect((await pending).copies).toHaveLength(1);
    capture.mockRejectedValueOnce(Error("quota"));
    expect(await h.inventory()).toEqual({ copies: [], unavailable: true });
    expect(h.authority.listGuestCandidates(h.key)).toHaveLength(1);
  });

  it.each(["changed", "revoked"])("refuses recovery when a source is %s during durable capture", async action => {
    const h = await fixture(), capture = h.words.capture.bind(h.words);
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await capture(...args);
      if (action === "revoked") h.authority.revoke();
      else {
        const name = [...h.bytes.keys()].find(key => key.startsWith(GUEST_CANDIDATE_PREFIX))!;
        const value = JSON.parse(h.bytes.get(name)!); value.raw += " "; h.bytes.set(name, JSON.stringify(value));
      }
    });
    expect(await h.inventory()).toEqual({ copies: [], unavailable: true });
    expect((await h.words.listSources("guest"))[0].raw).toBe(h.original);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("preserves malformed originals as opaque sources without offering a lossy choice", async () => {
    const h = await fixture("cookie-clicker", "unreadable original");
    expect(await h.inventory()).toEqual({ copies: [], unavailable: true });
    expect(await h.words.listSources("guest")).toEqual([expect.objectContaining({ raw: h.original, fields: [] })]);
  });

  it("retains future save formats without interpreting them as current playable progress", async () => {
    const h = await fixture("cookie-clicker", JSON.stringify({ version: 99, state: bakery() }));
    expect(await h.inventory()).toEqual({ copies: [], unavailable: true });
    expect((await h.words.listSources("guest"))[0].raw).toBe(h.original);
  });

  it("rejects altered embedded guest identity instead of accepting a borrowed source receipt", async () => {
    const h = await fixture(), result = await h.inventory();
    const row = JSON.parse(result.copies[0].envelope.current);
    expect(parseProgressJournal(JSON.stringify(row), h.appId, h.ownerId)).not.toBeNull();
    for (const patch of [{ raw: row.imported.raw + " " }, { candidateId: "borrowed" }, { sourceKey: "other-storage" }, { loadAt: 400 }]) {
      expect(parseProgressJournal(JSON.stringify({ ...row, imported: { ...row.imported, ...patch } }), h.appId, h.ownerId)).toBeNull();
    }
  });

  it.each(["guest", "account"])("respects the %s deletion fence", async scope => {
    const h = await fixture();
    await h.words.deleteOwner(scope === "guest" ? "guest" : h.lease.ownerKey);
    expect(await h.inventory()).toEqual({ copies: [], unavailable: true });
    expect(h.authority.listGuestCandidates(h.key)).toHaveLength(1);
  });

  it("requires a conditional choice receipt and durable actual store before acknowledging an exact guest", async () => {
    const h = await fixture(), { sync, repository } = await h.runtime("mounted");
    expect(await sync.initialize(h.canonical())).toBe(true);
    expect(sync.status()).toBe("conflict");
    expect(await acknowledgeResolvedGuests({ ...h, repository })).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
    const token = sync.choice()!;
    expect(await sync.choose(token, "server")).toEqual({ ok: true, status: 200 });
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write.mock.calls[0][0]).toMatchObject({ resolution: true, baseRevision: "a".repeat(64) });
    const flush = vi.spyOn(h.authority, "flushStore").mockReturnValueOnce(false);
    expect(await acknowledgeResolvedGuests({ ...h, repository })).toBe(false);
    expect(h.authority.listGuestCandidates(h.key)).toHaveLength(1);
    flush.mockRestore();
    expect(await acknowledgeResolvedGuests({ ...h, repository })).toBe(true);
    expect(h.authority.listGuestCandidates(h.key)).toHaveLength(0);
    expect(h.write).toHaveBeenCalledTimes(1);
    const saved = [...h.bytes].find(([key]) => key.startsWith(GUEST_CANDIDATE_PREFIX))!;
    expect(JSON.parse(saved[1])).toMatchObject({ acknowledged: true, raw: h.original });
    expect(await acknowledgeResolvedGuests({ ...h, repository })).toBe(true);
  });

  it("retries failed guest acknowledgement after cold recovery without another choice or POST", async () => {
    const h = await fixture(), { sync, repository } = await h.runtime("first");
    await sync.initialize(h.canonical()); await sync.choose(sync.choice()!, "local");
    const ack = vi.spyOn(h.authority, "acknowledgeGuestCandidate").mockReturnValueOnce(false);
    expect(await acknowledgeResolvedGuests({ ...h, repository })).toBe(false); ack.mockRestore();
    const authority = h.factory(); await authority.updateSession("authenticated", "owner");
    const lease = authority.captureLease()!;
    const store = createStore<{ progress: ReturnType<typeof bakery> }>()(persist(() => ({ progress: bakery() }), {
      name: h.key, storage: createJSONStorage(() => authority.createStorage(h.key)), skipHydration: true,
      partialize: state => state.progress, merge: (saved, current) => ({ ...current, progress: saved as ReturnType<typeof bakery> }),
    }));
    authority.bindPersistedStore(h.key, store.persist, () => { store.setState({}); }); await authority.whenHydrated(h.key);
    const io = { ...h, authority, lease };
    const { repository: next } = await ProgressJournalRepository.create({ ...io,
      database: h.database,
      writerId: "cold", maySave: () => authority.isCurrent(lease), additionalRecovery: () => inventoryGuestJournals(io) });
    expect(await acknowledgeResolvedGuests({ ...io, repository: next })).toBe(true);
    expect(authority.listGuestCandidates(h.key)).toHaveLength(0); expect(h.write).toHaveBeenCalledTimes(1);
  });
});
