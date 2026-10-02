/**
 * Review wave 4 of #26i: the first sync, the account and other tabs, with
 * the REAL stores, the real useAuthSync and a server that runs the real
 * validation and merge (src/__tests__/fake-progress-server.ts).
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
import { act, renderHook } from "@testing-library/react";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { READY_FALLBACK_MS, useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";
import { extractTimestamp } from "@/lib/progress-merge";
import { sameProgress } from "@/shared/lib/progressStamp";
import { isUntouchedProgress } from "@/shared/lib/untouchedProgress";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { SYNCED_STORES, syncedStore, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { installAudioMock } from "@/__tests__/audio-mock";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { use2048Store } from "@/games/2048/lib/store";
import { useQuoridorStore } from "@/games/quoridor/lib/store";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import { useJokeStore } from "@/apps/joke-generator/lib/store";
import { useToyFinderStore } from "@/apps/toy-finder/lib/store";
import { useVirtualPetStore, type VirtualPetProgress } from "@/apps/virtual-pet/lib/store";

const server = createProgressServer(session);
const DAY = 24 * 60 * 60 * 1000;

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const settle = async (ms: number) => {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
    });
  }
};
const signIn = () => {
  session.current = { data: { user: { id: "user-1" } }, status: "authenticated" };
};
const progressOf = (entry: SyncedStoreEntry) =>
  JSON.parse(JSON.stringify(entry.store.getState().getProgress())) as Record<string, unknown>;
const mount = (entry: SyncedStoreEntry) =>
  renderHook(() =>
    useAuthSync({
      appId: entry.appId as ValidAppId,
      localStorageKey: entry.key,
      getState: () => entry.store.getState().getProgress() as AppProgressData,
      setState: (data) => entry.store.getState().setProgress(data as never),
      debounceMs: 1_000,
    })
  );

/** A page load: the store's defaults, then its save on disk. */
async function loadPage(entry: SyncedStoreEntry) {
  const saved = localStorage.getItem(entry.key);
  entry.reset();
  if (saved === null) localStorage.removeItem(entry.key);
  else localStorage.setItem(entry.key, saved);
  await entry.store.persist.rehydrate();
}

/** Puts `progress` on the account, as written at `iso`. */
function accountHolds(entry: SyncedStoreEntry, progress: Record<string, unknown>) {
  server.rows.set(`user-1:${entry.appId}`, { data: JSON.parse(JSON.stringify(progress)), updatedAt: new Date() });
}

/** The progress that `act` makes on a fresh store at `iso` (the store is reset after). */
function made(entry: SyncedStoreEntry, iso: string, act: () => void) {
  entry.reset();
  at(iso);
  act();
  const out = progressOf(entry);
  entry.reset();
  localStorage.removeItem(entry.key);
  return out;
}

beforeEach(() => {
  localStorage.clear();
  server.reset();
  installAudioMock();
  __unsafeResetForeignPurgeLockForTests();
  session.current = { data: null, status: "unauthenticated" };
  server.install(vi.stubGlobal);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  at("2026-10-20T13:00:00Z");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const entry of SYNCED_STORES) entry.reset();
});

describe("a new account: play while the first GET is in flight reaches the account", () => {
  const plays: Array<[string, () => void]> = [
    ["2048", () => ["up", "left", "down", "right", "up", "left"].forEach((d) => use2048Store.getState().move(d as never))],
    ["drum-machine", () => useDrumMachineStore.getState().saveBeat("First beat")],
    ["toy-finder", () => useToyFinderStore.getState().addToWishlist({ id: "t1" } as never, "need")],
  ];

  it.each(plays)("%s", async (appId, play) => {
    const entry = syncedStore(appId);
    await loadPage(entry);
    server.net.getDelayMs = 1_500;
    signIn();
    const view = mount(entry);
    await settle(250);
    play();
    const played = progressOf(entry);
    expect(extractTimestamp(played as AppProgressData)).toBeGreaterThan(0);
    // forceSync before the first sync is done: it saves when the sync is.
    await act(async () => {
      await view.result.current.forceSync();
    });
    await settle(4_000);
    view.unmount();
    expect(server.rejected).toEqual([]);
    expect(sameProgress(server.row(appId), played)).toBe(true);
  });
});

