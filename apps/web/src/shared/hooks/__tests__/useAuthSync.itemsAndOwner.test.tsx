/**
 * Part B1 of #26i (the split after review wave 3): four fixes, each with the
 * real stores, the real useAuthSync and a server that runs the real
 * validation and merge (src/__tests__/fake-progress-server.ts).
 *
 * - F4: an item that the kid makes while the first GET is in flight on an
 *   untouched device is kept. The account's progress is taken, and the
 *   item joins it.
 * - F5: when items join a list, the list keeps the newest items up to its
 *   length, as the store's own eviction does, and each drop is logged.
 * - F6: another tab's newer save (the storage takeover) keeps this tab's
 *   items that were not saved yet, does not bring back an item that the
 *   other tab deleted, and keeps the save pending so that the items reach
 *   the account.
 * - F7: the progress of kid A never reaches the account of kid B. A session
 *   that changes on a mounted page, an owner key that another tab changed,
 *   and a page from the back-forward cache all lock the saves and reload.
 */
import { vi } from "vitest";

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

const warned = () => (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call.map(String).join(" "));

// ---------------------------------------------------------------------------
// F4: an item made while the first GET is in flight on an untouched device
// ---------------------------------------------------------------------------

describe("F4: an item made during the first sync of an untouched device is kept", () => {
  it("drum-machine: a beat saved while the GET is in flight joins the account's beats, on the device and on the account", async () => {
    const entry = syncedStore("drum-machine");
    accountHolds(entry, made(entry, "2026-10-20T11:00:00Z", () => useDrumMachineStore.getState().saveBeat("Account beat")));
    at("2026-10-20T13:00:00Z");
    server.net.getDelayMs = 1_500;
    signInAs("user-1");
    const view = mount(entry);
    await settle(400);
    useDrumMachineStore.getState().saveBeat("Kid beat");
    await settle(8_000);
    view.unmount();

    const beats = (p: unknown) => names((p as { savedBeats?: unknown } | undefined) ?? {}, "savedBeats");
    expect(beats(progressOf(entry))).toEqual(["Account beat", "Kid beat"]);
    expect(beats(server.row("drum-machine"))).toEqual(["Account beat", "Kid beat"]);
  });

  it("drawing-app: the account holds 20 drawings; a drawing made during the GET is kept and the account's oldest goes, with a log line (F5)", async () => {
    const entry = syncedStore("drawing-app");
    accountHolds(entry, drawings(20, "2026-10-20T09:00:00Z"));
    at("2026-10-20T13:00:00Z");
    server.net.getDelayMs = 1_500;
    signInAs("user-1");
    const view = mount(entry);
    await settle(400);
    useDrawingStore.getState().saveArtwork("data:image/png;base64,KKKK", "Kid art");
    await settle(8_000);
    view.unmount();

    const tab = names(progressOf(entry), "savedArtworks");
    const row = names(server.row("drawing-app"), "savedArtworks");
    expect(tab).toHaveLength(20);
    expect(tab[0]).toBe("Kid art");
    expect(tab).not.toContain("Acct 0");
    expect(tab).toContain("Acct 1");
    expect(row).toEqual(tab);
    expect(server.rejected).toEqual([]);
    expect(warned().some((line) => /drawing-app\.savedArtworks/.test(line) && /1 /.test(line))).toBe(true);
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

      expect(names(progressOf(entry), "savedArtworks")).toEqual(["Drawing Y", "Drawing X", "Shared"]);
      await settle(6_000);
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

    expect(names(progressOf(entry), "savedArtworks")).toEqual(["Drawing X", "S1"]);
    await settle(6_000);
    view.unmount();
    expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(["Drawing X", "S1"]);
  });

  it("F5: at the list's length, the union keeps the newest 20 (the store's own eviction) and logs the drop", async () => {
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

    const tab = names(progressOf(entry), "savedArtworks");
    expect(tab).toHaveLength(20);
    expect(tab.slice(0, 2)).toEqual(["Drawing Y", "Drawing X"]);
    expect(tab).not.toContain("Acct 0");
    expect(tab).not.toContain("Acct 1");
    expect(tab).toContain("Acct 2");
    expect(warned().some((line) => /drawing-app\.savedArtworks/.test(line))).toBe(true);
    await settle(6_000);
    view.unmount();
    expect(names(server.row("drawing-app"), "savedArtworks")).toEqual(tab);
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

  it("locks and reloads when the account changes during the first GET", async () => {
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
    expect(reloadSpy).toHaveBeenCalled();
    expect(localStorage.getItem(entry.key)).toBeNull();
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-B");
    await settle(4_000);
    await act(async () => { await view.result.current.forceSync(); });
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    expect(server.posts).toEqual([]);
    expect(rowOfB()).toMatchObject(kidB);
  });

  it("a session that changes to kid B on a mounted page: no save reaches B, the device's saves go, and the page reloads", async () => {
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
    expect(reloadSpy).toHaveBeenCalled();
    expect(saveAfterSwitch).toBeNull();
    expect(ownerAfterSwitch).toBe("user-B");
  });

  it.each([["pageshow"], ["storage"]] as const)(
    "another tab claimed the device for kid B (the owner key), seen via %s: this page locks its saves and reloads",
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
      expect(reloadSpy).toHaveBeenCalled();
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
