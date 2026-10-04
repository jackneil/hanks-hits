/**
 * Historical payload compatibility of the sync-time fix.
 *
 * Owner-bound persistence now stores these inner envelopes in v2 namespaces.
 * The old-code fixtures prove payload compatibility, not physical namespace
 * discovery. A deployment rollback MUST retain the v2 reader/writer. Frozen
 * legacy keys remain readable and are never rewritten by the new stores.
 *
 * Review wave 4 of #26i: the fix first raised the persist version of 30
 * stores. The code before the fix (commit 86a1fe0) has no migrate step for
 * a higher version: zustand logged an error and loaded the DEFAULTS, the
 * next change wrote them over the save, and that code's sync uploaded them
 * with the page-load time, which won over the account's real progress. A
 * Railway rollback, a revert of the PR, or a tab that still runs the old
 * code after the deploy all do this.
 *
 * Now the version stays and a marker key marks a new save
 * (shared/lib/untouchedProgress.ts). scripts/legacy-saves/rollback.sh
 * writes the saves of the new code (fixtures/new-saves.json) and loads them
 * with the REAL store code of ROLLBACK_COMMIT (rollback-commit.ts), the
 * historical payload-compatibility target (not a supported namespace rollback)
 * (fixtures/rollback-loads.json). This test holds both files to the rules:
 * - the old code loads every new save with no error, and its progress is
 *   the new save's progress;
 * - the save that the old code writes back loads in the new code with the
 *   same progress (and a played save stays played);
 * - the fixtures match the store code of this checkout (run rollback.sh
 *   after a change to a store's save);
 * - a save that the old code keeps the marker in (it keeps keys that it does
 *   not know) carries a sum of its progress, and when the old code played
 *   on, the new code loads it with a time at or after that play (review
 *   wave 5: Oregon Trail).
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 12, 0, 0)));
});

import { afterAll, describe, expect, it } from "vitest";
import type { AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { sameProgress } from "@/shared/lib/progressStamp";
import { PROGRESS_SUM_KEY, PROGRESS_TIME_MARKER, isUntouchedProgress, progressFromSave } from "@/shared/lib/untouchedProgress";
import { SYNCED_STORES } from "@/__tests__/synced-stores";
import { writeNewSaves, type NewSaves } from "@/__tests__/new-save-scenarios";
import newSavesFile from "@/__tests__/fixtures/new-saves.json";
import rollbackFile from "@/__tests__/fixtures/rollback-loads.json";
// The commit of the old store code in fixtures/rollback-loads.json.
import { ROLLBACK_COMMIT } from "@/__tests__/rollback-commit";

type Load = { errors: string[]; loaded: AppProgressData; rewritten: string | null };
type PlayedOn = { at: number; loaded: AppProgressData; rewritten: string | null };


const NEW = newSavesFile.saves as unknown as NewSaves;
const LOADS = rollbackFile.loads as unknown as Record<string, Record<string, Load>>;
const TIME_KEYS = ["lastModified", "updatedAt"];
const RERUN = "Run bash apps/web/scripts/legacy-saves/rollback.sh after a change to a store's save.";

const cases = Object.entries(NEW).flatMap(([appId, entry]) =>
  Object.keys(entry.saves).map((name) => [appId, name] as const)
);

afterAll(() => {
  vi.useRealTimers();
  for (const entry of SYNCED_STORES) entry.reset();
  localStorage.clear();
});

describe("the fixtures", () => {
  it("come from the old store code, for every synced store", () => {
    expect(rollbackFile.commit).toBe(ROLLBACK_COMMIT);
    expect(Object.keys(NEW).sort()).toEqual(SYNCED_STORES.map((entry) => entry.appId).sort());
    expect(cases.length).toBeGreaterThan(SYNCED_STORES.length * 2);
  });

  it("match the inner envelopes this checkout writes durably without changing legacy keys", async () => {
    const now = await writeNewSaves();
    for (const [appId, entry] of Object.entries(NEW)) {
      expect(now[appId].version, `${appId}: ${RERUN}`).toBe(entry.version);
      expect(Object.keys(now[appId].saves).sort(), `${appId}: ${RERUN}`).toEqual(Object.keys(entry.saves).sort());
      for (const [name, save] of Object.entries(entry.saves)) {
        const keys = (raw: string) => Object.keys(JSON.parse(raw).state).sort();
        expect(keys(now[appId].saves[name].raw), `${appId} ${name}: ${RERUN}`).toEqual(keys(save.raw));
        expect(JSON.parse(save.raw).state[PROGRESS_TIME_MARKER], `${appId} ${name}: ${RERUN}`).toBe(1);
      }
    }
  });
});

describe.each(cases)("%s (%s save): the old code", (appId, name) => {
  const save = NEW[appId].saves[name];
  const load = LOADS[appId][name];

  it("loads the new save with no error, and with its progress", () => {
    expect(load.errors).toEqual([]);
    expect(sameProgress(load.loaded, save.progress, TIME_KEYS)).toBe(true);
  });

  it("writes a save that the new code loads with the same progress", () => {
    expect(load.rewritten).not.toBeNull();
    const back = progressFromSave(appId, JSON.parse(load.rewritten!).state);
    expect(back).not.toBeNull();
    expect(sameProgress(back, save.progress, TIME_KEYS)).toBe(true);
    const before = extractTimestamp(save.progress) ?? 0;
    const after = extractTimestamp(back as AppProgressData) ?? 0;
    // Progress that a player made keeps a time, so it never loses to an
    // older account. Progress that the store's rule calls untouched (only
    // time or a setting changed it) gets time 0 from the old code's save:
    // it holds nothing to lose.
    if (isUntouchedProgress(appId, save.progress)) expect(after).toBe(0);
    else {
      expect(before).toBeGreaterThan(0);
      expect(after).toBeGreaterThan(0);
    }
  });
});

describe("a save whose old code keeps keys that it does not know", () => {
  const keepsMarker = Object.entries(LOADS).flatMap(([appId, loads]) =>
    Object.entries(loads)
      .filter(([, load]) => load.rewritten !== null && JSON.parse(load.rewritten).state[PROGRESS_TIME_MARKER] === 1)
      .map(([name]) => [appId, name] as const)
  );

  it("is Oregon Trail, the only store with no partialize in the old code", () => {
    expect([...new Set(keepsMarker.map(([appId]) => appId))]).toEqual(["oregon-trail"]);
  });

  it.each(keepsMarker)("%s (%s save): carries a sum of its progress", (appId, name) => {
    expect(JSON.parse(NEW[appId].saves[name].raw).state[PROGRESS_SUM_KEY]).toEqual(expect.any(String));
  });

  it("oregon-trail: the journey that the old code played on loads with a time at or after that play, and with that play", async () => {
    const played = (rollbackFile as unknown as { playedOn: Record<string, PlayedOn> }).playedOn["oregon-trail"];
    expect(played.rewritten).not.toBeNull();
    const rewritten = JSON.parse(played.rewritten!).state;
    // The old code kept this code's marker and time while the kid played on.
    expect(rewritten[PROGRESS_TIME_MARKER]).toBe(1);
    vi.setSystemTime(new Date(played.at + 2 * 24 * 60 * 60 * 1000));
    localStorage.clear();
    localStorage.setItem("oregon-trail-storage", played.rewritten!);
    vi.resetModules();
    const { syncedStore, SYNCED_STORES: freshStores } = await import("@/__tests__/synced-stores");
    const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
    const entry = syncedStore("oregon-trail");
    await authority.updateSession("unauthenticated");
    await Promise.all(freshStores.map(item => authority.whenHydrated(item.key)));
    expect(localStorage.getItem(entry.key)).toBe(played.rewritten!);
    const progress = entry.store.getState().getProgress() as AppProgressData;
    expect(extractTimestamp(progress)).toBeGreaterThanOrEqual(played.at);
    expect(sameProgress(progress, played.loaded, TIME_KEYS)).toBe(true);
    expect(progress.pace).toBe("grueling");
  });
});
