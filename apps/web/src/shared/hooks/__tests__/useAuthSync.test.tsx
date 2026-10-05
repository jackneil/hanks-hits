import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createOwnerBoundProgress, type OwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { ProgressJournalRepository } from "@/shared/lib/progressJournalRepository";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { useAuthSync } from "../useAuthSync";

const auth = vi.hoisted(() => ({ status: "authenticated", data: { user: { id: "revision-owner" } } }));
const authority = vi.hoisted(() => ({ current: null as unknown as OwnerBoundProgress }));
vi.mock("next-auth/react", () => ({ useSession: () => auth }));
vi.mock("@/lib/owner-bound-progress", async () => {
  const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress/core");
  authority.current = createOwnerBoundProgress();
  return {
  ownerBoundProgress: new Proxy({}, { get: (_target, key) => authority.current[key as keyof OwnerBoundProgress] }),
  createOwnerBoundStorage: (key: string, appId?: string) => authority.current.createStorage(key, appId),
  bindPersistedStore: (key: string, handle: Parameters<OwnerBoundProgress["bindPersistedStore"]>[1], flush?: () => void) => authority.current.bindPersistedStore(key, handle, flush),
  };
});

const key = "snake-game-state";
const defaults = { highScore: 0, gamesPlayed: 0, totalFoodEaten: 0, longestSnake: 0, lastModified: 0 };
type Progress = typeof defaults;
const played = (score: number): Progress => ({ highScore: score, gamesPlayed: 1, totalFoodEaten: score, longestSnake: score, lastModified: score });
let server: ReturnType<typeof createProgressServer>;
let fetchSpy: ReturnType<typeof vi.fn>;
const databases: ProgressJournalDatabase[] = [];
const entry = () => progressSyncPresentation.getSnapshot().find(row => row.appId === "snake")!;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
async function fixture(initial = defaults, pauseForRecovery?: () => ((synced?: boolean) => void), strict = false, debounceMs = 10_000) {
  const state = create(persist(() => ({ progress: { ...defaults } }), {
    name: key, storage: createOwnerPersistStorage<{ progress: Progress }>(key, "snake"), skipHydration: true,
  }));
  authority.current.bindPersistedStore(key, state.persist, () => state.setState({}));
  await authority.current.updateSession("authenticated", auth.data.user.id);
  await authority.current.whenHydrated(key);
  state.setState({ progress: { ...initial } });
  const view = renderHook(() => useAuthSync({ appId: "snake", localStorageKey: key,
    getState: () => state.getState().progress, setState: progress => state.setState({ progress }),
    debounceMs, pauseForRecovery }), {
    reactStrictMode: strict,
  });
  return { state, view };
}
async function ready() { await waitFor(() => expect(entry()).toBeDefined()); await waitFor(() => expect(entry().status).not.toBe("saving")); }
async function journals() {
  const database = new ProgressJournalDatabase(); databases.push(database);
  const rows = await database.list(authority.current.captureLease()!.ownerKey, 0);
  return rows.map(row => JSON.parse(JSON.parse(row.raw).current));
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  auth.status = "authenticated"; auth.data = { user: { id: "revision-owner" } };
  authority.current = createOwnerBoundProgress();
  server = createProgressServer({ current: auth }); fetchSpy = vi.fn(server.fetch);
  vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => false) });
});
afterEach(async () => {
  cleanup(); vi.useRealTimers(); await flush(); databases.splice(0).forEach(database => database.close());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(progressSyncPresentation.getSnapshot()).toEqual([]);
});