describe("a change during the first sync", () => {
  it("builds on the account when the device's save IS the account's progress: it is kept and saved", async () => {
    const entry = syncedStore("toy-finder");
    at("2026-10-20T11:00:00Z");
    useToyFinderStore.getState().addToWishlist({ id: "a" } as never, "need");
    accountHolds(entry, progressOf(entry));
    at("2026-10-20T13:00:00Z");
    // The account synced on this device before: its save is the account's.
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
    await loadPage(entry);
    server.net.getDelayMs = 1_500;
    signIn();
    const view = mount(entry);
    await settle(250);
    useToyFinderStore.getState().addToWishlist({ id: "b" } as never, "maybe");
    await settle(6_000);
    view.unmount();
    const ids = (server.row("toy-finder") as { wishlistItems: Array<{ toyId?: string; id?: string }> }).wishlistItems.map(
      (item) => item.toyId ?? item.id
    );
    expect(ids).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("on an old copy, when the account holds newer progress: the account wins", async () => {
    const entry = syncedStore("toy-finder");
    const account = made(entry, "2026-10-20T12:00:00Z", () => {
      useToyFinderStore.getState().addToWishlist({ id: "a" } as never, "need");
      useToyFinderStore.getState().addToWishlist({ id: "b" } as never, "need");
    });
    accountHolds(entry, account);
    // This device: an older save (09:00) with another wish, of this account
    // (it synced here before).
    at("2026-10-20T09:00:00Z");
    useToyFinderStore.getState().addToWishlist({ id: "x" } as never, "need");
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
    at("2026-10-20T13:00:00Z");
    await loadPage(entry);
    server.net.getDelayMs = 1_500;
    signIn();
    const view = mount(entry);
    await settle(250);
    useToyFinderStore.getState().addToWishlist({ id: "y" } as never, "maybe");
    await settle(6_000);
    view.unmount();
    expect(server.row("toy-finder")).toEqual(account);
    expect(sameProgress(progressOf(entry), account)).toBe(true);
  });
});

describe("a save that the server refuses", () => {
  it("a 400 at the first sync is sent once; the page is ready and keeps its progress", async () => {
    const entry = syncedStore("toy-finder");
    useToyFinderStore.getState().addToWishlist({ id: "t1" } as never, "need");
    const device = progressOf(entry);
    server.net.postStatus = 400;
    signIn();
    const view = mount(entry);
    await settle(1_000);
    expect(view.result.current.ready).toBe(true);
    await settle(5 * 60_000);
    view.unmount();
    expect(server.posts.length).toBe(1);
    expect(server.gets).toBe(1);
    expect(sameProgress(progressOf(entry), device)).toBe(true);
  });

  it("a 500 at the first sync tries again, and the sync completes when the server is back", async () => {
    const entry = syncedStore("toy-finder");
    useToyFinderStore.getState().addToWishlist({ id: "t1" } as never, "need");
    const device = progressOf(entry);
    server.net.postStatus = 500;
    signIn();
    const view = mount(entry);
    await settle(8_000);
    expect(server.posts.length).toBeGreaterThan(1);
    server.net.postStatus = 0;
    await settle(40_000);
    view.unmount();
    expect(sameProgress(server.row("toy-finder"), device)).toBe(true);
  });
});

describe("ready", () => {
  it("is false while the account cannot be reached, and true after READY_FALLBACK_MS", async () => {
    const entry = syncedStore("virtual-pet");
    server.net.failGets = 1_000;
    signIn();
    const view = mount(entry);
    await settle(READY_FALLBACK_MS - 500);
    expect(view.result.current.ready).toBe(false);
    await settle(1_000);
    expect(view.result.current.ready).toBe(true);
    view.unmount();
  });

  it("for a guest at once", async () => {
    session.current = { data: null, status: "unauthenticated" };
    const view = mount(syncedStore("virtual-pet"));
    expect(view.result.current.ready).toBe(true);
    view.unmount();
  });
});

describe("another tab saves newer progress", () => {
  /** What the browser delivers to THIS tab when another tab writes the key. */
  function otherTabWrites(key: string, raw: string) {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw }));
  }

  it("this tab takes it before its next change, so the stale tab never replaces it", async () => {
    const entry = syncedStore("toy-finder");
    signIn();
    const view = mount(entry);
    await settle(1_000);
    // Tab 1 (another tab) adds "lego" at 13:01: its save lands on disk.
    const lego = made(entry, "2026-10-20T13:01:00Z", () =>
      useToyFinderStore.getState().addToWishlist({ id: "lego" } as never, "need")
    );
    const raw = JSON.stringify({ state: { ...lego, progressTimeV: 1 }, version: 0 });
    localStorage.setItem(entry.key, raw);
    accountHolds(entry, lego);
    otherTabWrites(entry.key, raw);
    // This tab (stale until now) adds "ball" at 13:05.
    at("2026-10-20T13:05:00Z");
    useToyFinderStore.getState().addToWishlist({ id: "ball" } as never, "maybe");
    await settle(4_000);
    view.unmount();
    const ids = JSON.stringify(server.row("toy-finder"));
    expect(ids).toContain("lego");
    expect(ids).toContain("ball");
  });

  it("an older save, or an untouched save of the old code, is not taken", async () => {
    const entry = syncedStore("toy-finder");
    at("2026-10-20T13:10:00Z");
    useToyFinderStore.getState().addToWishlist({ id: "mine" } as never, "need");
    const mine = progressOf(entry);
    const view = mount(entry);
    await settle(500);
    const older = { ...mine, wishlistItems: [], lastModified: Date.parse("2026-10-20T13:00:00Z") };
    otherTabWrites(entry.key, JSON.stringify({ state: { ...older, progressTimeV: 1 }, version: 0 }));
    // The old code's untouched defaults, with a page-load time newer than mine.
    const oldDefaults = { wishlistItems: [], recentlyViewed: [], lastModified: Date.parse("2026-10-20T14:00:00Z") };
    otherTabWrites(entry.key, JSON.stringify({ state: oldDefaults, version: 0 }));
    view.unmount();
    expect(sameProgress(progressOf(entry), mine)).toBe(true);
  });
});

