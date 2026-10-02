/**
 * The account and the device after sign-out and sign-in, on a second
 * device, and across the deploy of the sync-time fix, with the REAL stores
 * of all synced games, the real useAuthSync, and a server that runs the real
 * validateProgress and mergeForSave (review waves 2 and 3 of #26i).
 *
 * The clock is a real day: the kid plays at 12:00, and the next page loads
 * at 13:05, as after a sign-out and sign-in, or on a second device. Before
 * the fix, the stores' default progress carried the page-load time, so it
 * was NEWER than the kid's save and replaced it on the account: the pet,
 * the saved beats, the wishlist, the journey and the coins.
 *
 * The played progress of each store comes from fixtures/legacy-saves.json
 * (the old store code wrote it), so it is the real shape of each game.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const session = vi.hoisted(() => ({
  current: { data: null as null | { user: { id: string } }, status: "unauthenticated" as string },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => session.current,
  signOut: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";
import { signOutAndClear } from "@/lib/auth-client";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { validateProgress } from "@/lib/progress-schemas";
import { extractTimestamp, mergeForSave } from "@/lib/progress-merge";
import { sameProgress } from "@/shared/lib/progressStamp";
import { SYNCED_STORES, syncedStore, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { installAudioMock } from "@/__tests__/audio-mock";
import legacy from "@/__tests__/fixtures/legacy-saves.json";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";

type Save = { state: Record<string, unknown>; version: number };
const SAVES = legacy.saves as unknown as Record<string, Record<string, Save>>;

// The server: one row per user and app, the real validation and merge.
const rows = new Map<string, { data: AppProgressData; updatedAt: Date }>();
const rejected: string[] = [];
const posts: Array<{ appId: string; merge: boolean }> = [];

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function server(url: string, init?: RequestInit) {
  const appId = url.split("/").pop() as ValidAppId;
  const userId = session.current.data?.user.id;
  const key = `${userId}:${appId}`;
  if (!init?.method || init.method === "GET") {
    const row = rows.get(key);
    return respond(
      row ? { data: row.data, lastSyncedAt: row.updatedAt.toISOString() } : { data: null, lastSyncedAt: null }
    );
  }
  const { data, merge } = JSON.parse(init.body as string) as { data: AppProgressData; merge?: boolean };
  posts.push({ appId, merge: !!merge });
  const valid = validateProgress(appId, data);
  if (!valid.success) {
    rejected.push(`${appId}: ${valid.error}`);
    return respond({ error: valid.error }, 400);
  }
  let final = valid.data as AppProgressData;
  const existing = rows.get(key);
  if (merge && existing) {
    const merged = validateProgress(appId, mergeForSave(final, existing).data);
    if (merged.success) final = merged.data as AppProgressData;
  }
  rows.set(key, { data: final, updatedAt: new Date() });
  return respond({ success: true, updatedAt: new Date().toISOString() });
}

const progressOf = (entry: SyncedStoreEntry) =>
  JSON.parse(JSON.stringify(entry.store.getState().getProgress())) as AppProgressData;
const rowOf = (entry: SyncedStoreEntry, user = "user-1") => rows.get(`${user}:${entry.appId}`)?.data;
const timeOf = (data: AppProgressData | undefined) => (data ? extractTimestamp(data) : null);

const mount = (entry: SyncedStoreEntry) =>
  renderHook(() =>
    useAuthSync({
      appId: entry.appId as ValidAppId,
      localStorageKey: entry.key,
      getState: () => entry.store.getState().getProgress() as AppProgressData,
      setState: (data) => entry.store.getState().setProgress(data as never),
      debounceMs: 1000,
    })
  );

/** A page load: the store's defaults, then its save on disk (a load writes nothing). */
async function loadPage(entry: SyncedStoreEntry) {
  const saved = localStorage.getItem(entry.key);
  entry.reset();
  if (saved === null) localStorage.removeItem(entry.key);
  else localStorage.setItem(entry.key, saved);
  await entry.store.persist.rehydrate();
}

