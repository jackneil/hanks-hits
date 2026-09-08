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
      1_700_000_000_000
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

    expect(useFourWheeler3dStore.getState().getProgress()).toEqual(saved);
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
      land: { "plot-1": { size: 1, slots: ["garage", "trophy", "house-huge"] } },
    });
    expect(result.success).toBe(false);
  });
});
