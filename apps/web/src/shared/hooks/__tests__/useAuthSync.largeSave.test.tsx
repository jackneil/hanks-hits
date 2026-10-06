import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { setTimeout as realDelay } from "node:timers/promises";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DrawingAppProgress } from "@/apps/drawing-app/lib/store";
import { createOwnerBoundProgress, PROGRESS_NAMESPACE, type OwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { exceedsProgressBeaconBudget, progressBeaconDataBudget, PROGRESS_BEACON_BYTES } from "@/shared/lib/progressSyncRuntime";
import { useAuthSync } from "../useAuthSync";

const auth = vi.hoisted(() => ({ status: "authenticated", data: { user: { id: "large-save-owner" } } }));
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

const key = "drawing-app-progress";
const defaults: DrawingAppProgress = {
  settings: { defaultColor: "#000000", defaultSize: 5, defaultTool: "brush", soundEnabled: true, showGrid: false },
  stats: { artworksCreated: 0, totalDrawTime: 0 }, savedArtworks: [], lastModified: 0,
};
const painted = (size: number, version = 1): DrawingAppProgress => ({
  ...defaults, stats: { artworksCreated: 1, totalDrawTime: version }, lastModified: version,
  savedArtworks: [{ id: "retained-art", name: "Test picture", thumbnail: "preview",
    dataUrl: `data:image/png;base64,${"A".repeat(size)}`, createdAt: new Date(1).toISOString(), editedAt: new Date(version).toISOString() }],
});
let server: ReturnType<typeof createProgressServer>;
let fetchSpy: ReturnType<typeof vi.fn<typeof server.fetch>>;
const releases: Array<() => void> = [];
const entry = () => progressSyncPresentation.getSnapshot().find(row => row.appId === "drawing-app")!;
const posts = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
async function settleUntil(predicate: () => boolean) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 5000) throw Error("Timed out waiting for the real journal/network operation");
    await act(async () => { await realDelay(5); });
  }
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); await realDelay(5); });
}
async function fixture(initial = defaults, debounceMs = 2000, expectConflict = false) {
  const state = create(persist(() => ({ progress: initial }), {
    name: key, storage: createOwnerPersistStorage<{ progress: DrawingAppProgress }>(key, "drawing-app"), skipHydration: true,
  }));
  authority.current.bindPersistedStore(key, state.persist, () => state.setState({}));
  await authority.current.updateSession("authenticated", auth.data.user.id);
  await authority.current.whenHydrated(key);
  state.setState({ progress: initial });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const view = renderHook(() => useAuthSync({ appId: "drawing-app", localStorageKey: key,
    getState: () => state.getState().progress, setState: progress => state.setState({ progress }), debounceMs }));
  await settleUntil(() => entry()?.status === (expectConflict ? "conflict" : "saved"));
  // The runtime publishes saved before the hook's bootstrap operation releases.
  await act(async () => { await view.result.current.forceSync(); });
  return { state, view };
}
function delayNextPost() {
  let release!: () => void, started = false;
  const pending = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
  fetchSpy.mockImplementation(async (...args) => {
    if (args[1]?.method === "POST" && !started) { started = true; await pending; }
    return server.fetch(...args);
  });
  return { release, started: () => started };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.stubGlobal("indexedDB", new IDBFactory());
  auth.data = { user: { id: "large-save-owner" } };
  authority.current = createOwnerBoundProgress(); server = createProgressServer({ current: auth });
  fetchSpy = vi.fn(server.fetch); vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => false) });
});
afterEach(async () => {
  releases.splice(0).forEach(release => release()); cleanup(); vi.useRealTimers();
  await realDelay(30); vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(progressSyncPresentation.getSnapshot()).toEqual([]);
});

