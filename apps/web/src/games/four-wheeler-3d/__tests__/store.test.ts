import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  useFourWheeler3dStore,
  defaultProgress,
  type FourWheeler3dProgress,
} from "../lib/store";
import { PROGRESS_SCHEMAS, validateProgress } from "@/lib/progress-schemas";
import { FISH_TYPES, START_MONEY } from "../lib/constants";

function freshProgress(): FourWheeler3dProgress {
  return {
    ...defaultProgress,
    ownedVehicles: [...defaultProgress.ownedVehicles],
    fishCaught: { ...defaultProgress.fishCaught },
    land: {},
    settings: { ...defaultProgress.settings },
  };
}

describe("Four-Wheeler 3D store", () => {
  beforeEach(() => {
    useFourWheeler3dStore.setState({
      progress: freshProgress(),
      isPaused: false,
      hasStarted: false,
      mode: "vehicle",
      hint: null,
    });
  });

  it("starts with the design doc defaults", () => {
    const progress = useFourWheeler3dStore.getState().progress;

    expect(progress.money).toBe(START_MONEY);
    expect(progress.money).toBe(20000);
    expect(progress.ownedVehicles).toEqual(["atv"]);
    expect(progress.currentVehicle).toBe("atv");
    expect(progress.paint).toBe("#e63946");
    expect(progress.trophies).toBe(0);
    expect(progress.biggestFish).toBe("");
    expect(progress.bestRaceTimeMs).toBe(0);
    expect(progress.day).toBe(1);
    expect(progress.timeOfDay).toBe(8);
    expect(progress.weather).toBe("sunny");
    expect(progress.settings).toEqual({
      soundEnabled: true,
      tiltEnabled: false,
      helmetCam: false,
    });
    for (const type of FISH_TYPES) {
      expect(progress.fishCaught[type]).toBe(0);
    }
  });

  it("adds money and counts it as earned", () => {
    const before = Date.now();
    useFourWheeler3dStore.getState().addMoney(500);

    const progress = useFourWheeler3dStore.getState().progress;
    expect(progress.money).toBe(START_MONEY + 500);
    expect(progress.totalEarned).toBe(500);
    expect(progress.lastModified).toBeGreaterThanOrEqual(before);
  });

  it("clamps money at zero and never counts a loss as earned", () => {
    useFourWheeler3dStore.getState().addMoney(-999_999);

    const progress = useFourWheeler3dStore.getState().progress;
    expect(progress.money).toBe(0);
    expect(progress.totalEarned).toBe(0);
  });

  it("bumps lastModified on every money change", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    useFourWheeler3dStore.getState().addMoney(-10);

    expect(useFourWheeler3dStore.getState().progress.lastModified).toBe(
      1_700_000_000_000,
    );
    vi.restoreAllMocks();
  });

  it("round trips progress through setProgress and getProgress", () => {
    const saved: FourWheeler3dProgress = {
      ...freshProgress(),
      money: 1234,
      trophies: 7,
      bestRaceTimeMs: 92_500,
      biggestFish: "rainbow",
      land: { "plot-1": { size: 2, slots: ["garage"] } },
      lastModified: 42,
    };

    useFourWheeler3dStore.getState().setProgress(saved);

    expect(useFourWheeler3dStore.getState().getProgress()).toEqual({
      ...saved,
      adventure: {
        ...saved.adventure,
        outfit: { ...saved.adventure.outfit, text: "" },
        feeders: saved.adventure.feeders.map(feeder => ({ ...feeder, label: "" })),
      },
    });
  });

  it("updates settings without touching the rest of progress", () => {
    useFourWheeler3dStore.getState().updateSettings({ tiltEnabled: true });

    const progress = useFourWheeler3dStore.getState().progress;
    expect(progress.settings).toEqual({
      soundEnabled: true,
      tiltEnabled: true,
      helmetCam: false,
    });
    expect(progress.money).toBe(START_MONEY);
  });

  it("resetSession clears only the transient fields", () => {
    useFourWheeler3dStore.setState({
      isPaused: true,
      hasStarted: true,
      mode: "foot",
      hint: "Press E",
    });
    useFourWheeler3dStore.getState().addMoney(100);

    useFourWheeler3dStore.getState().resetSession();

    const state = useFourWheeler3dStore.getState();
    expect(state.isPaused).toBe(false);
    expect(state.hasStarted).toBe(false);
    expect(state.mode).toBe("vehicle");
    expect(state.hint).toBeNull();
    expect(state.progress.money).toBe(START_MONEY + 100);
  });
});

