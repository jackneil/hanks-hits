/**
 * Real-store regression coverage for first-read additions, concurrent item
 * edits, deletions, overflow and owner lease changes. Known revisions permit
 * three-way merges. Unknown ancestry and overflow retain alternatives for an
 * explicit choice, without arbitrary eviction. Provider navigation and real
 * ownership are covered in owner-guard and ProgressSessionBoundary tests.
 */
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { vi } from "vitest";
import { setTimeout as realDelay } from "node:timers/promises";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z"));
});

const session = vi.hoisted(() => ({
  current: { data: null as null | { user: { id: string } }, status: "unauthenticated" as string },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => session.current,
  signOut: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { SYNCED_STORES, syncedStore, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { installAudioMock } from "@/__tests__/audio-mock";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import { useFlappyStore } from "@/games/flappy-bird/lib/store";

const server = createProgressServer(session);

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const settle = async (ms: number) => {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => {
      await realDelay(5);
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
    });
  }
};
const signInAs = (id: string) => {
  session.current = { data: { user: { id } }, status: "authenticated" };
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const progressOf = (entry: SyncedStoreEntry) => clone(entry.store.getState().getProgress()) as Record<string, unknown>;
const mount = (entry: SyncedStoreEntry, debounceMs = 1_000) =>
  renderHook(() =>
    useAuthSync({
      appId: entry.appId as ValidAppId,
      localStorageKey: entry.key,
      getState: () => entry.store.getState().getProgress() as AppProgressData,
      setState: (data) => entry.store.getState().setProgress(data as never),
      debounceMs,
    })
  );

function accountHolds(entry: SyncedStoreEntry, progress: Record<string, unknown>, user = "user-1") {
  server.rows.set(`${user}:${entry.appId}`, { data: clone(progress) as AppProgressData, updatedAt: new Date() });
}

/** The progress that `play` makes on a fresh store at `iso` (the store and its save are reset after). */
function made(entry: SyncedStoreEntry, iso: string, play: () => void) {
  entry.reset();
  at(iso);
  play();
  const out = progressOf(entry);
  entry.reset();
  localStorage.removeItem(entry.key);
  return out;
}

/** `count` drawings, one minute apart from `iso` (the newest first, as the store keeps them). */
function drawings(count: number, iso: string) {
  return made(syncedStore("drawing-app"), iso, () => {
    for (let i = 0; i < count; i++) {
      useDrawingStore.getState().saveArtwork("data:image/png;base64,AAAA", `Acct ${i}`);
      vi.advanceTimersByTime(60_000);
    }
  });
}

const names = (progress: unknown, field: string) =>
  ((progress as Record<string, Array<{ name: string }>> | undefined)?.[field] ?? []).map((item) => item.name);

/** The raw save of another tab that runs this code: `progress` in this store's save shape. */
function rawSaveOf(entry: SyncedStoreEntry, progress: Record<string, unknown>): string {
  const mine = localStorage.getItem(entry.key);
  if (mine === null) throw new Error("this tab has no save");
  const parsed = JSON.parse(mine) as { state: Record<string, unknown>; version?: number };
  const nested = "progress" in parsed.state;
  return JSON.stringify({
    ...parsed,
    state: nested ? { ...parsed.state, progress } : { ...parsed.state, ...progress },
  });
}

/** Another tab writes `raw` for `key`: the storage event (or a page from the back-forward cache). */
function otherTabWrites(key: string, raw: string, via: "storage" | "pageshow") {
  localStorage.setItem(key, raw);
  if (via === "storage") window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw }));
  else window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}

let reloadSpy: ReturnType<typeof vi.fn>;
const originalLocation = window.location;

beforeEach(() => {
  localStorage.clear();
  server.reset();
  installAudioMock();
  __unsafeResetForeignPurgeLockForTests();
  session.current = { data: null, status: "unauthenticated" };
  server.install(vi.stubGlobal);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  reloadSpy = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...originalLocation, reload: reloadSpy },
  });
  at("2026-10-20T13:00:00Z");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { writable: true, configurable: true, value: originalLocation });
  for (const entry of SYNCED_STORES) entry.reset();
});

