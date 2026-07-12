import { beforeEach, describe, expect, it } from "vitest";

import { reportProgressToAchievements, useAchievementsStore } from "../store";

function resetStore() {
  useAchievementsStore.setState({
    progress: { unlocked: {}, lastModified: 0 },
    watermarks: { apps: {}, playedApps: [], bestIncreases: 0 },
    celebrationQueue: [],
  });
}

beforeEach(resetStore);

describe("achievements store", () => {
  it("unlocks exactly once for repeated identical reports (idempotent)", () => {
    reportProgressToAchievements("snake", { gamesPlayed: 6, highScore: 40 });
    const afterFirst = { ...useAchievementsStore.getState().progress.unlocked };
    expect(Object.keys(afterFirst)).toContain("first-play:snake");
    expect(Object.keys(afterFirst)).toContain("plays:snake:5");

    reportProgressToAchievements("snake", { gamesPlayed: 6, highScore: 40 });
    reportProgressToAchievements("snake", { gamesPlayed: 6, highScore: 40 });
    expect(useAchievementsStore.getState().progress.unlocked).toEqual(afterFirst);
    // queue holds each unlock exactly once too
    const queue = useAchievementsStore.getState().celebrationQueue;
    expect(new Set(queue).size).toBe(queue.length);
  });

  it("ignores reports about its own appId (no feedback loop)", () => {
    reportProgressToAchievements("achievements", { unlocked: { "first-play:snake": 1 }, lastModified: 5 });
    expect(useAchievementsStore.getState().progress.unlocked).toEqual({});
  });

  it("bumps lastModified only when something unlocks", () => {
    reportProgressToAchievements("snake", { gamesPlayed: 0, highScore: 0 });
    expect(useAchievementsStore.getState().progress.lastModified).toBe(0);

    reportProgressToAchievements("snake", { gamesPlayed: 1 });
    expect(useAchievementsStore.getState().progress.lastModified).toBeGreaterThan(0);
  });

  it("getProgress returns exactly the synced keys; watermarks stay out", () => {
    reportProgressToAchievements("snake", { gamesPlayed: 2 });
    const synced = useAchievementsStore.getState().getProgress();
    expect(Object.keys(synced).sort()).toEqual(["lastModified", "unlocked"]);
  });

  it("setProgress adopts server data and never re-celebrates it", () => {
    useAchievementsStore.getState().setProgress({
      unlocked: { "first-play:2048": 123, "explorer:3": 456 },
      lastModified: 789,
    });
    const s = useAchievementsStore.getState();
    expect(s.progress.unlocked["first-play:2048"]).toBe(123);
    expect(s.celebrationQueue).toEqual([]);
    // and those ids can't unlock again
    reportProgressToAchievements("2048", { gamesPlayed: 1 });
    expect(s.celebrationQueue).toEqual([]);
  });

  it("dequeueCelebration pops ids in unlock order", () => {
    reportProgressToAchievements("snake", { gamesPlayed: 6 });
    const q = [...useAchievementsStore.getState().celebrationQueue];
    expect(q.length).toBeGreaterThan(1);
    const first = useAchievementsStore.getState().dequeueCelebration();
    expect(first).toBe(q[0]);
    expect(useAchievementsStore.getState().celebrationQueue).toEqual(q.slice(1));
  });

  it("watermarks persist across evaluations so records break correctly", () => {
    reportProgressToAchievements("snake", { gamesPlayed: 1, highScore: 50 });
    reportProgressToAchievements("snake", { gamesPlayed: 2, highScore: 90 });
    expect(
      useAchievementsStore.getState().progress.unlocked["record-breaker:1"]
    ).toBeDefined();
  });
});
