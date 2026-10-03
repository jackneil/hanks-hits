/**
 * Every action of every synced store follows the time rules of
 * shared/lib/progressStamp.ts, driven by seeded random actions.
 *
 * After each action the test compares the synced progress (getProgress())
 * before and after it:
 * - a player action that changes the progress stamps a new time;
 * - an action that changes nothing keeps the time (an untouched store stays
 *   untouched: a tap on the selected choice is not progress);
 * - an automatic change that a page makes once (a page load, the bake
 *   while away, a visit on a new day) stamps a new time only in a store that
 *   a player already changed, and keeps 0 in an untouched store;
 * - a continuous change (a clock that runs while the page is open: the
 *   bakery's bake, the ride's world clock, the pet's needs) never moves the
 *   time, or an idle page would replace what the kid did on another device;
 * - setProgress (taking the account's progress) keeps the time it gets;
 * - progress that a save would send (time above 0) passes the server's
 *   schema (validateProgress), so the server never refuses a save.
 *
 * A store drops back to its untouched defaults now and then, so the rules
 * run on untouched and on played stores. Each store has a driver: every
 * action of the store is either driven (with arguments that fit its game)
 * or skipped with a reason. A new action in a store fails the coverage test
 * until its driver says how to run it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { validateProgress } from "@/lib/progress-schemas";
import { sameProgress } from "@/shared/lib/progressStamp";
import { installAudioMock } from "@/__tests__/audio-mock";
import { SYNCED_STORES, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import { DRIVERS, READ_ONLY, SYNC, int, pick, seeded } from "@/__tests__/store-drivers";

// Stores capture initial timestamps during import, so freeze their clock too.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
});

const STEPS_PER_STORE = 190; // 33 stores: about 6,000 actions per run.
const SEED = 20261002;

const progressOf = (entry: SyncedStoreEntry) =>
  JSON.parse(JSON.stringify(entry.store.getState().getProgress())) as Record<string, unknown>;
const timeOf = (progress: Record<string, unknown>) => extractTimestamp(progress as AppProgressData) ?? 0;

const actionsOf = (entry: SyncedStoreEntry) =>
  Object.entries(entry.store.getState())
    .filter(([name, value]) => typeof value === "function" && !SYNC.has(name) && !READ_ONLY.test(name))
    .map(([name]) => name)
    .sort();

beforeAll(() => {
  installAudioMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("every synced store has a driver for every action", () => {
  it.each(SYNCED_STORES.map((entry) => [entry.appId, entry] as const))("%s", (appId, entry) => {
    const driver = DRIVERS[appId];
    expect(driver, `${appId}: add a driver to DRIVERS in src/__tests__/store-drivers.ts`).toBeDefined();
    const covered = new Set([...Object.keys(driver.steps), ...Object.keys(driver.skip ?? {})]);
    expect(
      actionsOf(entry).filter((name) => !covered.has(name)),
      `${appId}: give each new action a step (with its arguments) or a skip reason`
    ).toEqual([]);
    // No stale step: each one names an action of the store.
    expect(Object.keys(driver.steps).filter((name) => !actionsOf(entry).includes(name))).toEqual([]);
  });
});

describe("seeded random actions keep the time rules", () => {
  it.each(SYNCED_STORES.map((entry, index) => [entry.appId, entry, index] as const))(
    "%s",
    (appId, entry, index) => {
      const driver = DRIVERS[appId];
      const rng = seeded(SEED + index);
      const clocks = [entry.timeKey, ...(driver.clocks ?? [])];
      const steps = Object.entries(driver.steps);
      const total = steps.reduce((sum, [, step]) => sum + (step.weight ?? 1), 0);
      const choose = () => {
        let roll = rng() * total;
        for (const [name, step] of steps) {
          roll -= step.weight ?? 1;
          if (roll < 0) return [name, step] as const;
        }
        return steps[steps.length - 1];
      };
      const snapshots: Record<string, unknown>[] = [];
      const failures: string[] = [];
      let changes = 0;

      entry.reset();
      vi.advanceTimersByTime(1_000);
      for (let i = 0; i < STEPS_PER_STORE; i++) {
        // Now and then: back to an untouched store, or the account's progress.
        const roll = rng();
        if (roll < 0.03) {
          entry.reset();
          vi.advanceTimersByTime(1_000);
        } else if (roll < 0.06 && snapshots.length > 0) {
          const data = pick(rng, snapshots);
          entry.store.getState().setProgress(data as never);
          vi.advanceTimersByTime(1_000);
          const after = progressOf(entry);
          if (timeOf(after) !== timeOf(data)) {
            failures.push(`setProgress: time ${timeOf(data)} became ${timeOf(after)}`);
          }
        }

        vi.advanceTimersByTime(int(rng, 1, 40));
        const [name, step] = choose();
        const state = entry.store.getState();
        const args = step.args ? step.args(rng, state) : [];
        const before = progressOf(entry);
        state[name](...args);
        // Timers that the action started (a match check, an achievement check).
        vi.advanceTimersByTime(1_000);
        const after = progressOf(entry);
        if (rng() < 0.2) snapshots.push(after);

        const changed = !sameProgress(before, after, clocks);
        if (changed) changes += 1;
        const t0 = timeOf(before);
        const t1 = timeOf(after);
        const kind = typeof step.kind === "function" ? step.kind(args, before, after) : (step.kind ?? "player");
        const label = `step ${i} ${name}(${JSON.stringify(args).slice(0, 60)})`;
        if (!changed && t1 !== t0) failures.push(`${label}: no change, but the time moved ${t0} -> ${t1}`);
        if (changed && kind === "player" && !(t1 > t0)) failures.push(`${label}: a change kept the time ${t0}`);
        if (changed && kind === "automatic" && t0 > 0 && !(t1 > t0))
          failures.push(`${label}: an automatic change of a played store kept the time ${t0}`);
        if (changed && kind === "automatic" && t0 === 0 && t1 !== 0)
          failures.push(`${label}: an automatic change stamped an untouched store (${t1})`);
        if (kind === "continuous" && t1 !== t0)
          failures.push(`${label}: a continuous change moved the time ${t0} -> ${t1}`);
        if (t1 > 0) {
          const valid = validateProgress(appId as ValidAppId, after);
          if (!valid.success) failures.push(`${label}: the server would refuse the save: ${valid.error.slice(0, 160)}`);
        }
      }
      entry.reset();
      expect(failures.slice(0, 10)).toEqual([]);
      // The driver must reach the progress: a run of no-ops proves nothing.
      expect(changes, `${appId}: actions that changed the progress`).toBeGreaterThanOrEqual(10);
    }
  );
});
