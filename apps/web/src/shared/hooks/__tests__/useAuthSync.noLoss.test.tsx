/**
 * Regression coverage for offline play, first-read races, untouched saves and
 * clock behavior using real stores. Unknown ancestry now requires explicit
 * choice, with both original versions retained. The historical raw-storage
 * fixture isolates reconciliation; owner-guard and roundtrip use real authority.
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
vi.mock("@/shared/components/FullscreenButton", () => ({ FullscreenButton: () => null }));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { validateProgress } from "@/lib/progress-schemas";
import { extractTimestamp } from "@/lib/progress-merge";
import { sameProgress } from "@/shared/lib/progressStamp";
import { isUntouchedProgress, progressFromSave } from "@/shared/lib/untouchedProgress";
import { SYNCED_STORES, syncedStore, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { installAudioMock } from "@/__tests__/audio-mock";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { useFlappyStore } from "@/games/flappy-bird/lib/store";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import { useToyFinderStore } from "@/apps/toy-finder/lib/store";
import { useVirtualPetStore, type VirtualPetProgress } from "@/apps/virtual-pet/lib/store";
import { VirtualPet } from "@/apps/virtual-pet/VirtualPet";

const server = createProgressServer(session);
const HOUR = 3_600_000;

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const settle = async (ms: number) => {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => {
      await realDelay(5);
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
    });
  }
};
const signIn = () => {
  session.current = { data: { user: { id: "user-1" } }, status: "authenticated" };
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const progressOf = (entry: SyncedStoreEntry) => clone(entry.store.getState().getProgress()) as Record<string, unknown>;
const timeOf = (data: unknown) => extractTimestamp(data as AppProgressData) ?? 0;
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

/** Resolve unknown lineage only after asserting the retained alternatives. */
async function choose(appId: string, select: (data: AppProgressData) => boolean) {
  const entry = progressSyncPresentation.getSnapshot().find(row => row.appId === appId)!;
  expect(entry.status).toBe("conflict");
  const dialog = entry.open()!;
  const option = dialog.options.find(row => select(row.data));
  expect(option).toBeDefined();
  server.net.getDelayMs = 0;
  await act(async () => { expect(await dialog.choose(option!.id)).toMatchObject({ ok: true }); });
  return dialog;
}

/** A page load: the store's defaults, then its save on disk. */
async function loadPage(entry: SyncedStoreEntry) {
  const saved = localStorage.getItem(entry.key);
  entry.reset();
  if (saved === null) localStorage.removeItem(entry.key);
  else localStorage.setItem(entry.key, saved);
  await entry.store.persist.rehydrate();
}

/** Puts `progress` on the account. */
function accountHolds(entry: SyncedStoreEntry, progress: Record<string, unknown>) {
  server.rows.set(`user-1:${entry.appId}`, { data: clone(progress) as AppProgressData, updatedAt: new Date() });
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

/** This device synced the account before (the owner key). */
function thisAccountsDevice() {
  localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const entry of SYNCED_STORES) entry.reset();
});

// ---------------------------------------------------------------------------
// F1: the device's own progress at sign-in
// ---------------------------------------------------------------------------

