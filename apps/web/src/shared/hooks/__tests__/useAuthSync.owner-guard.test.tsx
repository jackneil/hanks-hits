import { IDBFactory } from "fake-indexeddb";
import { setTimeout as realDelay } from "node:timers/promises";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { ProgressSessionBoundary } from "@/shared/components/AuthProvider";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import "@/games/snake/lib/store"; // Register Snake's real persisted-state projection.
import { createJSONStorage, persist } from "zustand/middleware";
import { PROGRESS_OWNER_KEY, SIGNOUT_BROADCAST_KEY } from "@/lib/storage-keys";
import { createOwnerBoundProgress, type OwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";
import { createProgressServer } from "@/__tests__/fake-progress-server";

const auth = vi.hoisted(() => ({ status: "authenticated", data: { user: { id: "user-B" } } }));
const authority = vi.hoisted(() => ({ current: null as unknown as OwnerBoundProgress }));
vi.mock("next-auth/react", () => ({ useSession: () => auth, getSession: async () => auth.data }));
vi.mock("next/navigation", () => ({ usePathname: () => "/login" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/owner-bound-progress", async () => {
  const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress/core");
  authority.current = createOwnerBoundProgress();
  return {
    PROGRESS_STORAGE_KEYS: (await import("@/lib/owner-bound-progress/keys")).PROGRESS_STORAGE_KEYS,
    ownerBoundProgress: new Proxy({}, { get: (_target, key) => authority.current[key as keyof OwnerBoundProgress] }),
    createOwnerBoundStorage: (key: string, appId?: string) => authority.current.createStorage(key, appId),
    bindPersistedStore: (key: string, handle: Parameters<OwnerBoundProgress["bindPersistedStore"]>[1]) => authority.current.bindPersistedStore(key, handle),
  };
});

const key = "snake-game-state";
type Progress = { highScore: number; gamesPlayed: number; totalFoodEaten: number; longestSnake: number; lastModified: number };
const defaults: Progress = { highScore: 0, gamesPlayed: 0, totalFoodEaten: 0, longestSnake: 0, lastModified: 0 };
const played = (highScore = 77): Progress => ({ highScore, gamesPlayed: 1, totalFoodEaten: 10, longestSnake: 10, lastModified: 100 });
const raw = (value: Progress) => JSON.stringify({ state: { progress: value, progressTimeV: 1 }, version: 0 });
const settle = async () => { await act(async () => { for (let i = 0; i < 5; i++) { await realDelay(10); await vi.advanceTimersByTimeAsync(100); } }); };
let fetchSpy: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;

function store() {
  const runtime = authority.current;
  const state = create(persist(() => ({ progress: { ...defaults } }), {
    name: key, storage: createJSONStorage(() => runtime.createStorage(key, "snake")), skipHydration: true,
  }));
  runtime.bindPersistedStore(key, state.persist, () => state.setState({}));
  return state;
}
function mount(state: ReturnType<typeof store>) {
  return renderHook(() => useAuthSync<Progress>({ appId: "snake", localStorageKey: key,
    getState: () => state.getState().progress, setState: progress => state.setState({ progress }), debounceMs: 10 }));
}
async function confirm() {
  await authority.current.updateSession("authenticated", auth.data.user.id);
  await authority.current.whenHydrated(key);
}

async function seedHandoff(account: Progress, guest: Progress) {
  const existing = createOwnerBoundProgress(); await existing.updateSession("authenticated", "user-B");
  existing.writeScoped(key, raw(account));
  const visitor = createOwnerBoundProgress(); await visitor.updateSession("unauthenticated");
  visitor.writeScoped(key, raw(guest));
  visitor.writeScoped("flappy-bird-progress", raw(guest));
  expect(visitor.prepareGuestHandoff()).toBe(true);
  const proof = visitor.getGuestHandoffProof()!;
  authority.current = createOwnerBoundProgress();
  authority.current.authorizeGuestHandoff(proof);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear(); sessionStorage.clear();
  auth.status = "authenticated"; auth.data = { user: { id: "user-B" } };
  authority.current = createOwnerBoundProgress();
  __unsafeResetForeignPurgeLockForTests();
  fetchSpy = vi.fn(createProgressServer({ current: auth }).fetch);
  vi.stubGlobal("fetch", fetchSpy);
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
});
afterEach(async () => { cleanup(); await realDelay(30); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useAuthSync with the real owner storage authority", () => {
  it("retains guest, account-device and cloud saves until the player chooses one exact source", async () => {
    await seedHandoff({ ...played(80), gamesPlayed: 5, lastModified: 300 }, { ...played(100), lastModified: 200 });
    const server = createProgressServer({ current: auth });
    server.rows.set("user-B:snake", { data: { ...played(50), gamesPlayed: 3, lastModified: 500 }, updatedAt: new Date(500) });
    fetchSpy.mockImplementation(server.fetch);
    const state = store(); await confirm();
    const originalCandidate = authority.current.readGuestCandidate(key)!;
    mount(state); await settle();
    expect(server.posts).toEqual([]);
    expect(authority.current.readGuestCandidate(key)).toEqual(originalCandidate);
    const dialog = progressSyncPresentation.getSnapshot().find(row => row.appId === "snake")!.open()!;
    expect(dialog.options.map(option => option.data.highScore)).toEqual(expect.arrayContaining([80, 50, 100]));
    const guest = dialog.options.find(option => option.data.highScore === 100)!;
    await act(async () => { expect(await dialog.choose(guest.id)).toMatchObject({ ok: true }); });
    expect(server.rejected).toEqual([]);
    expect(server.row("snake", "user-B")).toEqual({ ...played(100), lastModified: 200 });
    expect(state.getState().progress.highScore).toBe(100);
    expect(authority.current.readGuestCandidate(key)).toBeNull();
    const reload = createOwnerBoundProgress(); await reload.updateSession("authenticated", "user-B");
    expect(reload.readGuestCandidate(key)).toBeNull();
    expect(reload.readGuestCandidate("flappy-bird-progress")).not.toBeNull();
  });

  it("retains a guest after a failed explicit choice and acknowledges it only after retry commits", async () => {
    await seedHandoff({ ...played(80), lastModified: 300 }, { ...played(100), lastModified: 200 });
    const server = createProgressServer({ current: auth }); fetchSpy.mockImplementation(server.fetch);
    server.rows.set("user-B:snake", { data: played(80), updatedAt: new Date(300) });
    const state = store(); await confirm();
    const view = mount(state);
    await act(async () => { await view.result.current.forceSync(); });
    await settle();
    const candidate = authority.current.readGuestCandidate(key)!;
    expect(server.posts).toEqual([]);
    const dialog = progressSyncPresentation.getSnapshot().find(row => row.appId === "snake")!.open()!;
    const guest = dialog.options.find(option => option.data.highScore === 100)!;
    server.net.postStatus = 503;
    await act(async () => { expect(await dialog.choose(guest.id)).toMatchObject({ ok: false, status: 503 }); });
    expect(authority.current.readGuestCandidate(key)).toEqual(candidate);
    expect(server.row("snake", "user-B")).toEqual(played(80));
    server.net.postStatus = 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); await settle();
    expect(progressSyncPresentation.getSnapshot()[0]?.status, JSON.stringify({ posts: server.posts, gets: server.gets })).toBe("saved");
    expect({ row: server.row("snake", "user-B"), status: progressSyncPresentation.getSnapshot()[0]?.status, posts: server.posts, gets: server.gets }).toMatchObject({ row: { ...played(100), lastModified: 200 } });
    expect(authority.current.readGuestCandidate(key)).toBeNull();
  });

  it("preserves an untouched guest candidate without uploading or claiming it was resolved", async () => {
    const guest = createOwnerBoundProgress(); await guest.updateSession("unauthenticated");
    guest.writeScoped(key, raw(defaults)); guest.prepareGuestHandoff();
    const proof = guest.getGuestHandoffProof()!;
    authority.current = createOwnerBoundProgress(); authority.current.authorizeGuestHandoff(proof);
    const state = store(); await confirm();
    const candidate = authority.current.readGuestCandidate(key);
    const view = mount(state);
    await act(async () => { await view.result.current.forceSync(); });
    await settle();
    expect(view.result.current.ready).toBe(true);
    expect(authority.current.readGuestCandidate(key)).toEqual(candidate);
    expect(state.getState().progress).toEqual(defaults);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    expect(progressSyncPresentation.getSnapshot().find(row => row.appId === "snake")?.status).toBe("conflict");
  });

  it.each(["GET", "POST"])("revokes on an authoritative %s owner_changed refusal without uploading again", async method => {
    localStorage.setItem(key, raw(played()));
    const state = store(); await confirm();
    const normal = fetchSpy.getMockImplementation() as (url: unknown, init?: RequestInit) => Promise<unknown>;
    fetchSpy.mockImplementation(async (url, init) => (init?.method ?? "GET") === method
      ? { ok: false, status: 409, json: async () => ({ code: "owner_changed" }) }
      : normal(url, init));
    const view = mount(state); await settle();
    expect(authority.current.getSnapshot().status).toBe("revoked");
    expect(view.result.current.ready).toBe(false);
    const count = fetchSpy.mock.calls.length;
    await act(async () => { await view.result.current.forceSync(); });
    window.dispatchEvent(new Event("beforeunload"));
    expect(fetchSpy).toHaveBeenCalledTimes(count);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("quarantines foreign legacy progress without changing the original or its marker", async () => {
    const original = raw(played());
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-A"); localStorage.setItem(key, original);
    const state = store(); await confirm();
    const view = mount(state); await settle();
    expect(state.getState().progress).toEqual(defaults);
    expect(view.result.current.ready).toBe(true);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    expect(localStorage.getItem(key)).toBe(original);
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-A");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("admits a marker-free legacy guest candidate without claiming its marker", async () => {
    const original = raw(played()); localStorage.setItem(key, original);
    const state = store(); await confirm(); mount(state); await settle();
    const posts = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string)).toMatchObject({ data: played(), expectedOwnerId: "user-B" });
    expect(localStorage.getItem(key)).toBe(original);
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBeNull();
  });

  it("waits for real hydration before fetching, observing or exposing readiness", async () => {
    const state = store();
    let finish!: () => void;
    authority.current.bindPersistedStore(key, {
      rehydrate: () => new Promise<void>(resolve => { finish = resolve; }),
      hasHydrated: () => true, onFinishHydration: () => () => {},
    });
    await authority.current.updateSession("authenticated", "user-B");
    const view = mount(state); await settle();
    expect(view.result.current.ready).toBe(false); expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => { state.setState({ progress: played() }); finish(); });
    await settle();
    expect(view.result.current.ready).toBe(true);
    expect(fetchSpy.mock.calls.filter(([, init]) => !init?.method || init.method === "GET")).toHaveLength(1);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("rejects an in-flight response and every flush after the account changes", async () => {
    localStorage.setItem(key, raw(played()));
    const state = store(); await confirm();
    let respond!: (value: unknown) => void;
    fetchSpy.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const view = mount(state); await settle();
    await act(async () => {
      auth.data = { user: { id: "user-C" } };
      await authority.current.updateSession("authenticated", "user-C");
      view.rerender();
    });
    await act(async () => { respond({ ok: true, json: async () => ({ data: played(999), lastSyncedAt: null }) }); });
    await settle();
    expect(authority.current.getSnapshot().status).toBe("revoked");
    expect(state.getState().progress.highScore).toBe(77);
    await act(async () => { await view.result.current.forceSync(); });
    window.dispatchEvent(new Event("beforeunload")); view.unmount();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("revokes on sign-out broadcast and never repairs or deletes legacy bytes on pagehide", async () => {
    const original = raw(played()); localStorage.setItem(key, original);
    const state = store(); await confirm(); const view = mount(state); await settle();
    render(<ProgressSessionBoundary>{null}</ProgressSessionBoundary>);
    const lease = authority.current.captureLease()!;
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: SIGNOUT_BROADCAST_KEY })); });
    state.setState({ progress: played(1000) }); window.dispatchEvent(new Event("pagehide"));
    expect(authority.current.isCurrent(lease)).toBe(false);
    expect(localStorage.getItem(key)).toBe(original);
    expect(view.result.current.ready).toBe(false);
    expect(authority.current.getSnapshot().needsNavigation).toBe(true);
  });

  it("ignores foreign namespace events and refreshes cloud on its own namespace notification", async () => {
    const server = createProgressServer({ current: auth }); fetchSpy.mockImplementation(server.fetch);
    server.rows.set("user-B:snake", { data: played(1), updatedAt: new Date(100) });
    const state = store(); await confirm(); mount(state); await settle();
    const foreign = createOwnerBoundProgress(); await foreign.updateSession("authenticated", "user-A");
    foreign.writeScoped(key, raw(played(999)));
    const foreignKey = `hh-progress:v2:${JSON.stringify([foreign.captureLease()!.ownerKey, key])}`;
    const before = server.gets;
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: foreignKey })); });
    await settle();
    expect(server.gets).toBe(before); expect(state.getState().progress.highScore).toBe(1);
    server.rows.set("user-B:snake", { data: played(42), updatedAt: new Date(500) });
    authority.current.writeScoped(key, raw(played(42)));
    const ownKey = `hh-progress:v2:${JSON.stringify([authority.current.captureLease()!.ownerKey, key])}`;
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: ownKey })); });
    await settle(); await settle(); await settle();
    expect(server.gets).toBe(before + 1);
    expect(progressSyncPresentation.getSnapshot()[0]?.status).toBe("saved");
    expect({ progress: state.getState().progress, status: progressSyncPresentation.getSnapshot()[0]?.status }).toMatchObject({ progress: { highScore: 42 } });
  });
});
