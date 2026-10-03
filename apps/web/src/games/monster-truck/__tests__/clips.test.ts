import { describe, expect, it } from "vitest";
import { monsterTruckClipState } from "../lib/clipState";

describe("Monster Truck recording phases", () => {
  const active = { hasStarted: true, isPaused: false, showGarage: false, showChallenges: false, sessionCoins: 12 };
  it("starts only after Play and the real renderer canvas arrives", () => {
    expect(monsterTruckClipState(active, false, false).phase).toBe("idle");
    expect(monsterTruckClipState({ ...active, hasStarted: false }, false, true).phase).toBe("idle");
    expect(monsterTruckClipState(active, false, true)).toEqual({ phase: "playing", score: 12, best: 0 });
  });
  it.each(["isPaused", "showGarage", "showChallenges"] as const)("holds the same run under %s", key => {
    expect(monsterTruckClipState({ ...active, [key]: true }, false, true).phase).toBe("hold");
  });
  it("holds while a shell sheet is open, and resumes without a new run", () => {
    expect(monsterTruckClipState(active, true, true).phase).toBe("hold");
    expect(monsterTruckClipState(active, false, true).phase).toBe("playing");
  });
});
