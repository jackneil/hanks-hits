import { describe, expect, it } from "vitest";

import { evaluate, emptyWatermarks } from "../evaluate";
import { getAchievementInfo } from "../definitions";

const none = new Set<string>();

describe("achievements evaluate", () => {
  it("unlocks first-play only when the blob shows evidence of actual play", () => {
    // Default store state (all zeros) is written the moment a game mounts —
    // that must NOT count as playing it.
    const idle = evaluate("snake", { gamesPlayed: 0, highScore: 0 }, none, emptyWatermarks());
    expect(idle.newUnlocks).toEqual([]);

    const played = evaluate("snake", { gamesPlayed: 1, highScore: 0 }, none, emptyWatermarks());
    expect(played.newUnlocks).toContain("first-play:snake");
  });

  it("unlocks play-count tiers retroactively in one burst for existing progress", () => {
    const { newUnlocks } = evaluate("2048", { gamesPlayed: 30 }, none, emptyWatermarks());
    expect(newUnlocks).toContain("plays:2048:5");
    expect(newUnlocks).toContain("plays:2048:25");
    expect(newUnlocks).not.toContain("plays:2048:100");
  });

  it("never re-awards an id already in the unlocked set", () => {
    const unlocked = new Set(["first-play:snake", "plays:snake:5"]);
    const { newUnlocks } = evaluate("snake", { gamesPlayed: 6 }, unlocked, emptyWatermarks());
    expect(newUnlocks).toEqual([]);
  });

  it("is idempotent: re-evaluating the same blob with returned watermarks yields nothing new", () => {
    const first = evaluate("trivia", { totalAnswered: 12, highScore: 300, longestStreak: 4 }, none, emptyWatermarks());
    expect(first.newUnlocks.length).toBeGreaterThan(0);
    const unlocked = new Set(first.newUnlocks);
    const second = evaluate("trivia", { totalAnswered: 12, highScore: 300, longestStreak: 4 }, unlocked, first.watermarks);
    expect(second.newUnlocks).toEqual([]);
  });

  it("seeds the best watermark silently, then fires record-breaker only on an observed increase over a real record", () => {
    // First sight of an existing high score: seed, no record award.
    const seed = evaluate("snake", { gamesPlayed: 3, highScore: 50 }, none, emptyWatermarks());
    expect(seed.newUnlocks).not.toContain("record-breaker:1");

    // Beating the seeded record fires it.
    const beat = evaluate("snake", { gamesPlayed: 4, highScore: 80 }, new Set(seed.newUnlocks), seed.watermarks);
    expect(beat.newUnlocks).toContain("record-breaker:1");
  });

  it("does not count going from zero to a first score as a broken record", () => {
    const seed = evaluate("snake", { gamesPlayed: 1, highScore: 0 }, none, emptyWatermarks());
    const firstScore = evaluate("snake", { gamesPlayed: 2, highScore: 10 }, new Set(seed.newUnlocks), seed.watermarks);
    expect(firstScore.newUnlocks).not.toContain("record-breaker:1");
  });

  it("unlocks streak tiers from monotonic streak fields", () => {
    const { newUnlocks } = evaluate("wordle", { gamesPlayed: 9, longestStreak: 7 }, none, emptyWatermarks());
    expect(newUnlocks).toContain("streak:wordle:3");
    expect(newUnlocks).toContain("streak:wordle:7");
  });

  it("unlocks explorer tiers as distinct apps show evidence of play", () => {
    let wm = emptyWatermarks();
    const unlocked = new Set<string>();
    for (const appId of ["snake", "2048"]) {
      const r = evaluate(appId, { gamesPlayed: 1 }, unlocked, wm);
      r.newUnlocks.forEach((id) => unlocked.add(id));
      wm = r.watermarks;
    }
    expect([...unlocked]).not.toContain("explorer:3");
    const third = evaluate("wordle", { gamesPlayed: 1 }, unlocked, wm);
    expect(third.newUnlocks).toContain("explorer:3");
  });

  it("reads nested numeric fields one level deep (drum-machine stats.padsHit)", () => {
    const { newUnlocks } = evaluate("drum-machine", { stats: { padsHit: 6, beatsCreated: 0 } }, none, emptyWatermarks());
    expect(newUnlocks).toContain("first-play:drum-machine");
    expect(newUnlocks).toContain("plays:drum-machine:5");
  });

  it("handles unknown apps and junk blobs without throwing", () => {
    expect(evaluate("future-game", {}, none, emptyWatermarks()).newUnlocks).toEqual([]);
    expect(
      evaluate("future-game", { gamesPlayed: Number.NaN, highScore: Infinity, weird: null }, none, emptyWatermarks()).newUnlocks
    ).toEqual([]);
    expect(
      evaluate("future-game", { gamesPlayed: -5 }, none, emptyWatermarks()).newUnlocks
    ).toEqual([]);
  });
});

describe("achievement display info", () => {
  it("builds kid-friendly info for every id shape", () => {
    for (const id of ["first-play:snake", "plays:snake:25", "streak:wordle:3", "explorer:10", "record-breaker:1"]) {
      const info = getAchievementInfo(id);
      expect(info.id).toBe(id);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.emoji.length).toBeGreaterThan(0);
    }
  });
});