describe("F1: the device's offline progress is retained for explicit recovery", () => {
  it("a device of this account plays while the account cannot be reached; on the next load its offline play remains selectable", async () => {
    const entry = syncedStore("toy-finder");
    accountHolds(entry, made(entry, "2026-10-20T11:00:00Z", () => useToyFinderStore.getState().addToWishlist({ id: "a" } as never, "need")));
    // The first sync here takes the account's progress.
    signIn();
    let view = mount(entry);
    await settle(3_000);
    view.unmount();
    // Offline: the kid removes "a" and adds "b"; nothing reaches the account.
    server.net.failGets = 1_000;
    server.net.postStatus = 503;
    at("2026-10-20T14:00:00Z");
    await loadPage(entry);
    view = mount(entry);
    await settle(500);
    useToyFinderStore.getState().removeFromWishlist("a");
    useToyFinderStore.getState().addToWishlist({ id: "b" } as never, "need");
    await settle(1_000);
    view.unmount();
    // Online again, a new page load.
    server.net.failGets = 0;
    server.net.postStatus = 0;
    at("2026-10-20T15:00:00Z");
    await loadPage(entry);
    view = mount(entry);
    await settle(6_000);
    const copies = await choose("toy-finder", data => JSON.stringify(data).includes('"toyId":"b"'));
    expect(copies.options.some(option => JSON.stringify(option.data).includes('"toyId":"a"'))).toBe(true);
    view.unmount();
    const ids = (server.row("toy-finder") as { wishlistItems: Array<{ toyId: string }> }).wishlistItems.map((item) => item.toyId);
    expect(ids).toEqual(["b"]);
  });

  it("the account has no progress for the game: the guest's progress goes up whole", async () => {
    const entry = syncedStore("drum-machine");
    useDrumMachineStore.getState().saveBeat("Guest beat");
    const guest = progressOf(entry);
    await loadPage(entry);
    signIn();
    const view = mount(entry);
    await settle(4_000);
    view.unmount();
    expect(sameProgress(server.row("drum-machine"), guest)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F3: a record set while the first sync is in flight
// ---------------------------------------------------------------------------

describe("F3: a new high score set while the first GET is in flight reaches the account", () => {
  function round(score: number) {
    useFlappyStore.setState({ score } as never);
    useFlappyStore.getState().endGame();
  }

  it.each([
    ["a blank second device", false],
    ["an older device of this account", true],
  ])("%s", async (_label, older) => {
    const entry = syncedStore("flappy-bird");
    accountHolds(
      entry,
      made(entry, "2026-10-20T11:00:00Z", () =>
        useFlappyStore.getState().setProgress({ ...useFlappyStore.getState().getProgress(), highScore: 10, gamesPlayed: 20, lastModified: Date.now() })
      )
    );
    if (older) {
      at("2026-10-19T11:00:00Z");
      useFlappyStore.getState().setProgress({ ...useFlappyStore.getState().getProgress(), highScore: 8, gamesPlayed: 5, lastModified: Date.now() });
      thisAccountsDevice();
    }
    at("2026-10-20T12:00:00Z");
    await loadPage(entry);
    server.net.getDelayMs = 1_500;
    signIn();
    const view = mount(entry, 2_000);
    await settle(400);
    round(50);
    await settle(10_000);
    expect((server.row("flappy-bird") as { highScore: number }).highScore).toBe(10);
    const copies = await choose("flappy-bird", data => data.highScore === 50);
    expect(copies.options.some(option => option.data.highScore === 10 && option.data.gamesPlayed === 20)).toBe(true);
    view.unmount();
    expect(server.rejected).toEqual([]);
    expect(useFlappyStore.getState().getProgress().highScore).toBe(50);
    expect((server.row("flappy-bird") as { highScore: number }).highScore).toBe(50);
    expect((server.row("flappy-bird") as { gamesPlayed: number }).gamesPlayed).toBe(older ? 6 : 1);
  });
});

// ---------------------------------------------------------------------------
// F7: another tab saves newer progress while this tab has an unsaved record
// ---------------------------------------------------------------------------

describe("F7: another tab's newer save never drops this tab's unsaved record", () => {
  it("this tab's new high score stays, and reaches the account", async () => {
    const entry = syncedStore("flappy-bird");
    accountHolds(
      entry,
      made(entry, "2026-10-20T11:00:00Z", () =>
        useFlappyStore.getState().setProgress({ ...useFlappyStore.getState().getProgress(), highScore: 10, gamesPlayed: 3, lastModified: Date.now() })
      )
    );
    at("2026-10-20T12:00:00Z");
    signIn();
    const view = mount(entry, 2_000);
    await settle(2_000);
    // 12:05: a high score of 50 in this tab (its save is still pending).
    at("2026-10-20T12:05:00Z");
    useFlappyStore.setState({ score: 50 } as never);
    useFlappyStore.getState().endGame();
    // A stale tab (it missed this tab's save) plays a round of 3 a moment later.
    const theirs = { ...progressOf(entry), highScore: 10, gamesPlayed: 4, lastModified: Date.now() + 500 };
    window.dispatchEvent(
      new StorageEvent("storage", { key: entry.key, newValue: JSON.stringify({ state: { progress: theirs, progressTimeV: 1 }, version: 0 }) })
    );
    expect(useFlappyStore.getState().getProgress().highScore).toBe(50);
    expect(useFlappyStore.getState().getProgress().gamesPlayed).toBe(4);
    await settle(6_000);
    view.unmount();
    expect((server.row("flappy-bird") as { highScore: number }).highScore).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Findings A1 and A3: untouched progress never uploads, and a row of it
// gives way whatever its time
// ---------------------------------------------------------------------------

describe("no save sends progress that the store's rule calls untouched", () => {
  it.each(SYNCED_STORES.map((entry) => [entry.appId, entry] as const))(
    "%s: the defaults with a new time (a setting or a phase changed) never leave the device",
    async (_id, entry) => {
      const untouched = { ...progressOf(entry), [entry.timeKey]: Date.now() };
      expect(isUntouchedProgress(entry.appId, untouched)).toBe(true);
      signIn();
      const view = mount(entry);
      await settle(1_000);
      entry.store.getState().setProgress(untouched as never);
      await settle(4_000);
      await act(async () => {
        await view.result.current.forceSync();
      });
      window.dispatchEvent(new Event("beforeunload"));
      view.unmount();
      await settle(100);
      expect(server.posts).toEqual([]);
    }
  );

  it("oregon-trail: device A's Start tap uploads nothing, so device B's guest journey from the day before still reaches the account", async () => {
    const entry = syncedStore("oregon-trail");
    // Device A: signed in, nothing on the account; the kid taps Start.
    signIn();
    let view = mount(entry);
    await settle(1_000);
    useOregonTrailStore.getState().setPhase("setup_name");
    await settle(4_000);
    view.unmount();
    expect(server.posts).toEqual([]);
    // Device B: a guest journey from the day before; it signs in two days later.
    entry.reset();
    localStorage.clear();
    session.current = { data: null, status: "unauthenticated" };
    at("2026-10-19T13:00:00Z");
    useOregonTrailStore.getState().startGame("Hank", "carpenter", ["A", "B"], "may");
    at("2026-10-22T13:00:00Z");
    await loadPage(entry);
    signIn();
    view = mount(entry);
    await settle(4_000);
    view.unmount();
    expect((server.row("oregon-trail") as { leaderName: string }).leaderName).toBe("Hank");
    expect(useOregonTrailStore.getState().leaderName).toBe("Hank");
  });

  it("drawing-app: a row that holds only the grid switch (written after the deploy by the old code) gives way to this device's older drawing", async () => {
    const entry = syncedStore("drawing-app");
    const row = made(entry, "2026-10-25T09:00:00Z", () => useDrawingStore.getState().toggleGrid());
    expect(isUntouchedProgress("drawing-app", row)).toBe(true);
    accountHolds(entry, { ...row, lastModified: Date.parse("2026-10-25T09:00:00Z") });
    // This account's device: a drawing from the day before the row.
    at("2026-10-24T09:00:00Z");
    useDrawingStore.getState().saveArtwork("data:image/png;base64,AAAA", "Truck");
    thisAccountsDevice();
    at("2026-10-26T09:00:00Z");
    await loadPage(entry);
    signIn();
    const view = mount(entry);
    await settle(4_000);
    await choose("drawing-app", data => JSON.stringify(data).includes("Truck"));
    view.unmount();
    expect(server.rejected).toEqual([]);
    expect(JSON.stringify(server.row("drawing-app"))).toContain("Truck");
    expect(useDrawingStore.getState().savedArtworks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// F2 and F5: Virtual Pet, with the real page
// ---------------------------------------------------------------------------

describe("Virtual Pet: the visit and the clock", () => {
  const entry = syncedStore("virtual-pet");

  /** A pet that the account or a device holds. */
  function pet(name: string, coins: number, checked: string, lastModified: string) {
    const base = clone(useVirtualPetStore.getState().getProgress());
    return {
      ...base,
      pet: { ...base.pet, name, bornAt: "2026-10-01T09:00:00.000Z", lastChecked: checked },
      coins,
      stats: { ...base.stats, currentStreak: 1, longestStreak: 2, lastPlayDate: new Date(checked).toDateString() },
      settings: { ...base.settings, petName: name },
      lastModified: Date.parse(lastModified),
    } as VirtualPetProgress;
  }

  it("F2: an old device of this account opened during an outage: the visit on the old copy keeps its time, and the account's newer pet wins", async () => {
    const account = pet("Rex", 350, "2026-10-20T11:00:00.000Z", "2026-10-20T11:00:00Z");
    accountHolds(entry, account as never);
    useVirtualPetStore.getState().setProgress(pet("Oldie", 10, "2026-10-19T09:00:00.000Z", "2026-10-19T09:00:00Z"));
    await useVirtualPetStore.persist.rehydrate();
    thisAccountsDevice();
    at("2026-10-20T13:00:00Z");
    signIn();
    server.net.failGets = 1_000;
    render(<VirtualPet />);
    await settle(12_000);
    // The page runs on the old copy: the new day's visit counts, with no stamp.
    expect(useVirtualPetStore.getState().progress.stats.lastPlayDate).toBe(new Date().toDateString());
    expect(useVirtualPetStore.getState().progress.lastModified).toBe(Date.parse("2026-10-19T09:00:00Z"));
    server.net.failGets = 0;
    await settle(45_000);
    const copies = await choose("virtual-pet", data => (data.pet as { name: string }).name === "Rex");
    expect(copies.options.some(option => (option.data.pet as { name: string }).name === "Oldie")).toBe(true);
    const row = server.row("virtual-pet") as VirtualPetProgress;
    expect(server.rejected).toEqual([]);
    expect(row.pet.name).toBe("Rex");
    expect(row.coins).toBe(350);
    expect(useVirtualPetStore.getState().progress.pet.name).toBe("Rex");
  });

  it("F5: a pet checked on a clock that runs ahead keeps its needs at 100 or less, and the server takes its saves", async () => {
    const ahead = {
      ...pet("Skew", 0, new Date(Date.now() + 3 * HOUR).toISOString(), "2026-10-20T12:00:00Z"),
    };
    ahead.pet = { ...ahead.pet, energy: 95, cleanliness: 95, hunger: 95, happiness: 95 };
    accountHolds(entry, ahead as never);
    signIn();
    render(<VirtualPet />);
    await settle(3_000);
    useVirtualPetStore.getState().renamePet("Skewy");
    await settle(70_000);
    const progress = useVirtualPetStore.getState().progress;
    for (const need of ["hunger", "happiness", "energy", "cleanliness"] as const) {
      expect(progress.pet[need]).toBeLessThanOrEqual(100);
    }
    expect(validateProgress("virtual-pet", progress).success).toBe(true);
    expect(server.rejected).toEqual([]);
    expect((server.row("virtual-pet") as VirtualPetProgress).pet.name).toBe("Skewy");
  });

  it("F5: the time update with a last check in the future (store)", () => {
    useVirtualPetStore.getState().renamePet("Future");
    const state = useVirtualPetStore.getState().progress;
    useVirtualPetStore.getState().setProgress({
      ...state,
      pet: { ...state.pet, energy: 99, cleanliness: 99, sleeping: true, lastChecked: new Date(Date.now() + 30 * HOUR).toISOString() },
    });
    useVirtualPetStore.getState().updateFromTime();
    const after = useVirtualPetStore.getState().progress;
    expect(after.pet.energy).toBe(99);
    expect(after.pet.cleanliness).toBe(99);
    expect(validateProgress("virtual-pet", after).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding C: a save of the old code with no time is settled once
// ---------------------------------------------------------------------------

describe("a played save of the old code with no time keeps one time across loads", () => {
  it.each([["hill-climb"], ["monster-truck"], ["oregon-trail"]])("%s", async (appId) => {
    const entry = syncedStore(appId);
    const played = progressOf(entry);
    // The old code's save: a played progress with no time and no marker.
    const legacyProgress: Record<string, unknown> = { ...played };
    delete legacyProgress.lastModified;
    if (appId === "oregon-trail") legacyProgress.leaderName = "Old Kid";
    else legacyProgress.coins = 777;
    localStorage.setItem(entry.key, JSON.stringify({ state: legacyProgress, version: entry.store.persist.getOptions().version ?? 0 }));
    at("2026-10-05T09:00:00Z");
    await loadPage(entry);
    const first = timeOf(progressOf(entry));
    expect(first).toBe(Date.parse("2026-10-05T09:00:00Z"));
    at("2026-10-07T09:00:00Z");
    await loadPage(entry);
    expect(timeOf(progressOf(entry))).toBe(first);
    expect(timeOf(progressFromSave(appId, JSON.parse(localStorage.getItem(entry.key)!).state))).toBe(first);
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