describe("size-aware open-page uploads with the real revision hook", () => {
  it("keeps the configured deadline for a small save", async () => {
    const { state } = await fixture(); act(() => state.setState({ progress: painted(100) }));
    await advance(1999); expect(posts()).toHaveLength(0);
    await advance(1); await settleUntil(() => entry().status === "saved");
    expect(posts()).toHaveLength(1); expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(100));
  });

  it("uploads a large save early and reports no ACK while it is pending", async () => {
    const { state, view } = await fixture(); act(() => state.setState({ progress: painted(80_000) }));
    expect(view.result.current.synced).toBe(false); expect(view.result.current.syncStatus).not.toBe("synced");
    await advance(499); expect(posts()).toHaveLength(0);
    await advance(1); await settleUntil(() => entry().status === "saved");
    expect(posts()).toHaveLength(1); expect(view.result.current.synced).toBe(true);
    expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(80_000));
  });

  it("promotes a small pending deadline when the save grows", async () => {
    const { state } = await fixture(); act(() => state.setState({ progress: painted(100) }));
    await advance(250); act(() => state.setState({ progress: painted(80_000, 2) }));
    await advance(499); expect(posts()).toHaveLength(0);
    await advance(1); await settleUntil(() => entry().status === "saved");
    expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(80_000, 2));
  });

  it("does not postpone a large deadline during continuous edits", async () => {
    const { state } = await fixture(); act(() => state.setState({ progress: painted(80_000) }));
    for (let version = 2; version <= 5; version++) {
      await advance(100); act(() => state.setState({ progress: painted(80_000, version) }));
      expect(posts()).toHaveLength(0);
    }
    await advance(100); await settleUntil(() => entry().status === "saved");
    expect(posts()).toHaveLength(1); expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(80_000, 5));
  });

  it("schedules current large play after a small in-flight POST, even if its edit timer expired", async () => {
    const { state, view } = await fixture(); const delayed = delayNextPost();
    act(() => state.setState({ progress: painted(100) }));
    let saving!: Promise<void>; act(() => { saving = view.result.current.forceSync(); });
    await settleUntil(delayed.started);
    act(() => state.setState({ progress: painted(80_000, 2) }));
    await advance(500); expect(posts()).toHaveLength(1);
    await act(async () => { delayed.release(); await saving; });
    expect(view.result.current.synced).toBe(false);
    expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(100));
    await advance(499); expect(posts()).toHaveLength(1);
    await advance(1); await settleUntil(() => entry().status === "saved");
    expect(posts()).toHaveLength(2); expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(80_000, 2));
  });

  it("also schedules large edits made during a delayed recovery choice", async () => {
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(100), updatedAt: new Date() });
    const { state, view } = await fixture(painted(200, 2), 2000, true);
    const dialog = entry().open()!, delayed = delayNextPost();
    let choosing!: ReturnType<typeof dialog.choose>; act(() => { choosing = dialog.choose("local"); });
    await settleUntil(delayed.started);
    act(() => state.setState({ progress: painted(80_000, 3) }));
    await advance(500); expect(posts()).toHaveLength(1);
    await act(async () => { delayed.release(); expect(await choosing).toEqual({ ok: false, status: 200 }); });
    expect(view.result.current.synced).toBe(false);
    await advance(499); expect(posts()).toHaveLength(1);
    await advance(1); await settleUntil(() => entry().status === "saved");
    expect(posts()).toHaveLength(2); expect(server.row("drawing-app", auth.data.user.id)).toEqual(painted(80_000, 3));
    dialog.close();
  });

  it("keeps retry backoff when large edits continue after a failed upload", async () => {
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(100), updatedAt: new Date() });
    const { state } = await fixture(); server.net.postStatus = 500;
    act(() => state.setState({ progress: painted(80_000, 2) }));
    await advance(500); await settleUntil(() => entry().status === "network-error"); expect(posts()).toHaveLength(1);
    for (let version = 3; version <= 21; version++) {
      act(() => state.setState({ progress: painted(80_000, version) })); await advance(100);
      expect(posts()).toHaveLength(1);
    }
    await advance(100); await settleUntil(() => posts().length === 2);
    await settleUntil(() => entry().status === "network-error");
    act(() => state.setState({ progress: painted(80_000, 22) }));
    await advance(3999); expect(posts()).toHaveLength(2);
    await advance(1); await settleUntil(() => posts().length === 3);
  });

  it("preserves recovery-choice retry backoff after a sibling storage notification", async () => {
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(100), updatedAt: new Date() });
    await fixture(painted(200, 2), 2000, true);
    const dialog = entry().open()!, delayed = delayNextPost(); server.net.postStatus = 503;
    let choosing!: ReturnType<typeof dialog.choose>; act(() => { choosing = dialog.choose("local"); });
    await settleUntil(delayed.started);
    const physical = PROGRESS_NAMESPACE + JSON.stringify([authority.current.captureLease()!.ownerKey, key]);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: physical })));
    await advance(500);
    await act(async () => { delayed.release(); expect(await choosing).toEqual({ ok: false, status: 503 }); });
    await advance(1999); expect(posts()).toHaveLength(1);
    await advance(1); await settleUntil(() => posts().length === 2);
    dialog.close();
  });

  it("cancels a large pending deadline and rejects the late POST after the owner changes", async () => {
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(100), updatedAt: new Date() });
    const { state, view } = await fixture(), delayed = delayNextPost();
    act(() => state.setState({ progress: painted(80_000, 2) }));
    let saving!: Promise<void>; act(() => { saving = view.result.current.forceSync(); });
    await settleUntil(delayed.started);
    act(() => state.setState({ progress: painted(80_000, 3) }));
    await act(async () => {
      auth.data = { user: { id: "next-owner" } };
      await authority.current.updateSession("authenticated", "next-owner"); view.rerender();
    });
    await advance(500);
    await act(async () => { delayed.release(); await saving; });
    expect(posts()).toHaveLength(1); expect(view.result.current.synced).toBe(false);
    expect(server.row("drawing-app", "large-save-owner")).toEqual(painted(100));
    expect(server.row("drawing-app", "next-owner")).toBeUndefined();
    expect(state.getState().progress).toEqual(painted(80_000, 3));
  });

  it("retains an oversized early-close save exactly and requires choice if cloud advanced while away", async () => {
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(100), updatedAt: new Date() });
    const first = await fixture(); const large = painted(80_000, 2);
    act(() => first.state.setState({ progress: large }));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(navigator.sendBeacon).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
    expect(first.view.result.current.synced).toBe(false); first.view.unmount(); vi.useRealTimers();
    const database = new ProgressJournalDatabase();
    try {
      await settleUntil(() => progressSyncPresentation.getSnapshot().length === 0);
      const ownerKey = authority.current.captureLease()!.ownerKey;
      await waitFor(async () => {
        const rows = await database.list(ownerKey, 0);
        expect(rows.some(row => JSON.stringify(JSON.parse(JSON.parse(row.raw).current).live) === JSON.stringify(large))).toBe(true);
      });
    } finally { database.close(); }
    server.rows.set(`${auth.data.user.id}:drawing-app`, { data: painted(200, 3), updatedAt: new Date(Date.now() + 1) });
    const reopened = await fixture(large, 2000, true);
    const dialog = entry().open()!;
    expect(dialog.options.find(option => option.id === "local")!.data).toEqual(large);
    expect(dialog.options.find(option => option.id === "server")!.data).toEqual(painted(200, 3));
    expect(posts()).toHaveLength(0); expect(reopened.view.result.current.synced).toBe(false);
    await act(async () => { expect(await dialog.choose("local")).toMatchObject({ ok: true }); });
    expect(server.row("drawing-app", auth.data.user.id)).toEqual(large);
  });
});