describe("the account's untouched progress (findings 2 and 10; wave 5: no cutoff)", () => {
  // The old code uploaded untouched defaults with the page-load time. It can
  // still write such a row after the deploy: a tab that runs it, a rollback,
  // a late deploy, a clock that runs ahead. The new code never uploads
  // untouched progress, so an untouched row gives way whatever its time.
  it.each([
    ["before the deploy", "2026-09-20T08:00:00Z"],
    ["after the deploy (an old tab, a rollback)", "2026-10-22T08:00:00Z"],
    ["from a clock that runs ahead", "2027-03-01T08:00:00Z"],
  ])("an old-code row of untouched defaults (%s) gives way to the device's real progress, and keeps its records", async (_when, iso) => {
    const entry = syncedStore("virtual-pet");
    // The old code uploaded an untouched pet, aged by time: it unlocked
    // Pupper, with a page-load time.
    const row = {
      ...made(entry, "2026-09-01T12:00:00Z", () => {}),
      unlockedSpecies: ["blobby", "pupper"],
      lastModified: Date.parse(iso),
    };
    expect(isUntouchedProgress("virtual-pet", row)).toBe(true);
    accountHolds(entry, row);
    // The device: a real pet from 2026-09-10.
    at("2026-09-10T12:00:00Z");
    useVirtualPetStore.getState().renamePet("Rex");
    at("2026-10-20T13:00:00Z");
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    const account = server.row("virtual-pet") as VirtualPetProgress;
    expect(account.pet.name).toBe("Rex");
    expect(account.unlockedSpecies).toEqual(expect.arrayContaining(["blobby", "pupper"]));
    expect(useVirtualPetStore.getState().progress.unlockedSpecies).toContain("pupper");
  });

  it("a row that changed only a setting (the old code uploaded it) gives way to an older device's real wins, which reach the account", async () => {
    const entry = syncedStore("quoridor");
    const row = made(entry, "2026-10-20T10:00:00Z", () => useQuoridorStore.getState().setDifficulty("medium"));
    expect(isUntouchedProgress("quoridor", row)).toBe(true);
    accountHolds(entry, row);
    // An older device with real wins (09:00).
    at("2026-10-20T09:00:00Z");
    useQuoridorStore.setState((state) => ({
      progress: { ...state.progress, gamesPlayed: 4, gamesWon: 3, bestWinStreak: 2, lastModified: Date.now() },
    }));
    at("2026-10-20T13:00:00Z");
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    const account = server.row("quoridor") as Record<string, unknown>;
    expect(account.gamesPlayed).toBe(4);
    expect(account.gamesWon).toBe(3);
    expect(account.bestWinStreak).toBe(2);
  });

  it("a change to a setting alone uploads nothing (no save path sends untouched progress), so it never becomes the base of the merge", async () => {
    const entry = syncedStore("quoridor");
    signIn();
    const view = mount(entry);
    await settle(1_000);
    useQuoridorStore.getState().setDifficulty("medium");
    expect(isUntouchedProgress("quoridor", progressOf(entry))).toBe(true);
    expect(extractTimestamp(progressOf(entry) as AppProgressData)).toBeGreaterThan(0);
    await settle(4_000);
    await act(async () => {
      await view.result.current.forceSync();
    });
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    // The fake server records the unload and unmount beacons as posts too.
    expect(server.posts).toEqual([]);
  });

  it("joke-generator: 25 jokes read on the account are never replaced by an older device's 2", async () => {
    const entry = syncedStore("joke-generator");
    const read = (n: number, prefix: string) => () => {
      for (let i = 0; i < n; i++) {
        useJokeStore.getState().markJokeSeen(`${prefix}${i}`);
        useJokeStore.getState().incrementViewed();
      }
    };
    // A touched row: the untouched-row override never takes it.
    const row = made(entry, "2026-10-02T13:00:00Z", read(25, "b"));
    expect(isUntouchedProgress("joke-generator", row)).toBe(false);
    accountHolds(entry, row);
    // An older device of this account (it synced here before).
    at("2026-10-02T09:00:00Z");
    read(2, "a")();
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
    at("2026-10-02T14:00:00Z");
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    const account = server.row("joke-generator") as { jokesViewed: number; seenJokeIds: string[] };
    expect(account.jokesViewed).toBe(25);
    expect(account.seenJokeIds).toHaveLength(25);
  });

  it("drawing-app: the production row shape (defaults with no savedArtworks key) is untouched, and an older device's drawings replace it", async () => {
    const entry = syncedStore("drawing-app");
    const defaults = made(entry, "2026-01-02T15:00:00Z", () => {});
    const { savedArtworks: _dropped, ...rowShape } = defaults;
    void _dropped;
    const row = { ...rowShape, lastModified: Date.parse("2026-01-02T15:00:00Z") };
    expect(isUntouchedProgress("drawing-app", row)).toBe(true);
    accountHolds(entry, row);
    at("2025-12-31T18:00:00Z");
    useDrawingStore.getState().saveArtwork("data:image/png;base64,AAAA", "Truck");
    useDrawingStore.getState().saveArtwork("data:image/png;base64,BBBB", "Dog");
    const device = progressOf(entry);
    at("2026-10-20T13:00:00Z");
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    expect(server.rejected).toEqual([]);
    expect((server.row("drawing-app") as { stats: { artworksCreated: number } }).stats.artworksCreated).toBe(2);
    expect(sameProgress(progressOf(entry), device)).toBe(true);
  });
});

