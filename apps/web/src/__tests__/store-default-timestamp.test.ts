import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { PROGRESS_TIME_MARKER, PROGRESS_TIME_VERSION, isUntouchedProgress, progressFromSave } from "@/shared/lib/untouchedProgress";
import { sameProgress } from "@/shared/lib/progressStamp";
import legacy from "@/__tests__/fixtures/legacy-saves.json";
import { SYNCED_STORES, syncedStore, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { useHillClimbStore } from "@/games/hill-climb/lib/store";
import { useGameStore as useMonsterTruckStore } from "@/games/monster-truck/lib/store";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";

/**
 * Untouched progress must never replace the account's progress.
 *
 * useAuthSync merges a device's progress into the account by last write
 * wins on the progress's own time (lastModified, or updatedAt). A store
 * whose DEFAULT state carried Date.now() from module load was newer than
 * the account's real save on every page that loaded after it. On a second
 * device, or after sign-out and sign-in, the defaults won: the pet, the
 * saved beats, the wishlist and the journey on the account were replaced
 * by the defaults (review wave 2 of #26i). getProgress() that stamped
 * Date.now() on each read did the same.
 *
 * So every synced store starts at time 0 and only a player action stamps
 * it. This test covers every store that useAuthSync syncs: a new game that
 * is not in SYNCED_STORES fails the first test.
 */

import { ownerBoundProgress } from "@/lib/owner-bound-progress";

beforeAll(async () => {
  await ownerBoundProgress.updateSession("unauthenticated");
  await Promise.all(SYNCED_STORES.map(entry => ownerBoundProgress.whenHydrated(entry.key)));
});

const SRC = join(__dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** "appId -> key" of every useAuthSync({ appId, localStorageKey }) call in the source. */
function syncCalls(): Set<string> {
  const calls = new Set<string>();
  for (const root of ["games", "apps", "shared"]) {
    for (const file of sourceFiles(join(SRC, root))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("useAuthSync")) continue;
      for (const match of source.matchAll(/appId:\s*["']([^"']+)["'],\s*localStorageKey:\s*["']([^"']+)["']/g)) {
        calls.add(`${match[1]} -> ${match[2]}`);
      }
    }
  }
  return calls;
}

const progressOf = (entry: SyncedStoreEntry) => entry.store.getState().getProgress() as Record<string, unknown>;
const timeOf = (entry: SyncedStoreEntry) => extractTimestamp(progressOf(entry) as AppProgressData);
const cases = SYNCED_STORES.map((entry) => [entry.appId, entry] as const);

describe("every synced store starts untouched", () => {
  it("covers every store that useAuthSync syncs", () => {
    const calls = syncCalls();
    expect(calls.size).toBeGreaterThan(30);
    expect(
      new Set(SYNCED_STORES.map((entry) => `${entry.appId} -> ${entry.key}`)),
      "Add each synced store to src/__tests__/synced-stores.ts and follow the rules in " +
        'design/ARCHITECTURE.md, section "Progress time (cloud sync)"'
    ).toEqual(calls);
  });

  it.each(cases)("%s: saves under the key that useAuthSync reads", (_appId, entry) => {
    // useAuthSync reads this key to see whether the page loaded with a save.
    expect(entry.store.persist.getOptions().name).toBe(entry.key);
  });

  it.each(cases)("%s: the default progress has time 0, on every read", async (_appId, entry) => {
    entry.reset();
    expect(timeOf(entry)).toBe(0);
    // A read must not stamp the time (getProgress() that returned Date.now()).
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(timeOf(entry)).toBe(0);
  });

  it.each(cases)("%s: progress from the server keeps the server's time", (_appId, entry) => {
    entry.reset();
    entry.store.getState().setProgress({ ...progressOf(entry), [entry.timeKey]: 1_700_000_000_123 } as never);
    expect(timeOf(entry)).toBe(1_700_000_000_123);
    // And progress with time 0 stays untouched.
    entry.store.getState().setProgress({ ...progressOf(entry), [entry.timeKey]: 0 } as never);
    expect(timeOf(entry)).toBe(0);
    entry.reset();
  });

  it.each(cases)("%s: the default progress is untouched by the store's rule", (appId, entry) => {
    entry.reset();
    // The rule is how useAuthSync spots untouched progress on the account.
    expect(isUntouchedProgress(appId, progressOf(entry))).toBe(true);
    expect(isUntouchedProgress(appId, { ...progressOf(entry), [entry.timeKey]: 1_700_000_000_000 })).toBe(true);
  });

  it.each(cases)("%s: a save carries the marker, and the persist version of the old code stays", (appId, entry) => {
    // The version of commit 86a1fe0 (fixtures/legacy-saves.json): with the
    // same version, that code (a rollback, or a tab that still runs it)
    // loads a new save; with a higher one it loaded the defaults instead.
    const oldVersion = (legacy.saves as unknown as Record<string, { played: { version: number } }>)[appId].played.version;
    expect(entry.store.persist.getOptions().version).toBe(oldVersion);
    entry.reset();
    entry.store.setState({});
    const saved = JSON.parse(ownerBoundProgress.readScoped(entry.key)!);
    expect(saved.state[PROGRESS_TIME_MARKER]).toBe(PROGRESS_TIME_VERSION);
    entry.reset();
  });

  it.each(cases)("%s: the store's rule reads the progress of its save as getProgress() returns it", (appId, entry) => {
    // useAuthSync reads saves of other tabs and the save at hydration with it.
    entry.reset();
    entry.store.getState().setProgress({ ...progressOf(entry), [entry.timeKey]: 1_700_000_000_456 } as never);
    const saved = JSON.parse(ownerBoundProgress.readScoped(entry.key)!);
    const read = progressFromSave(appId, saved.state);
    expect(read).not.toBeNull();
    expect(sameProgress(read, progressOf(entry))).toBe(true);
    entry.reset();
  });
});

describe("the stores that stamp their time on each change (progressStamp)", () => {
  it("hill-climb: a player change stamps the time; taking the server's progress does not", () => {
    syncedStore("hill-climb").reset();
    useHillClimbStore.getState().toggleSound();
    const stamped = useHillClimbStore.getState().getProgress().lastModified;
    expect(stamped).toBeGreaterThan(0);
    useHillClimbStore.getState().setProgress({ ...useHillClimbStore.getState().getProgress(), coins: 40, lastModified: 7 });
    expect(useHillClimbStore.getState().getProgress().lastModified).toBe(7);
  });

  it("hill-climb: a reset is the player's choice and stamps the time; a reset of a new garage does not", () => {
    syncedStore("hill-climb").reset();
    useHillClimbStore.getState().resetProgress();
    expect(useHillClimbStore.getState().getProgress().lastModified).toBe(0);
    useHillClimbStore.getState().addCoins(50, false);
    useHillClimbStore.getState().resetProgress();
    expect(useHillClimbStore.getState().getProgress().lastModified).toBeGreaterThan(0);
    expect(useHillClimbStore.getState().coins).toBe(0);
  });

  it("hill-climb: the same choice again (a new list with the same stages) keeps the time", () => {
    syncedStore("hill-climb").reset();
    useHillClimbStore.getState().selectStage("countryside");
    expect(useHillClimbStore.getState().getProgress().lastModified).toBe(0);
  });

  it("monster-truck: a player change stamps the time", () => {
    syncedStore("monster-truck").reset();
    useMonsterTruckStore.getState().collectStar();
    expect(useMonsterTruckStore.getState().getProgress().lastModified).toBeGreaterThan(0);
  });

  it("oregon-trail: a player change stamps the time, and a reset is a change too", () => {
    syncedStore("oregon-trail").reset();
    useOregonTrailStore.getState().startGame("Synthetic", "farmer", ["A"], "april");
    const stamped = useOregonTrailStore.getState().getProgress().lastModified;
    expect(stamped).toBeGreaterThan(0);
    useOregonTrailStore.getState().setProgress({ ...useOregonTrailStore.getState().getProgress(), lastModified: 5 });
    expect(useOregonTrailStore.getState().getProgress().lastModified).toBe(5);
    useOregonTrailStore.getState().resetGame();
    expect(useOregonTrailStore.getState().getProgress().lastModified).toBeGreaterThan(5);
  });
});

describe("virtual-pet: time passing", () => {
  it("keeps an untouched pet untouched", () => {
    syncedStore("virtual-pet").reset();
    useVirtualPetStore.getState().updateFromTime();
    expect(useVirtualPetStore.getState().getProgress().lastModified).toBe(0);
  });

  it("stamps a visit that grows the streak of the player's pet (review wave 3)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T15:00:00"));
      syncedStore("virtual-pet").reset();
      useVirtualPetStore.getState().renamePet("Synthetic");
      expect(useVirtualPetStore.getState().getProgress().lastModified).toBe(0);
      useVirtualPetStore.getState().play();
      useVirtualPetStore.getState().updateFromTime();
      const yesterday = useVirtualPetStore.getState().getProgress();
      expect(yesterday.stats.currentStreak).toBe(1);

      // The next day: the visit is real progress, and it must win over the
      // account's older copy, or the streak is lost at the next sync.
      vi.setSystemTime(new Date("2026-10-02T09:00:00"));
      useVirtualPetStore.getState().updateFromTime();
      const today = useVirtualPetStore.getState().getProgress();
      expect(today.stats.currentStreak).toBe(2);
      expect(today.lastModified).toBe(Date.now());
      expect(today.lastModified).toBeGreaterThan(yesterday.lastModified);
    } finally {
      vi.useRealTimers();
      syncedStore("virtual-pet").reset();
    }
  });
});
