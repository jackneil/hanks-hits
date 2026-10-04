/**
 * Saves of the code before the sync-time fix, loaded by the new stores.
 *
 * fixtures/legacy-saves.json holds the localStorage saves that the store
 * code of commit 86a1fe0 wrote (scripts/legacy-saves/generate.sh made them
 * from that code; nothing in it is typed by hand). They carry the old
 * times: most stores put the page-load time into their untouched defaults,
 * and Hill Climb, Monster Truck and Oregon Trail saved no time at all.
 *
 * Review wave 3 of #26i: with the new stores alone, such a save kept a
 * page-load time that was newer than the account (the untouched defaults
 * then replaced the account's progress at sign-in), or, with no time, it
 * loaded as untouched and lost the progress that the device held beyond the
 * account. The persist merge of each store (settleOnLoad) gives each save
 * its real time (shared/lib/untouchedProgress.ts):
 * - untouched (also a change that the old page made by itself, or a setting
 *   whose old setter did not stamp): 0;
 * - a player's change with a time: that time;
 * - a player's change with no time: the load time (the old rule: the device
 *   wins).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { PROGRESS_TIME_MARKER, isUntouchedProgress } from "@/shared/lib/untouchedProgress";
import { validateProgress } from "@/lib/progress-schemas";
import type { ValidAppId } from "@hank-neil/db/schema";
import { SYNCED_STORES } from "@/__tests__/synced-stores";
import legacy from "@/__tests__/fixtures/legacy-saves.json";

type Save = { state: Record<string, unknown>; version: number };
type Saves = Record<string, { key: string } & Record<string, Save | string>>;

const SAVES = legacy.saves as unknown as Saves;
const LOAD_TIME = Date.UTC(2026, 9, 2, 13, 0, 0);

/** The time inside a save of the old code, or null (no time saved). */
function savedTime(save: Save): number | null {
  const progress = (save.state.progress ?? save.state) as AppProgressData;
  return extractTimestamp(progress);
}

async function load(appId: string, save: Save) {
  localStorage.setItem(SAVES[appId].key, JSON.stringify(save));
  // Each fixture is a new document. Capture raw bytes and loadAt only after
  // seeding the disk, then confirm the owner and await real hydration.
  vi.resetModules();
  const { syncedStore, SYNCED_STORES: freshStores } = await import("@/__tests__/synced-stores");
  const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
  const entry = syncedStore(appId);
  await authority.updateSession("unauthenticated");
  await Promise.all(freshStores.map(item => authority.whenHydrated(item.key)));
  const progress = entry.store.getState().getProgress() as Record<string, unknown>;
  return { entry, authority, progress, time: extractTimestamp(progress as AppProgressData) };
}

const scenarios = (name: string) =>
  Object.entries(SAVES)
    .filter(([, saves]) => typeof saves[name] === "object")
    .map(([appId, saves]) => [appId, saves[name] as Save] as const);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(LOAD_TIME));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  for (const entry of SYNCED_STORES) entry.reset();
  localStorage.clear();
});

describe("the fixture", () => {
  it("was made from the old store code, for every synced store", () => {
    expect(legacy.commit).toBe("86a1fe0");
    expect(Object.keys(SAVES).sort()).toEqual(SYNCED_STORES.map((entry) => entry.appId).sort());
    for (const entry of SYNCED_STORES) expect(SAVES[entry.appId].key).toBe(entry.key);
  });

  it("holds the old times: page-load times in untouched saves, and no time in three stores", () => {
    const loadTimes = scenarios("untouched").filter(([, save]) => savedTime(save) === legacy.loadTime);
    expect(loadTimes.length).toBeGreaterThan(25);
    expect(
      scenarios("played")
        .filter(([, save]) => savedTime(save) === null)
        .map(([appId]) => appId)
        .sort()
    ).toEqual(["hill-climb", "monster-truck", "oregon-trail"]);
  });
});

describe.each(scenarios("untouched"))("%s: an untouched save of the old code", (appId, save) => {
  it("loads with time 0 and untouched progress", async () => {
    const { entry, authority, progress, time } = await load(appId, save);
    expect(time).toBe(0);
    expect(isUntouchedProgress(appId, progress)).toBe(true);
    // The next write saves the real time with the marker, in the old
    // version (so the old code still loads it).
    entry.store.setState({});
    const stored = JSON.parse(authority.readScoped(entry.key)!);
    expect(localStorage.getItem(entry.key)).toBe(JSON.stringify(save));
    expect(stored.version).toBe(save.version);
    expect(stored.state[PROGRESS_TIME_MARKER]).toBe(1);
    expect(extractTimestamp((stored.state.progress ?? stored.state) as AppProgressData)).toBe(0);
  });
});

