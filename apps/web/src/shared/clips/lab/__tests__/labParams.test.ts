import { describe, expect, it } from "vitest";

import { DEFAULT_LAB_OPTIONS, MAX_HOLD_FRAMES, isClipsLabEnabled, parseLabParams } from "../labParams";

describe("isClipsLabEnabled", () => {
  it("is on only for the exact value 1", () => {
    expect(isClipsLabEnabled({ CLIPS_LAB: "1" })).toBe(true);
  });

  it.each([
    ["unset", {}],
    ["empty", { CLIPS_LAB: "" }],
    ["0", { CLIPS_LAB: "0" }],
    ["true", { CLIPS_LAB: "true" }],
    ["yes", { CLIPS_LAB: "yes" }],
    ["on", { CLIPS_LAB: "on" }],
    ["1 with a space", { CLIPS_LAB: " 1" }],
    ["1 with a newline", { CLIPS_LAB: "1\n" }],
    ["01", { CLIPS_LAB: "01" }],
    ["only CLIPS_MODE on", { CLIPS_MODE: "on" }],
  ])("is off when CLIPS_LAB is %s", (_name, env) => {
    expect(isClipsLabEnabled(env as Record<string, string | undefined>)).toBe(false);
  });
});

describe("parseLabParams", () => {
  it("gives the defaults for no parameters", () => {
    expect(parseLabParams({})).toEqual({ gl: false, targetFps: 60, hold: null });
    expect(parseLabParams({})).toEqual(DEFAULT_LAB_OPTIONS);
  });

  it("keeps the defaults frozen", () => {
    expect(Object.isFrozen(DEFAULT_LAB_OPTIONS)).toBe(true);
  });

  it("turns on WebGL2 only for gl=2", () => {
    expect(parseLabParams({ gl: "2" }).gl).toBe(true);
    for (const value of ["1", "webgl2", "true", "", "22"]) expect(parseLabParams({ gl: value }).gl).toBe(false);
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseLabParams({ gl: ["2", "1"] }).gl).toBe(true);
    expect(parseLabParams({ gl: ["1", "2"] }).gl).toBe(false);
    expect(parseLabParams({ fps: ["30", "60"] }).targetFps).toBe(30);
  });

  it("accepts fps 30 and gives 60 for any other value", () => {
    expect(parseLabParams({ fps: "30" }).targetFps).toBe(30);
    for (const value of ["60", "24", "120", "abc", ""]) expect(parseLabParams({ fps: value }).targetFps).toBe(60);
  });

  it("accepts a hold of 1 to MAX_HOLD_FRAMES whole frames", () => {
    for (let n = 1; n <= MAX_HOLD_FRAMES; n++) expect(parseLabParams({ hold: String(n) }).hold).toBe(n);
  });

  it.each(["0", String(MAX_HOLD_FRAMES + 1), "-1", "1.5", "2e0", " 2", "two", ""])("ignores hold=%s", (value) => {
    expect(parseLabParams({ hold: value }).hold).toBeNull();
  });
});