const settle = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const signIn = (id = "user-1") => {
  session.current = { data: { user: { id } }, status: "authenticated" };
};

/**
 * The kid plays now: the store takes the played progress of the fixture (a
 * real save of the game) and a player's change stamps it with now.
 */
async function play(entry: SyncedStoreEntry) {
  const keep = localStorage.getItem(entry.key);
  localStorage.setItem(entry.key, JSON.stringify(SAVES[entry.appId].played));
  await entry.store.persist.rehydrate();
  if (keep === null) localStorage.removeItem(entry.key);
  entry.store.getState().setProgress({ ...progressOf(entry), [entry.timeKey]: Date.now() } as never);
}

/** The kid plays at 12:00, signed in, and the progress syncs. */
async function playAndSync(entry: SyncedStoreEntry) {
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  await loadPage(entry);
  signIn();
  const view = mount(entry);
  await settle(1_000);
  await play(entry);
  await settle(6_000);
  view.unmount();
  const row = rowOf(entry);
  expect(row, `${entry.appId}: the play reached the account`).toBeDefined();
  expect(timeOf(row)).toBe(Date.parse("2026-10-02T12:00:01Z"));
  return JSON.parse(JSON.stringify(row)) as AppProgressData;
}

beforeEach(() => {
  localStorage.clear();
  rows.clear();
  rejected.length = 0;
  posts.length = 0;
  installAudioMock();
  __unsafeResetForeignPurgeLockForTests();
  session.current = { data: null, status: "unauthenticated" };
  vi.stubGlobal("fetch", vi.fn(server));
  Object.defineProperty(navigator, "sendBeacon", { value: vi.fn(() => true), configurable: true, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const entry of SYNCED_STORES) entry.reset();
});

const cases = SYNCED_STORES.map((entry) => [entry.appId, entry] as const);

describe.each(cases)("%s: a page that loads after the last save", (_appId, entry) => {
  it("sign out, then sign in again on the same device: the account keeps its progress", async () => {
    const before = await playAndSync(entry);

    vi.setSystemTime(new Date("2026-10-02T12:30:00Z"));
    await signOutAndClear("/");
    session.current = { data: null, status: "unauthenticated" };
    expect(localStorage.getItem(entry.key)).toBeNull();

    // The sign-in round trip is a new page load, at 13:05.
    vi.setSystemTime(new Date("2026-10-02T13:05:00Z"));
    await loadPage(entry);
    signIn();
    const view = mount(entry);
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    // The account's progress is exactly what it was, and the device shows it.
    expect(rowOf(entry)).toEqual(before);
    expect(sameProgress(progressOf(entry), before)).toBe(true);
  });

  it("a second device: the account keeps its progress, and the untouched device uploads nothing", async () => {
    const before = await playAndSync(entry);

    // Device 2: nothing saved, the page loads at 13:05.
    localStorage.clear();
    vi.setSystemTime(new Date("2026-10-02T13:05:00Z"));
    await loadPage(entry);
    const postsBefore = posts.length;
    const view = mount(entry);
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    expect(rowOf(entry)).toEqual(before);
    expect(posts.length).toBe(postsBefore);
    expect(sameProgress(progressOf(entry), before)).toBe(true);
  });
});

describe.each(cases)("%s: after the deploy, a device with a save of the old code", (_appId, entry) => {
  it("an untouched old save (newer page-load time) never replaces the account's older progress", async () => {
    // The account: real progress from the day before the old save.
    vi.setSystemTime(new Date("2026-08-31T10:00:00Z"));
    await play(entry);
    const account = progressOf(entry);
    rows.set(`user-1:${entry.appId}`, { data: account, updatedAt: new Date() });

    // The device: the old code's untouched save (page-load time 2026-09-01).
    localStorage.clear();
    localStorage.setItem(entry.key, JSON.stringify(SAVES[entry.appId].untouched));
    vi.setSystemTime(new Date("2026-10-02T13:05:00Z"));
    await loadPage(entry);
    signIn();
    const view = mount(entry);
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    expect(rowOf(entry)).toEqual(account);
    expect(sameProgress(progressOf(entry), account)).toBe(true);
  });

  it("the account's untouched progress (uploaded by the old code with a page-load time) never wins over real progress", async () => {
    // The device: real progress from 2026-09-01 12:00.
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    await play(entry);
    const device = progressOf(entry);

    // The account: the old code uploaded untouched defaults stamped later.
    const untouched = (() => {
      entry.reset();
      return { ...progressOf(entry), [entry.timeKey]: Date.parse("2026-09-20T08:00:00Z") };
    })();
    rows.set(`user-1:${entry.appId}`, { data: untouched, updatedAt: new Date() });
    entry.store.getState().setProgress(device as never);

    vi.setSystemTime(new Date("2026-10-02T13:05:00Z"));
    signIn();
    const view = mount(entry);
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    expect(sameProgress(rowOf(entry), device)).toBe(true);
    expect(sameProgress(progressOf(entry), device)).toBe(true);
  });
});

/** A little progress on the account: less than the device's old save holds. */
const SMALLER_ACCOUNT: Record<string, Record<string, unknown>> = {
  "hill-climb": { coins: 5, totalCoinsEarned: 5 },
  "monster-truck": { coins: 5, totalCoinsEarned: 5 },
  "oregon-trail": { pace: "grueling" },
};

describe.each([["hill-climb"], ["monster-truck"], ["oregon-trail"]])(
  "%s: an old save with no time and more progress than the account",
  (appId) => {
    it("keeps the device's progress (the old rule: the device wins)", async () => {
      const entry = syncedStore(appId);
      // The account: an older, smaller copy, uploaded on 2026-09-01.
      entry.reset();
      const account = {
        ...progressOf(entry),
        ...SMALLER_ACCOUNT[appId],
        lastModified: Date.parse("2026-09-01T12:00:00Z"),
      };
      rows.set(`user-1:${appId}`, { data: account, updatedAt: new Date() });

      // The device: the old code's played save, which had no time. The
      // account synced on this device before (the old code wrote the owner).
      localStorage.setItem(entry.key, JSON.stringify(SAVES[appId].played));
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      vi.setSystemTime(new Date("2026-10-02T13:05:00Z"));
      await loadPage(entry);
      const device = progressOf(entry);
      signIn();
      const view = mount(entry);
      await settle(6_000);
      view.unmount();

      expect(rejected).toEqual([]);
      expect(sameProgress(rowOf(entry), device, ["lastModified"])).toBe(true);
      expect(sameProgress(progressOf(entry), device, ["lastModified"])).toBe(true);
    });
  }
);

describe("a guest who plays and then signs in without a reload (review waves 3 and 5)", () => {
  /** The account: an older journey or progress, at 11:00. */
  async function accountAt11(entry: SyncedStoreEntry) {
    vi.setSystemTime(new Date("2026-10-02T11:00:00Z"));
    await play(entry);
    const account = progressOf(entry);
    rows.set(`user-1:${entry.appId}`, { data: account, updatedAt: new Date() });
    entry.reset();
    localStorage.clear();
    return account;
  }

  // The guest's play was built on the defaults, not on the account's
  // progress: its newer time must not make it the base of the merge (wave 5,
  // finding F1). The account's progress stays; the guest's records and the
  // items that the guest made join it.

  it("B2: sign-in in another tab: the account keeps its beats, and the guest's beat joins them", async () => {
    const entry = syncedStore("drum-machine");
    const account = (await accountAt11(entry)) as { savedBeats: Array<{ id: string; name: string }> };
    expect(account.savedBeats.length).toBeGreaterThan(0);

    // A fresh device: the page loads as a guest, with nothing saved.
    vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
    await loadPage(entry);
    const view = mount(entry);
    await settle(1_000);
    // The guest saves a beat.
    useDrumMachine().saveBeat("Guest beat");
    // Sign-in finishes in another tab: next-auth tells this tab, no reload.
    signIn();
    view.rerender();
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    const row = rowOf(entry) as { savedBeats: Array<{ id: string; name: string }> };
    const names = row.savedBeats.map((beat) => beat.name);
    expect(names).toEqual([...account.savedBeats.map((beat) => beat.name), "Guest beat"]);
    expect(sameProgress(progressOf(entry), row)).toBe(true);
  });

  it("B3: a guest's new Oregon journey never replaces the account's journey", async () => {
    const entry = syncedStore("oregon-trail");
    const account = await accountAt11(entry);

    vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
    await loadPage(entry);
    const view = mount(entry);
    await settle(1_000);
    const trail = useOregonTrailStore.getState();
    trail.startGame("Synthetic Guest", "carpenter", ["G1", "G2"], "may");
    trail.buySupply("oxen", 2);
    trail.leaveStore();
    const journey = progressOf(entry);
    expect(timeOf(journey)).toBeGreaterThan(0);

    signIn();
    view.rerender();
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    expect(rowOf(entry)).toEqual(account);
    expect(useOregonTrailStore.getState().leaderName).toBe(account.leaderName);
    expect(sameProgress(progressOf(entry), account)).toBe(true);
  });

  it("B4: play in the session's loading window on a blank device never replaces the account's pet", async () => {
    const entry = syncedStore("virtual-pet");
    const account = await accountAt11(entry);

    vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
    session.current = { data: null, status: "loading" };
    await loadPage(entry);
    const view = mount(entry);
    // The kid renames the default pet while the session still loads.
    useVirtualPetStore.getState().renamePet("Loading Window");
    signIn();
    view.rerender();
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    expect(rowOf(entry)).toEqual(account);
    expect(sameProgress(progressOf(entry), account)).toBe(true);
  });

  it("B5: a guest's records join the account (a new high score), and the account keeps the rest", async () => {
    const entry = syncedStore("flappy-bird");
    const account = (await accountAt11(entry)) as { highScore: number; gamesPlayed: number };

    vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
    await loadPage(entry);
    const view = mount(entry);
    await settle(1_000);
    const guest = { ...progressOf(entry), highScore: account.highScore + 50, gamesPlayed: 1, lastModified: Date.now() };
    entry.store.getState().setProgress(guest as never);
    signIn();
    view.rerender();
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    const row = rowOf(entry) as { highScore: number; gamesPlayed: number };
    expect(row.highScore).toBe(account.highScore + 50);
    expect(row.gamesPlayed).toBe(account.gamesPlayed);
  });
});

describe("virtual-pet: the daily-visit streak (review wave 3)", () => {
  it("a visit on a new day grows the streak on the account", async () => {
    const entry = syncedStore("virtual-pet");
    // Yesterday: the kid's pet, visited, on the account.
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    await play(entry);
    useVirtualPetStore.getState().updateFromTime();
    const yesterday = progressOf(entry);
    rows.set(`user-1:virtual-pet`, { data: yesterday, updatedAt: new Date() });
    const streak = useVirtualPetStore.getState().progress.stats.currentStreak;

    // Today, on the same device: the page syncs, then runs the time update
    // (VirtualPet waits for `ready`).
    vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
    await loadPage(entry);
    signIn();
    const view = mount(entry);
    await settle(1_000);
    expect(view.result.current.ready).toBe(true);
    useVirtualPetStore.getState().updateFromTime();
    await settle(6_000);
    view.unmount();

    expect(rejected).toEqual([]);
    const row = rowOf(entry) as { stats: { currentStreak: number; lastPlayDate: string } };
    expect(row.stats.currentStreak).toBe(streak + 1);
    expect(row.stats.lastPlayDate).toBe(new Date().toDateString());
  });
});

function useDrumMachine() {
  return syncedStore("drum-machine").store.getState() as { saveBeat: (name: string) => void };
}