describe("Four-Wheeler 3D progress schema", () => {
  it("is registered for the four-wheeler-3d app id", () => {
    expect(PROGRESS_SCHEMAS["four-wheeler-3d"]).toBeDefined();
  });

  it("accepts the store's own progress", () => {
    const result = validateProgress("four-wheeler-3d", freshProgress());
    expect(result.success).toBe(true);
  });

  it("accepts a played-in save", () => {
    const result = validateProgress("four-wheeler-3d", {
      ...freshProgress(),
      money: 51_000,
      totalEarned: 31_000,
      ownedVehicles: ["atv", "utv", "truck"],
      currentVehicle: "utv",
      trophies: 4,
      fishCaught: { little: 3, middle: 1, big: 0, huge: 0, rainbow: 1 },
      biggestFish: "rainbow",
      bestRaceTimeMs: 92_500,
      racesWon: 2,
      airPoints: 640,
      land: { "plot-3": { size: 2, slots: ["garage", "house-small"] } },
      hunger: 35,
      day: 6,
      timeOfDay: 19.5,
      weather: "rain",
      lastModified: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown field", () => {
    const result = validateProgress("four-wheeler-3d", {
      ...freshProgress(),
      cheatMoney: 999_999_999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative money", () => {
    const result = validateProgress("four-wheeler-3d", {
      ...freshProgress(),
      money: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plot with three build slots", () => {
    const result = validateProgress("four-wheeler-3d", {
      ...freshProgress(),
      land: {
        "plot-1": { size: 1, slots: ["garage", "trophy", "house-huge"] },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("four-wheeler-3d world clock", () => {
  /**
   * A store reset to a known clock. `lastModified` 1000: a world that the kid
   * already changed. The clock runs while the ride is open, so it never
   * moves that time (a continuous change, see shared/lib/progressStamp.ts):
   * a stamp made an idle ride newer than what the kid did on another device.
   */
  function freshClock(startHour: number, lastModified = 1_000) {
    const store = useFourWheeler3dStore.getState();
    store.setProgress({
      ...defaultProgress,
      timeOfDay: startHour,
      day: 3,
      weather: "sunny",
      lastModified,
    });
    store.seedClock();
    return useFourWheeler3dStore;
  }

  it("moves the live clock without touching saved progress", () => {
    const store = freshClock(9);
    const before = store.getState().progress;

    for (let second = 0; second < 59; second++) store.getState().tick(1);

    const after = store.getState();
    // One game minute per real second, so 59 seconds is 59 minutes.
    expect(after.clock).toBeCloseTo(9 + 59 / 60, 8);
    // Nothing was written: the very same progress object is still in place.
    expect(after.progress).toBe(before);
    expect(after.progress.timeOfDay).toBe(9);
    expect(after.progress.lastModified).toBe(1_000);
  });

  it("saves the clock once a whole game hour has passed", () => {
    const store = freshClock(9);
    for (let second = 0; second < 59; second++) store.getState().tick(1);
    const before = store.getState().progress;

    store.getState().tick(1);

    const after = store.getState();
    expect(after.progress).not.toBe(before);
    expect(after.progress.timeOfDay).toBeCloseTo(10, 8);
    expect(after.progress.lastModified).toBe(1_000);

    // And the counter starts over, so the next hour is one save, not sixty.
    const saved = after.progress;
    for (let second = 0; second < 59; second++) store.getState().tick(1);
    expect(store.getState().progress).toBe(saved);
  });

  it("saves once at midnight with the new day and fresh weather", () => {
    const store = freshClock(23.99);
    const before = store.getState().progress;

    store.getState().tick(1);

    const after = store.getState();
    expect(after.progress).not.toBe(before);
    expect(after.progress.day).toBe(4);
    expect(after.clock).toBeLessThan(1);
    expect(["sunny", "rainy", "foggy", "snowy"]).toContain(
      after.progress.weather,
    );
    expect(after.hint).toContain("A new day");
    expect(after.progress.lastModified).toBe(1_000);

    // The rollover reset the hour counter, so the next 59 ticks save nothing.
    const saved = after.progress;
    for (let second = 0; second < 59; second++) store.getState().tick(1);
    expect(store.getState().progress).toBe(saved);
  });

  it("saves the clock when the game pauses or the page goes away", () => {
    const store = freshClock(9);
    for (let second = 0; second < 10; second++) store.getState().tick(1);
    expect(store.getState().progress.timeOfDay).toBe(9);

    store.getState().flushClock();

    expect(store.getState().progress.timeOfDay).toBeCloseTo(9 + 10 / 60, 8);
    expect(store.getState().progress.lastModified).toBe(1_000);

    // A second flush with nothing new must not write again.
    const saved = store.getState().progress;
    store.getState().flushClock();
    expect(store.getState().progress).toBe(saved);
  });

  it("moves the saved clock of an untouched world without a time: the world stays untouched", () => {
    // The clock moves by itself. In a world that no kid changed, a stamp
    // would make the defaults newer than the account's world, and the
    // sign-in sync would replace the account's world with them.
    const store = freshClock(23.99, 0);
    store.getState().tick(1);
    expect(store.getState().progress.day).toBe(4);
    for (let second = 0; second < 60; second++) store.getState().tick(1);
    store.getState().flushClock();
    expect(store.getState().progress.timeOfDay).toBeGreaterThan(0);
    expect(store.getState().progress.lastModified).toBe(0);
  });

  it("sleeping in the house sets the clock: a player's change stamps the time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    const store = freshClock(22);
    store.getState().setTimeOfDay(7);
    expect(store.getState().progress.timeOfDay).toBe(7);
    expect(store.getState().progress.lastModified).toBe(Date.parse("2026-10-03T08:00:00Z"));
    // The same hour again changes nothing and keeps the time.
    vi.setSystemTime(new Date("2026-10-03T09:00:00Z"));
    store.getState().setTimeOfDay(7);
    expect(store.getState().progress.lastModified).toBe(Date.parse("2026-10-03T08:00:00Z"));
    vi.useRealTimers();
  });
});

