import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

describe("guest word projection preserves B1 timestamps", () => {
  async function fixture() {
    const rules = await import("@/shared/lib/untouchedProgress");
    const { projectGuestSave } = await import("../admission");
    const rule = rules.defineUntouchedProgress("oregon-trail", {
      layout: "flat",
      defaults: { leaderName: "", party: [], milesTraveled: 0, lastModified: 0 },
    });
    const state = rules.markSavedWithSum(rule, {
      leaderName: "Guest name", party: [{ name: "Guest companion" }], milesTraveled: 20, lastModified: 100,
    });
    return { ...rules, projectGuestSave, rule, state };
  }

  it("does not make a played Oregon journey newer when checksum-covered names are removed", async () => {
    const { projectGuestSave, rule, state, settleSave, progressSum, PROGRESS_SUM_KEY } = await fixture();
    const raw = JSON.stringify({ state, version: 1 });
    const projected = JSON.parse(projectGuestSave("oregon-trail", raw, 9_000)!);
    expect(projected.version).toBe(1);
    expect(projected.state).toMatchObject({ leaderName: "", party: [{ name: "" }], milesTraveled: 20, lastModified: 100 });
    expect(projected.state[PROGRESS_SUM_KEY]).toBe(progressSum(rule, projected.state));
    expect(settleSave(projected.state, rule, 90_000)).toMatchObject({ lastModified: 100 });
    expect(JSON.parse(raw).state.leaderName).toBe("Guest name");
  });

  it("honors an actual old-client edit before replacing its stale checksum", async () => {
    const { projectGuestSave, rule, state, settleSave } = await fixture();
    const changed = { ...state, milesTraveled: 35 };
    const projected = JSON.parse(projectGuestSave("oregon-trail", JSON.stringify({ state: changed, version: 1 }), 9_000)!);
    expect(projected.state.lastModified).toBe(9_000);
    expect(settleSave(projected.state, rule, 90_000)).toMatchObject({ lastModified: 9_000, milesTraveled: 35 });
  });

  it("waits for a word-bearing game's normalization rule instead of guessing its checksum", async () => {
    const { projectGuestSave } = await import("../admission");
    const raw = JSON.stringify({ state: { leaderName: "Guest", lastModified: 100, progressTimeSum: "uninterpreted" }, version: 1 });
    expect(projectGuestSave("oregon-trail", raw, 9_000)).toBeNull();
  });
});