describe("virtual-pet: what time alone earned, and a pet that only changed a setting", () => {
  it("an untouched pet visited 10 days in a row: the account keeps its own pet, and gains the species and the streak", async () => {
    const entry = syncedStore("virtual-pet");
    const account = {
      ...made(entry, "2026-10-01T10:00:00Z", () => useVirtualPetStore.getState().renamePet("Rex")),
      coins: 70,
    };
    accountHolds(entry, account);
    // This device, as a guest: the page opens on 10 days; the kid never feeds or names the pet.
    // (The default pet was born when the store loaded: 2026-10-20 13:00.)
    for (let day = 0; day < 10; day++) {
      vi.setSystemTime(new Date(Date.parse("2026-10-21T12:00:00Z") + day * DAY));
      useVirtualPetStore.getState().updateFromTime();
    }
    const device = useVirtualPetStore.getState().progress;
    expect(device.lastModified).toBe(0);
    expect(device.unlockedSpecies).toEqual(["blobby", "kitcat", "pupper"]);
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    const row = server.row("virtual-pet") as VirtualPetProgress;
    expect(row.pet.name).toBe("Rex");
    expect(row.coins).toBe(70);
    expect(row.unlockedSpecies).toEqual(expect.arrayContaining(["kitcat", "pupper"]));
    expect(row.stats.longestStreak).toBe(10);
    expect(row.stats.currentStreak).toBe(10);
  });

  it("a guest who only turned the sound off never replaces the account's pet", async () => {
    const entry = syncedStore("virtual-pet");
    const account = made(entry, "2026-10-01T10:00:00Z", () => useVirtualPetStore.getState().renamePet("Rex"));
    accountHolds(entry, account);
    at("2026-10-20T12:00:00Z");
    useVirtualPetStore.getState().toggleSound();
    expect(useVirtualPetStore.getState().progress.lastModified).toBeGreaterThan(0);
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    expect((server.row("virtual-pet") as VirtualPetProgress).pet.name).toBe("Rex");
    expect(useVirtualPetStore.getState().progress.pet.name).toBe("Rex");
  });

  it("the minute update keeps the time when only the needs move; a visit on a new day stamps a played pet", () => {
    at("2026-10-20T09:00:00Z");
    useVirtualPetStore.getState().renamePet("Rex");
    useVirtualPetStore.getState().updateFromTime();
    const visited = useVirtualPetStore.getState().progress.lastModified;
    at("2026-10-20T15:00:00Z");
    useVirtualPetStore.getState().updateFromTime();
    expect(useVirtualPetStore.getState().progress.pet.hunger).toBeLessThan(80);
    expect(useVirtualPetStore.getState().progress.lastModified).toBe(visited);
    at("2026-10-21T09:00:00Z");
    useVirtualPetStore.getState().updateFromTime();
    expect(useVirtualPetStore.getState().progress.stats.currentStreak).toBe(2);
    expect(useVirtualPetStore.getState().progress.lastModified).toBe(Date.parse("2026-10-21T09:00:00Z"));
  });
});