describe("mounted revision-aware sync with real owner storage", () => {
  it("retains its exact checkpoint when a server refuses the client protocol", async () => {
    server.net.postStatus = 428;
    const { state, view } = await fixture(played(20));
    await waitFor(() => expect(entry()?.status).toBe("network-error"));
    expect(view.result.current.syncStatus).not.toBe("synced");
    expect(state.getState().progress).toEqual(played(20));
    expect(server.row("snake", "revision-owner")).toBeUndefined();
    view.unmount(); await flush();
    const saved = await journals();
    expect(saved.some(row => row.live.highScore === 20 && row.sent?.data.highScore === 20)).toBe(true);
    server.net.postStatus = 0;
    const reopened = await fixture(played(20));
    // An uncertain create against a null base cannot prove it was never deleted.
    await waitFor(() => expect(entry()?.status).toBe("conflict"));
    const dialog = entry().open()!;
    expect(dialog.options.find(option => option.id === "local")!.data).toEqual(played(20));
    await act(async () => { expect(await dialog.choose("local")).toMatchObject({ ok: true }); });
    await waitFor(() => expect(reopened.view.result.current.syncStatus).toBe("synced"));
    expect(server.row("snake", "revision-owner")).toEqual(played(20));
  });

  it("automatically uploads continuing play without resetting the pending debounce", async () => {
    const { state, view } = await fixture(defaults, undefined, false, 40); await ready();
    for (let score = 1; score <= 12; score++) {
      await act(async () => { state.setState({ progress: played(score) }); await new Promise(resolve => setTimeout(resolve, 15)); });
      if (score === 8) expect(server.posts.length).toBeGreaterThan(0);
    }
    await waitFor(() => expect(server.row("snake", "revision-owner")).toEqual(played(12)));
    expect(server.posts.length).toBeGreaterThan(1);
    expect(view.result.current.syncStatus).toBe("synced");
  });

  it("retains local play through a failed first GET and retries when the server returns", async () => {
    server.net.failGets = 1;
    const { state, view } = await fixture(played(20));
    await waitFor(() => expect(entry()?.status).toBe("network-error"));
    expect(view.result.current.ready).toBe(false);
    expect(state.getState().progress).toEqual(played(20)); expect(server.posts).toEqual([]);
    act(() => state.setState({ progress: played(30) }));
    await waitFor(() => expect(server.row("snake", "revision-owner")).toEqual(played(30)), { timeout: 4000 });
    expect(view.result.current.syncStatus).toBe("synced");
    expect(server.gets).toBe(2);
  });

  it("allows local play after the readiness timeout without claiming an offline save is synced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    server.net.failGets = 100;
    const { state, view } = await fixture(played(20));
    expect(view.result.current.ready).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(view.result.current).toMatchObject({ ready: true, synced: false });
    expect(state.getState().progress).toEqual(played(20));
    expect(server.posts).toEqual([]);
  });
  it("loads the cloud into an untouched store without uploading defaults", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state, view } = await fixture(); await ready();
    expect(state.getState().progress).toEqual(played(50));
    expect(view.result.current).toMatchObject({ ready: true, synced: true, syncStatus: "synced" });
    expect(server.posts).toEqual([]);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ headers: { "x-hh-expected-owner": "revision-owner" } });
  });

  it("treats an untouched empty account as saved without creating a cloud row", async () => {
    const { view } = await fixture(); await ready();
    expect(view.result.current).toMatchObject({ ready: true, synced: true, syncStatus: "synced" });
    expect(server.posts).toEqual([]);
  });

  it("does not turn an empty account's previous durable checkpoint into a recovery conflict", async () => {
    const first = await fixture(); await ready(); first.view.unmount(); await flush();
    const second = await fixture(); await ready();
    expect(second.view.result.current.syncStatus).toBe("synced");
    expect(server.posts).toEqual([]);
  });

  it("ignores a retained untouched provisional checkpoint from StrictMode's abandoned setup", async () => {
    const original = ProgressJournalRepository.open;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(ProgressJournalRepository, "open").mockImplementationOnce(async options => {
      const repository = await original(options); await pending; return repository;
    });
    const { view } = await fixture(defaults, undefined, true); await ready();
    release(); await flush();
    await waitFor(async () => expect((await journals()).length).toBe(2));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(server.gets).toBe(2)); await flush();
    expect(view.result.current.syncStatus).toBe("synced");
    expect(server.posts).toEqual([]);
  });

  it("refreshes canonical cloud progress when the tab regains focus", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state } = await fixture(); await ready();
    server.rows.set("revision-owner:snake", { data: played(90), updatedAt: new Date(90) });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(state.getState().progress).toEqual(played(90)));
    expect(server.posts).toEqual([]);
  });

  it("does not emit another storage event when a sibling refresh observes unchanged cloud progress", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    await fixture(); await ready(); await flush();
    const write = vi.spyOn(localStorage, "setItem");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    await waitFor(() => expect(server.gets).toBe(2)); await flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("retains newer edits while a conditional POST is in flight", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state, view } = await fixture(); await ready();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    fetchSpy.mockImplementationOnce(async (...args: Parameters<typeof server.fetch>) => { await pending; return server.fetch(...args); });
    act(() => state.setState({ progress: played(70) }));
    let saving!: Promise<void>;
    act(() => { saving = view.result.current.forceSync(); });
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    act(() => state.setState({ progress: played(80) }));
    await act(async () => { release(); await saving; });
    expect(state.getState().progress).toEqual(played(80));
    expect(server.row("snake", "revision-owner")).toEqual(played(70));
    await act(async () => { await view.result.current.forceSync(); });
    expect(server.row("snake", "revision-owner")).toEqual(played(80));
    expect(view.result.current.syncStatus).toBe("synced");
  });

  it("retains a refused pagehide beacon for conditional replay after remount", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const first = await fixture(); await ready();
    act(() => first.state.setState({ progress: played(70) }));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    expect(first.view.result.current.syncStatus).not.toBe("synced");
    first.view.unmount(); await flush();
    const second = await fixture(played(70)); await ready();
    expect(second.state.getState().progress).toEqual(played(70));
    expect(server.row("snake", "revision-owner")).toEqual(played(70));
    const posts = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string)).toMatchObject({ expectedOwnerId: "revision-owner", baseRevision: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("captures a store edit before the network debounce and preserves it on unmount with localStorage full", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state, view } = await fixture(); await ready();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("quota"); });
    act(() => state.setState({ progress: played(70) }));
    view.unmount();
    await waitFor(async () => expect((await journals()).some(row => row.live.highScore === 70)).toBe(true));
    expect(server.posts).toEqual([]);
  });

  it("preserves a departing edit even if repository construction has not returned", async () => {
    const original = ProgressJournalRepository.open;
    let opened = false, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(ProgressJournalRepository, "open").mockImplementationOnce(async options => {
      const repository = await original(options); opened = true; await pending; return repository;
    });
    const { state, view } = await fixture(); await waitFor(() => expect(opened).toBe(true));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("quota"); });
    act(() => state.setState({ progress: played(75) })); view.unmount();
    release();
    await waitFor(async () => expect((await journals()).some(row => row.live.highScore === 75)).toBe(true));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the retry delay when a focus refresh encounters repeated construction failures", async () => {
    const original = ProgressJournalRepository.open;
    let calls = 0;
    vi.spyOn(ProgressJournalRepository, "open").mockImplementation(async options => {
      if (++calls < 5) throw Error("storage temporarily unavailable");
      return original(options);
    });
    await fixture(); await waitFor(() => expect(calls).toBe(1));
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(calls).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs a queued focus refresh after a delayed explicit choice acknowledgement", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state } = await fixture(played(20)); await ready();
    let accepted = false, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    fetchSpy.mockImplementation(async (...args: Parameters<typeof server.fetch>) => {
      const response = await server.fetch(...args);
      if (args[1]?.method === "POST") { accepted = true; await pending; }
      return response;
    });
    const dialog = entry().open()!; let choosing!: ReturnType<typeof dialog.choose>;
    act(() => { choosing = dialog.choose("local"); });
    await waitFor(() => expect(accepted).toBe(true));
    server.rows.set("revision-owner:snake", { data: played(90), updatedAt: new Date(90) });
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { release(); await choosing; });
    await waitFor(() => expect(state.getState().progress).toEqual(played(90)));
  });

  it("keeps divergent local play until an explicit choice and fences stale dialog cleanup", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const releases: ReturnType<typeof vi.fn>[] = [];
    const pause = vi.fn(() => { const release = vi.fn(); releases.push(release); return release; });
    const { state } = await fixture(played(20), pause); await ready();
    expect(entry().status).toBe("conflict"); expect(server.posts).toEqual([]);
    expect(state.getState().progress).toEqual(played(20));
    const old = entry().open()!; old.close();
    const current = entry().open()!;
    old.close(); // React's cleanup for the previous modal may run after its replacement opened.
    expect(releases[1]).not.toHaveBeenCalled();
    let outcome;
    await act(async () => { outcome = await current.choose("server"); });
    expect(outcome).toMatchObject({ ok: true });
    expect(state.getState().progress).toEqual(played(50));
    expect(releases[1]).toHaveBeenCalledTimes(1);
    expect(await old.choose("local")).toMatchObject({ ok: false });
  });

  it("blocks an in-flight cloud response and further saves after owner revocation", async () => {
    let finish!: (value: Response) => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { state, view } = await fixture(played(20));
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => { await authority.current.updateSession("authenticated", "another-owner"); });
    await act(async () => { finish({ status: 200, json: async () => ({ protocol: 1, data: played(90), revision: "a".repeat(64) }) } as Response); });
    expect(state.getState().progress).toEqual(played(20));
    expect(view.result.current.ready).toBe(false);
    await act(async () => { await view.result.current.forceSync(); });
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("survives StrictMode's effect replay without applying or sending stale writes", async () => {
    server.rows.set("revision-owner:snake", { data: played(50), updatedAt: new Date(50) });
    const { state, view } = await fixture(defaults, undefined, true); await ready();
    expect(state.getState().progress).toEqual(played(50)); expect(server.posts).toEqual([]);
    expect(view.result.current.syncStatus).toBe("synced");
    expect(progressSyncPresentation.getSnapshot()).toHaveLength(1);
  });
});