async function choose(appId: string) {
  const entry = progressSyncPresentation.getSnapshot().find(row => row.appId === appId)!;
  expect(entry.status).toBe("conflict");
  const dialog = entry.open()!;
  server.net.getDelayMs = 0;
  await act(async () => { expect(await dialog.choose("local")).toMatchObject({ ok: true }); });
  return dialog;
}

// ---------------------------------------------------------------------------
// F4: an item made while the first GET is in flight on an untouched device
// ---------------------------------------------------------------------------

describe("F4: an item made during the first sync of an untouched device is kept", () => {
  it("drum-machine: a beat saved while the first GET is in flight remains selectable alongside the account's beats", async () => {
    const entry = syncedStore("drum-machine");
    accountHolds(entry, made(entry, "2026-10-20T11:00:00Z", () => useDrumMachineStore.getState().saveBeat("Account beat")));
    at("2026-10-20T13:00:00Z");
    server.net.getDelayMs = 1_500;
    signInAs("user-1");
    const view = mount(entry);
    await settle(400);
    useDrumMachineStore.getState().saveBeat("Kid beat");
    await settle(8_000);
    const copies = await choose("drum-machine");
    expect(names(copies.options.find(option => option.id === "server")!.data, "savedBeats")).toEqual(["Account beat"]);
    view.unmount();

    const beats = (p: unknown) => names((p as { savedBeats?: unknown } | undefined) ?? {}, "savedBeats");
    expect(beats(progressOf(entry))).toEqual(["Kid beat"]);
    expect(beats(server.row("drum-machine"))).toEqual(["Kid beat"]);
  });

  it("drawing-app: the account holds 20 drawings; a drawing made during the GET stays selectable without silently evicting an account drawing", async () => {
    const entry = syncedStore("drawing-app");
    accountHolds(entry, drawings(20, "2026-10-20T09:00:00Z"));
    at("2026-10-20T13:00:00Z");
    server.net.getDelayMs = 1_500;
    signInAs("user-1");
    const view = mount(entry);
    await settle(400);
    useDrawingStore.getState().saveArtwork("data:image/png;base64,KKKK", "Kid art");
    await settle(8_000);
    expect(names(server.row("drawing-app"), "savedArtworks")).toHaveLength(20);
    const copies = await choose("drawing-app");
    const account = names(copies.options.find(option => option.id === "server")!.data, "savedArtworks");
    expect(account).toHaveLength(20); expect(account).toContain("Acct 0");
    view.unmount();
    expect(names(progressOf(entry), "savedArtworks")).toEqual(["Kid art"]);
    expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(["Kid art"]);
    expect(server.rejected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F5 + F6: another tab's newer save, and this tab's unsaved items
// ---------------------------------------------------------------------------

describe("F6: another tab's newer save keeps this tab's unsaved items", () => {
  async function syncedDrawingTab(start: Record<string, unknown>) {
    const entry = syncedStore("drawing-app");
    accountHolds(entry, start);
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
    signInAs("user-1");
    const view = mount(entry, 2_000);
    await settle(2_000);
    expect(names(progressOf(entry), "savedArtworks")).toEqual(names(start, "savedArtworks"));
    return { entry, view };
  }

  it.each([["storage"], ["pageshow"]] as const)(
    "via %s: this tab's drawing X (its upload pending) stays, joins the other tab's drawing Y, and reaches the account",
    async (via) => {
      const shared = made(syncedStore("drawing-app"), "2026-10-20T12:00:00Z", () =>
        useDrawingStore.getState().saveArtwork("data:image/png;base64,AAAA", "Shared")
      );
      const { entry, view } = await syncedDrawingTab(shared);

      at("2026-10-20T13:05:00Z");
      useDrawingStore.getState().saveArtwork("data:image/png;base64,XXXX", "Drawing X");
      // A stale tab (it missed X) saves drawing Y a moment later, and uploads it.
      at("2026-10-20T13:05:00.500Z");
      const y = { ...(shared.savedArtworks as Array<Record<string, unknown>>)[0], id: "art_y", name: "Drawing Y", createdAt: new Date().toISOString() };
      const theirs = { ...shared, savedArtworks: [y, ...(shared.savedArtworks as unknown[])], lastModified: Date.now() };
      accountHolds(entry, theirs);
      otherTabWrites(entry.key, rawSaveOf(entry, theirs), via);

      await settle(6_000);
      expect(names(progressOf(entry), "savedArtworks")).toEqual(["Drawing Y", "Drawing X", "Shared"]);
      view.unmount();
      expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(["Drawing Y", "Drawing X", "Shared"]);
    }
  );

  it("a drawing that the other tab deleted does not come back; this tab's new drawing stays", async () => {
    const start = made(syncedStore("drawing-app"), "2026-10-20T12:00:00Z", () => {
      useDrawingStore.getState().saveArtwork("data:image/png;base64,AAAA", "S1");
      vi.advanceTimersByTime(60_000);
      useDrawingStore.getState().saveArtwork("data:image/png;base64,BBBB", "S2");
    });
    const { entry, view } = await syncedDrawingTab(start);

    at("2026-10-20T13:05:00Z");
    useDrawingStore.getState().saveArtwork("data:image/png;base64,XXXX", "Drawing X");
    at("2026-10-20T13:05:00.500Z");
    const theirs = {
      ...start,
      savedArtworks: (start.savedArtworks as Array<{ name: string }>).filter((art) => art.name !== "S2"),
      lastModified: Date.now(),
    };
    accountHolds(entry, theirs);
    otherTabWrites(entry.key, rawSaveOf(entry, theirs), "storage");

    await settle(6_000);
    expect(names(progressOf(entry), "savedArtworks")).toEqual(["Drawing X", "S1"]);
    view.unmount();
    expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(["Drawing X", "S1"]);
  });

  it("F5: overflow preserves both full lists for explicit choice without silently evicting another drawing", async () => {
    const start = drawings(20, "2026-10-20T09:00:00Z");
    const { entry, view } = await syncedDrawingTab(start);

    // This tab draws X: the store itself pops its oldest drawing (Acct 0).
    at("2026-10-20T13:05:00Z");
    useDrawingStore.getState().saveArtwork("data:image/png;base64,XXXX", "Drawing X");
    // The other tab (it missed X) draws Y, and pops Acct 0 as well.
    at("2026-10-20T13:05:00.500Z");
    const all = start.savedArtworks as Array<Record<string, unknown>>;
    const y = { ...all[0], id: "art_y", name: "Drawing Y", createdAt: new Date().toISOString() };
    const theirs = { ...start, savedArtworks: [y, ...all.slice(0, 19)], lastModified: Date.now() };
    accountHolds(entry, theirs);
    otherTabWrites(entry.key, rawSaveOf(entry, theirs), "storage");

    await settle(6_000);
    const copies = await choose("drawing-app");
    const local = names(copies.options.find(option => option.id === "local")!.data, "savedArtworks");
    const remote = names(copies.options.find(option => option.id === "server")!.data, "savedArtworks");
    expect(local).toHaveLength(20); expect(remote).toHaveLength(20);
    expect(local).toContain("Drawing X"); expect(remote).toContain("Drawing Y");
    expect(local).toContain("Acct 1"); expect(remote).toContain("Acct 1");
    view.unmount();
    expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(local);
    expect(server.rejected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F7: the owner of the progress
// ---------------------------------------------------------------------------

describe("F7: kid A's progress never reaches kid B's account", () => {
  const kidB = { highScore: 5, gamesPlayed: 2, totalPipes: 10 };

  async function kidAPlays() {
    const entry = syncedStore("flappy-bird");
    accountHolds(entry, { ...progressOf(entry), ...kidB, lastModified: Date.parse("2026-10-20T10:00:00Z") }, "user-B");
    signInAs("user-A");
    const view = mount(entry);
    await settle(2_000);
    useFlappyStore.setState({ score: 77 } as never);
    useFlappyStore.getState().endGame();
    await settle(3_000);
    expect((server.row("flappy-bird", "user-A") as Record<string, number>).highScore).toBe(77);
    return { entry, view };
  }

  const rowOfB = () => server.row("flappy-bird", "user-B") as Record<string, number>;

  it("rejects the old owner lease when the account changes during the first GET", async () => {
    const entry = syncedStore("flappy-bird");
    useFlappyStore.setState({ score: 77 } as never);
    useFlappyStore.getState().endGame();
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-A");
    accountHolds(entry, { ...progressOf(entry), ...kidB }, "user-B");
    server.net.getDelayMs = 1_500;
    signInAs("user-A");
    const view = mount(entry);
    await settle(400);
    signInAs("user-B");
    view.rerender();
    await settle(100);
    expect(server.posts.filter(post => post.data.highScore === 3)).toEqual([]);
    expect(localStorage.getItem(entry.key)).not.toBeNull();
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-A");
    await settle(4_000);
    await act(async () => { await view.result.current.forceSync(); });
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    expect(server.posts).toEqual([]);
    expect(rowOfB()).toMatchObject(kidB);
  });

  it("a session that changes to kid B on a mounted page: no save reaches B, legacy saves remain, and the old lease cannot save", async () => {
    const { entry, view } = await kidAPlays();
    const postsBefore = server.posts.length;

    // Another tab signs in as kid B (the login page does not sign out first).
    signInAs("user-B");
    view.rerender();
    await settle(500);
    const saveAfterSwitch = localStorage.getItem(entry.key);
    const ownerAfterSwitch = localStorage.getItem(PROGRESS_OWNER_KEY);

    // Kid A, still at this page, plays one more round; then the page goes.
    useFlappyStore.setState({ score: 3 } as never);
    useFlappyStore.getState().endGame();
    await settle(4_000);
    await act(async () => {
      await view.result.current.forceSync();
    });
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    await settle(500);

    expect(rowOfB()).toMatchObject(kidB);
    expect(server.posts.length).toBe(postsBefore);
    expect(server.posts.filter(post => post.data.highScore === 3)).toEqual([]);
    expect(saveAfterSwitch).not.toBeNull();
    expect(ownerAfterSwitch).toBeNull(); // Current identity never claims the legacy marker.
  });

  it.each([["pageshow"], ["storage"]] as const)(
    "another tab claimed the device for kid B (the owner key), seen via %s: the old owner lease cannot save",
    async (via) => {
      const { view } = await kidAPlays();
      const postsBefore = server.posts.length;

      // The other tab signed in as kid B: its first sync cleared the saves and
      // claimed the owner key. The cookie is B's now; this page still holds A.
      session.current = { data: { user: { id: "user-B" } }, status: "authenticated" };
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-B");
      if (via === "pageshow") window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      else window.dispatchEvent(new StorageEvent("storage", { key: PROGRESS_OWNER_KEY, newValue: "user-B" }));

      useFlappyStore.setState({ score: 3 } as never);
      useFlappyStore.getState().endGame();
      await settle(4_000);
      window.dispatchEvent(new Event("beforeunload"));
      view.unmount();
      await settle(500);

      expect(rowOfB()).toMatchObject(kidB);
      expect(server.posts.length).toBe(postsBefore);
      expect(server.posts.filter(post => post.data.highScore === 3)).toEqual([]);
    }
  );

  it("the same kid on the same page (a session refresh) keeps saving", async () => {
    const { view } = await kidAPlays();
    signInAs("user-A");
    view.rerender();
    useFlappyStore.setState({ score: 90 } as never);
    useFlappyStore.getState().endGame();
    await settle(4_000);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect((server.row("flappy-bird", "user-A") as Record<string, number>).highScore).toBe(90);
    view.unmount();
  });
});

vi.mock("@/lib/owner-bound-progress", async () => {
  const { useSession: readSession } = await import("next-auth/react");
  const { createSyncOwnerFixture } = await import("@/shared/hooks/__tests__/ownerProgressFixture");
  return createSyncOwnerFixture(readSession);
});

// B1 reconciliation fixtures retain their historical physical save format.
vi.mock("@/lib/owner-bound-progress/persistStorage", async () => {
  const { createJSONStorage } = await import("zustand/middleware");
  return { createOwnerPersistStorage: () => createJSONStorage(() => localStorage) };
});