describe.each(scenarios("automatic"))("%s: a save of what the old page did by itself", (appId, save) => {
  it("loads with time 0 (the page load was not a player action)", async () => {
    expect(savedTime(save)).toBeGreaterThan(0);
    const { time } = await load(appId, save);
    expect(time).toBe(0);
  });
});

describe.each(scenarios("preference"))("%s: a save that changed only a setting whose old setter did not stamp", (appId, save) => {
  it("loads with time 0", async () => {
    const { time } = await load(appId, save);
    expect(time).toBe(0);
  });
});

describe.each(scenarios("played"))("%s: a save with a player's change", (appId, save) => {
  it("keeps the time of the change, or gets the load time when the old code saved none", async () => {
    const { progress, time } = await load(appId, save);
    const before = savedTime(save);
    expect(time).toBe(before ?? LOAD_TIME);
    expect(time).toBeGreaterThan(0);
    expect(isUntouchedProgress(appId, progress)).toBe(false);
  });

  it("keeps that time on the next load, when the page changed nothing (the settled save is written once)", async () => {
    const { entry, authority, time } = await load(appId, save);
    // A page that makes no change of its own (Oregon Trail's title screen).
    vi.setSystemTime(new Date(LOAD_TIME + 2 * 24 * 60 * 60 * 1000));
    const onDisk = authority.readScoped(entry.key)!;
    const { time: nextTime } = await load(appId, JSON.parse(onDisk) as Save);
    expect(nextTime).toBe(time);
  });
});

describe("a save of the new version is never migrated again", () => {
  it.each(SYNCED_STORES.map((entry) => [entry.appId, entry] as const))("%s", async (appId) => {
    const { entry, authority } = await load(appId, SAVES[appId].untouched as Save);
    entry.reset();
    // The untouched defaults, saved by the new code with a real time.
    entry.store.getState().setProgress({
      ...(entry.store.getState().getProgress() as Record<string, unknown>),
      [entry.timeKey]: 1_234,
    } as never);
    const saved = authority.readScoped(entry.key)!;
    entry.reset();
    authority.writeScoped(entry.key, saved);
    await entry.store.persist.rehydrate();
    expect(extractTimestamp(entry.store.getState().getProgress() as AppProgressData)).toBe(1_234);
  });
});

describe("saves that a kid really makes on the old code (review wave 4)", () => {
  it("joke-generator: 20 jokes read with 'next joke' are the kid's reading and keep their time", async () => {
    const save = SAVES["joke-generator"].reading as Save;
    const { progress, time } = await load("joke-generator", save);
    expect(progress.jokesViewed).toBe(20);
    expect(time).toBe(savedTime(save));
    expect(isUntouchedProgress("joke-generator", progress)).toBe(false);
  });

  it("joke-generator: one joke that showed by itself is untouched", () => {
    const one = { ...(SAVES["joke-generator"].untouched as Save).state, jokesViewed: 1, seenJokeIds: ["synthetic-a"] };
    expect(isUntouchedProgress("joke-generator", one)).toBe(true);
    expect(isUntouchedProgress("joke-generator", { ...one, jokesViewed: 2, seenJokeIds: ["a", "b"] })).toBe(false);
  });

  it("virtual-pet: 10 daily visits to a pet that the kid never fed or named stay untouched (time 0)", async () => {
    // Time alone changed this pet. With its old time it would replace the
    // account's real pet at sign-in; useAuthSync folds the earned species
    // and the streak into the account's pet instead (roundtrip test).
    const save = SAVES["virtual-pet"].visits as Save;
    const { progress, time } = await load("virtual-pet", save);
    expect((progress.stats as { currentStreak: number }).currentStreak).toBe(10);
    expect(progress.unlockedSpecies).toEqual(["blobby", "kitcat", "pupper"]);
    expect(time).toBe(0);
  });

  it("drum-machine: an 80-step beat (the old '+' button had no limit) passes the server's schema", async () => {
    const save = SAVES["drum-machine"]["long-beat"] as Save;
    const { progress, time } = await load("drum-machine", save);
    expect(time).toBeGreaterThan(0);
    const beat = (progress.savedBeats as Array<{ patternLength: number }>)[0];
    expect(beat.patternLength).toBe(80);
    expect(validateProgress("drum-machine" as ValidAppId, progress).success).toBe(true);
  });
});
