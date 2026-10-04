import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress, type OwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { useCookieSync } from "../lib/useCookieSync";
import { useCookieClickerStore } from "../lib/store";
import { bakeryJournalKey, BAKERY_JOURNAL_PREFIX, parseBakeryJournal, type BakeryJournal } from "../lib/sync-session";

const authority = vi.hoisted(() => ({ current: null as unknown as OwnerBoundProgress }));
vi.mock("@/lib/owner-bound-progress", async () => {
  const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress/core");
  authority.current = createOwnerBoundProgress();
  return {
    ownerBoundProgress: new Proxy({}, { get: (_target, key) => authority.current[key as keyof OwnerBoundProgress] }),
    createOwnerBoundStorage: (key: string, appId?: string) => authority.current.createStorage(key, appId),
    bindPersistedStore: (key: string, handle: Parameters<OwnerBoundProgress["bindPersistedStore"]>[1]) => authority.current.bindPersistedStore(key, handle),
  };
});
const revision = (n: number) => n.toString(16).padStart(64, "0");
const base = useCookieClickerStore.getState().getProgress();
const bakery = (cookies = 1000) => ({ ...base, cookies, totalCookiesBaked: 5000, lastModified: 100, lastTick: 100 });
const cloud = (cookies = 1000, n = 1) => ({ data: bakery(cookies), revision: revision(n) });
const context = () => ({ ownerId: "owner-a", canonical: { ...cloud(), protocol: 1, lastSyncedAt: null }, live: bakery(1100), maySave: () => true });
function journal(ownerId = "owner-a", writerId = "legacy-a"): BakeryJournal {
  return { version: 1, ownerId, writerId, serial: 7, acknowledged: cloud(), sent: null,
    live: bakery(1100), conflict: null, resolving: false, choiceBackup: null };
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  authority.current = createOwnerBoundProgress();
  await authority.current.updateSession("authenticated", "owner-a");
  useCookieClickerStore.setState(bakery(1100));
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => cloud(1100, 2) }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => true) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Cookie journals use the captured owner namespace", () => {
  it("offers the guest wallet as an explicit choice and acknowledges its exact source only after conditional save", async () => {
    const progressKey = "cookie-clicker-storage";
    authority.current.writeScoped(progressKey, JSON.stringify({ state: bakery(1100), version: 0 }));
    const guest = createOwnerBoundProgress(); await guest.updateSession("unauthenticated");
    guest.writeScoped(progressKey, JSON.stringify({ state: bakery(500), version: 0 }));
    expect(guest.prepareGuestHandoff()).toBe(true);
    const proof = guest.getGuestHandoffProof()!;
    authority.current = createOwnerBoundProgress();
    authority.current.authorizeGuestHandoff(proof);
    await authority.current.updateSession("authenticated", "owner-a");
    const id = authority.current.readGuestCandidate(progressKey)!.id;
    // This test's singleton store was constructed in another synthetic document.
    // Mirror its real adapter's synchronous owner-bound persistence for this page.
    const stop = useCookieClickerStore.subscribe(() => {
      authority.current.writeScoped(progressKey, JSON.stringify({ state: useCookieClickerStore.getState().getProgress(), version: 0 }));
    });
    try {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => cloud(500, 2) });
      const view = renderHook(() => useCookieSync());
      await act(async () => { expect(view.result.current.continuation.recover(context())).toBe(true); });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(view.result.current.view.choices).toEqual([expect.objectContaining({ label: "Guest bakery from sign-in", data: expect.objectContaining({ cookies: 500 }) })]);
      expect(useCookieClickerStore.getState().getProgress().cookies).toBe(1100);
      await act(async () => { await view.result.current.choose(view.result.current.view.conflict!, 0); });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toMatchObject({ expectedOwnerId: "owner-a", baseRevision: revision(1), data: { cookies: 500 } });
      expect(authority.current.readGuestCandidate(progressKey)).toBeNull();
      const key = authority.current.listScoped(BAKERY_JOURNAL_PREFIX)[0];
      const saved = parseBakeryJournal(authority.current.readScoped(key)!, "owner-a")!;
      expect(saved.guestCandidateIds).toEqual([id]);
      expect(saved.sent).toBeNull();
      view.unmount();
      for (let reload = 0; reload < 2; reload++) {
        authority.current = createOwnerBoundProgress();
        await authority.current.updateSession("authenticated", "owner-a");
        const next = renderHook(() => useCookieSync());
        await act(async () => {
          expect(next.result.current.continuation.recover({ ...context(), live: bakery(500),
            canonical: { ...cloud(500, 2), protocol: 1, lastSyncedAt: null } })).toBe(false);
        });
        expect(next.result.current.view.conflict).toBeNull();
        expect(next.result.current.view.choices).toEqual([]);
        expect(authority.current.listScoped(BAKERY_JOURNAL_PREFIX)).toHaveLength(1);
        next.unmount();
      }
    } finally { stop(); }
  });

  it("retains the guest source when the chosen wallet has a cloud ACK but its local write fails", async () => {
    const progressKey = "cookie-clicker-storage";
    authority.current.writeScoped(progressKey, JSON.stringify({ state: bakery(1100), version: 0 }));
    const guest = createOwnerBoundProgress(); await guest.updateSession("unauthenticated");
    guest.writeScoped(progressKey, JSON.stringify({ state: bakery(500), version: 0 }));
    guest.prepareGuestHandoff();
    const proof = guest.getGuestHandoffProof()!;
    authority.current = createOwnerBoundProgress();
    authority.current.authorizeGuestHandoff(proof);
    await authority.current.updateSession("authenticated", "owner-a");
    const id = authority.current.readGuestCandidate(progressKey)!.id;
    const write = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith("hh-progress:v2:") && key.includes(progressKey)) throw new DOMException("full", "QuotaExceededError");
      write(key, value);
    });
    const stop = useCookieClickerStore.subscribe(() => {
      authority.current.writeScoped(progressKey, JSON.stringify({ state: useCookieClickerStore.getState().getProgress(), version: 0 }));
    });
    try {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => cloud(500, 2) });
      const view = renderHook(() => useCookieSync());
      await act(async () => { view.result.current.continuation.recover(context()); });
      await act(async () => { await view.result.current.choose(view.result.current.view.conflict!, 0); });
      expect(authority.current.readGuestCandidate(progressKey)?.id).toBe(id);
      expect(authority.current.getSnapshot().memoryOnly).toBe(true);
      expect(useCookieClickerStore.getState().getProgress().cookies).toBe(500);
    } finally { stop(); }
  });

  it("recovers matching legacy originals, writes only scoped copies, and preserves exact retirement receipts", async () => {
    const originalKey = bakeryJournalKey("legacy-a"), original = JSON.stringify(journal());
    localStorage.setItem(originalKey, original);
    localStorage.setItem(bakeryJournalKey("foreign"), JSON.stringify(journal("owner-b", "foreign")));
    const view = renderHook(() => useCookieSync());
    await act(async () => { expect(view.result.current.continuation.recover(context())).toBe(true); });
    await act(async () => { expect(await view.result.current.continuation.save(bakery(1100))).toEqual({ ok: true, status: 200 }); });
    expect(localStorage.getItem(originalKey)).toBe(original);
    const scoped = authority.current.listScoped(BAKERY_JOURNAL_PREFIX);
    expect(scoped).toHaveLength(1);
    const saved = parseBakeryJournal(authority.current.readScoped(scoped[0])!, "owner-a")!;
    expect(saved.writerId).not.toBe("legacy-a");
    expect(saved.resolvedCopies).toContainEqual([originalKey, 7]);
    expect(saved.acknowledged.revision).toBe(revision(2));
    expect(saved.sent).toBeNull();
    expect(localStorage.getItem(scoped[0])).toBeNull();
  });

  it("revokes on owner_changed but preserves ordinary revision-conflict recovery", async () => {
    const view = renderHook(() => useCookieSync());
    await act(async () => { view.result.current.continuation.begin(context(), true); });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => cloud(900, 3) });
    await act(async () => { await view.result.current.continuation.save(bakery(1100)); });
    expect(authority.current.getSnapshot().status).toBe("ready");
    expect(view.result.current.view.conflict).not.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "owner_changed" }) });
    await act(async () => { await view.result.current.choose(view.result.current.view.conflict!, "local"); });
    expect(authority.current.getSnapshot().status).toBe("revoked");
    const count = fetchMock.mock.calls.length;
    await act(async () => { await view.result.current.continuation.save(bakery(1200)); });
    view.result.current.continuation.flush(bakery(1200));
    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("never offers another account's legacy journal", async () => {
    localStorage.setItem(bakeryJournalKey("foreign"), JSON.stringify(journal("owner-b", "foreign")));
    const view = renderHook(() => useCookieSync());
    await act(async () => { expect(view.result.current.continuation.recover(context())).toBe(false); });
    expect(view.result.current.view.choices).toEqual([]);
    expect(authority.current.listScoped(BAKERY_JOURNAL_PREFIX)).toEqual([]);
  });

  it("rejects a late ACK and future flushes after the captured lease is revoked", async () => {
    const view = renderHook(() => useCookieSync());
    await act(async () => { view.result.current.continuation.begin(context(), true); });
    let respond!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    let pending!: ReturnType<typeof view.result.current.continuation.save>;
    await act(async () => { pending = view.result.current.continuation.save(bakery(1100)); });
    const keys = authority.current.listScoped(BAKERY_JOURNAL_PREFIX);
    const before = authority.current.readScoped(keys[0]);
    authority.current.revoke();
    await act(async () => {
      respond({ ok: true, status: 200, json: async () => cloud(1, 2) });
      expect((await pending).ok).toBe(false);
    });
    view.result.current.continuation.flush(bakery(1200));
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
    const reload = createOwnerBoundProgress(); await reload.updateSession("authenticated", "owner-a");
    expect(reload.readScoped(keys[0])).toBe(before);
    expect(useCookieClickerStore.getState().getProgress().cookies).toBe(1100);
  });

  it("reports real journal storage failure while retaining the in-memory bakery", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    const view = renderHook(() => useCookieSync());
    await act(async () => { view.result.current.continuation.begin(context(), true); });
    expect(view.result.current.view.storageAvailable).toBe(false);
    const scoped = authority.current.listScoped(BAKERY_JOURNAL_PREFIX);
    expect(scoped).toHaveLength(1);
    expect(parseBakeryJournal(authority.current.readScoped(scoped[0])!, "owner-a")!.live.cookies).toBe(1100);
  });
});