describe("conservative wire budget with bounded UTF8 encoding", () => {
  it("handles exact wrapper and multibyte boundaries using the same fixed buffer", () => {
    const budget = progressBeaconDataBudget("owner😀"), buffer = new Uint8Array(budget);
    const fitting = `"${"界".repeat(Math.floor((budget - 2) / 3))}"`;
    expect(new TextEncoder().encode(fitting).byteLength).toBeLessThanOrEqual(budget);
    expect(exceedsProgressBeaconBudget(fitting, buffer)).toBe(false);
    expect(exceedsProgressBeaconBudget(fitting.slice(0, -1) + "界\"", buffer)).toBe(true);
    const exact = `"${"A".repeat(budget - 2)}"`;
    expect(exceedsProgressBeaconBudget(exact, buffer)).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify({ data: JSON.parse(exact), merge: true,
      baseRevision: "0".repeat(64), expectedOwnerId: "owner😀", resolution: true })).byteLength).toBe(PROGRESS_BEACON_BYTES);
    const near = exact.slice(0, -1) + "A\"";
    expect(exceedsProgressBeaconBudget(near, buffer)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify({ data: JSON.parse(near), merge: true,
      baseRevision: null, expectedOwnerId: "owner😀" })).byteLength).toBeLessThan(PROGRESS_BEACON_BYTES);
  });

  it("does not encode huge strings or allocate a second gallery-sized buffer", () => {
    const buffer = new Uint8Array(progressBeaconDataBudget("owner"));
    const encoding = vi.spyOn(TextEncoder.prototype, "encodeInto");
    expect(exceedsProgressBeaconBudget("A".repeat(1_000_000), buffer)).toBe(true);
    expect(encoding).not.toHaveBeenCalled();
    expect(exceedsProgressBeaconBudget("界".repeat(buffer.length), buffer)).toBe(true);
    expect(encoding).toHaveBeenCalledOnce(); expect(encoding.mock.calls[0][1]).toBe(buffer);
    expect(buffer.byteLength).toBeLessThan(PROGRESS_BEACON_BYTES);
  });
});
