import { describe, it, expect } from "vitest";

import {
  GAME_HOURS_PER_REAL_SECOND,
  WEATHERS,
  advanceClock,
  clockIcon,
  fogDensity,
  formatClock,
  nightFactor,
  rollWeather,
  skyColors,
  sunPosition,
  updateSnowLevel,
  type Weather,
} from "../lib/dayNight";

describe("four-wheeler-3d clock", () => {
  it("advances one game minute per real second", () => {
    expect(GAME_HOURS_PER_REAL_SECOND).toBeCloseTo(1 / 60, 10);
    const step = advanceClock(8, 1);
    expect(step.timeOfDay).toBeCloseTo(8 + 1 / 60, 10);
    expect(step.newDay).toBe(false);
  });

  it("wraps at midnight and flags the new day exactly once", () => {
    let time = 23.99;
    let days = 0;
    for (let i = 0; i < 120; i++) {
      const step = advanceClock(time, 1);
      time = step.timeOfDay;
      if (step.newDay) days++;
    }
    expect(days).toBe(1);
    expect(time).toBeGreaterThanOrEqual(0);
    expect(time).toBeLessThan(24);
  });

  it("reads the clock the way a kid does", () => {
    expect(formatClock(8)).toBe("8:00 AM");
    expect(formatClock(13.5)).toBe("1:30 PM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(12)).toBe("12:00 PM");
    expect(formatClock(23.75)).toBe("11:45 PM");
  });

  it("shows the weather on the badge, or the sun and the moon", () => {
    expect(clockIcon(12, "sunny")).toBe("☀️");
    expect(clockIcon(2, "sunny")).toBe("🌙");
    expect(clockIcon(12, "rainy")).toBe("🌧️");
    expect(clockIcon(12, "snowy")).toBe("❄️");
    expect(clockIcon(2, "foggy")).toBe("🌫️");
  });
});

describe("four-wheeler-3d sun and night", () => {
  it("is bright at noon, dark at 2 in the morning, and dim at dusk", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(2)).toBe(1);
    const dusk = nightFactor(20.5);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    const dawn = nightFactor(7.5);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
  });

  it("lifts the sun over the horizon between 6 in the morning and 8 at night", () => {
    for (const hour of [6.5, 9, 13, 17, 19.5]) {
      const [, y] = sunPosition(hour);
      expect(y).toBeGreaterThan(0);
    }
    for (const hour of [21, 0, 3, 5.5]) {
      const [, y] = sunPosition(hour);
      expect(y).toBeLessThan(0);
    }
    for (const hour of [0, 6, 12, 18, 23]) {
      const sun = sunPosition(hour);
      expect(Math.hypot(sun[0], sun[1], sun[2])).toBeCloseTo(1, 10);
    }
  });

  it("dims the lights and thickens the fog when it should", () => {
    const noon = skyColors(12, "sunny");
    const night = skyColors(2, "sunny");
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity);
    expect(noon.ambientIntensity).toBeGreaterThan(night.ambientIntensity);
    expect(noon.skyTop).toMatch(/^#[0-9a-f]{6}$/);
    expect(fogDensity(12, "foggy")).toBeGreaterThan(fogDensity(12, "sunny"));
    expect(skyColors(12, "foggy").fogFar).toBeLessThan(noon.fogFar);
  });
});

describe("four-wheeler-3d weather", () => {
  /** A tiny repeatable random number source, so the draw never flakes. */
  function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it("rolls sunny most days and the rest now and then", () => {
    const rand = seededRandom(20260908);
    const draws = 20000;
    const counts: Record<Weather, number> = {
      sunny: 0,
      rainy: 0,
      foggy: 0,
      snowy: 0,
    };
    for (let i = 0; i < draws; i++) counts[rollWeather(rand)]++;

    const expected: Record<Weather, number> = {
      sunny: 62,
      rainy: 15,
      foggy: 11,
      snowy: 12,
    };
    for (const weather of WEATHERS) {
      const percent = (counts[weather] / draws) * 100;
      expect(Math.abs(percent - expected[weather])).toBeLessThanOrEqual(2);
    }
  });

  it("piles snow up while it snows and melts it away after", () => {
    let snow = 0;
    for (let i = 0; i < 60; i++) snow = updateSnowLevel(snow, "snowy", 1);
    expect(snow).toBeGreaterThan(0.5);
    for (let i = 0; i < 600; i++) snow = updateSnowLevel(snow, "snowy", 1);
    expect(snow).toBe(1);

    for (let i = 0; i < 40; i++) snow = updateSnowLevel(snow, "sunny", 1);
    expect(snow).toBeLessThan(1);
    expect(snow).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) snow = updateSnowLevel(snow, "sunny", 1);
    expect(snow).toBe(0);
  });
});
