import { describe, expect, it } from "vitest";
import { mergeProgress, mergeForSave, extractTimestamp } from "../progress-merge";

describe("mergeProgress", () => {
  it("prefers server data when it is genuinely newer", () => {
    const result = mergeProgress(
      { score: 200, lastModified: 1000 },
      { score: 100, lastModified: 2000 },
      1000,
      2000
    );

    expect(result.source).toBe("server");
    expect(result.data.score).toBe(100);
  });

  it("prefers local data when it is newer than the server blob", () => {
    const result = mergeProgress(
      { score: 200, lastModified: 2000 },
      { score: 100, lastModified: 1000 },
      2000,
      1000
    );

    expect(result.source).toBe("local");
    expect(result.data.score).toBe(200);
  });

  it("uses local data when there is no existing server data", () => {
    const result = mergeProgress({ score: 200 }, null, null, null);

    expect(result.source).toBe("local");
    expect(result.data).toEqual({ score: 200 });
  });

  it("uses server data when there is no local data", () => {
    const result = mergeProgress(null, { score: 100 }, null, 1000);

    expect(result.source).toBe("server");
    expect(result.data).toEqual({ score: 100 });
  });

  it("takes the max of monotonic counters from BOTH sides", () => {
    const result = mergeProgress(
      { highScore: 50, totalClicks: 500, cookies: 20, lastModified: 2000 },
      { highScore: 120, totalClicks: 300, cookies: 999, lastModified: 1000 },
      2000,
      1000
    );

    // local wins LWW, but the server's better highScore survives
    expect(result.data.highScore).toBe(120);
    expect(result.data.totalClicks).toBe(500);
    // spendable balances are NOT monotonic — winner's value stands
    expect(result.data.cookies).toBe(20);
    expect(result.source).toBe("merged");
  });

  it("never refunds a spent wallet: totalCoins is spendable, not monotonic", () => {
    // endless-runner: 500 coins, kid unlocks a 400-coin character -> newer
    // blob has 100 coins + the character. max() on totalCoins would refund
    // the 400 (the dcr finding). The newer blob's wallet must stand.
    const result = mergeProgress(
      {
        totalCoins: 100,
        unlockedCharacters: ["dino", "robot"],
        lastModified: 2000,
      },
      { totalCoins: 500, unlockedCharacters: ["dino"], lastModified: 1000 },
      2000,
      1000
    );

    expect(result.data.totalCoins).toBe(100);
    expect(result.data.unlockedCharacters).toEqual(["dino", "robot"]);
  });

  it("never resurrects a broken streak: current streaks are transient", () => {
    // wordle: 5-streak on the server, kid loses a game -> newer blob has
    // currentStreak 0. max() would resurrect the broken streak; only the
    // best/max records may take max.
    const result = mergeProgress(
      { currentStreak: 0, maxStreak: 5, gamesPlayed: 10, lastModified: 2000 },
      { currentStreak: 5, maxStreak: 5, gamesPlayed: 9, lastModified: 1000 },
      2000,
      1000
    );

    expect(result.data.currentStreak).toBe(0);
    expect(result.data.maxStreak).toBe(5);
    expect(result.data.gamesPlayed).toBe(10);
  });

  it("unions unlockable collections from both sides", () => {
    const result = mergeProgress(
      { purchasedUpgrades: ["a"], unlockedAchievements: ["x"], lastModified: 2000 },
      { purchasedUpgrades: ["a", "b"], unlockedAchievements: ["y"], lastModified: 1000 },
      2000,
      1000
    );

    expect(result.data.purchasedUpgrades).toEqual(["a", "b"]);
    expect(result.data.unlockedAchievements).toEqual(["x", "y"]);
  });

  it("unions unlockable OBJECT maps (trophy records) instead of last-write-wins", () => {
    // Regression: two devices playing concurrently — the loser's trophies
    // must survive the merge, keeping the EARLIEST unlock time for shared ids.
    const result = mergeProgress(
      { unlocked: { "first-play:snake": 5000, "explorer:3": 8000 }, lastModified: 9000 },
      { unlocked: { "first-play:snake": 3000, "record-breaker:1": 7000 }, lastModified: 7500 },
      9000,
      7500
    );

    expect(result.data.unlocked).toEqual({
      "first-play:snake": 3000, // earliest wins for shared ids
      "explorer:3": 8000,
      "record-breaker:1": 7000, // loser-only trophy survives
    });
    expect(result.source).toBe("merged");
  });

  it("does not union object maps whose key is not unlockable-named", () => {
    const result = mergeProgress(
      { ratings: { j1: 1 }, lastModified: 2000 },
      { ratings: { j2: 2 }, lastModified: 1000 },
      2000,
      1000
    );
    expect(result.data.ratings).toEqual({ j1: 1 });
  });

  it("a hostile __proto__ trophy id cannot pollute Object.prototype through the union", () => {
    const hostile = JSON.parse(
      '{"unlocked":{"__proto__":1,"first-play:snake":2},"lastModified":1000}'
    );
    const result = mergeProgress(
      { unlocked: { "explorer:3": 3 }, lastModified: 2000 },
      hostile,
      2000,
      1000
    );

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(result.data.unlocked as object)).toContain("first-play:snake");
    // the merged record is a plain data object, prototype untouched
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("mergeForSave — the audit wipe regression", () => {
  // Replays the exact 2026-07-10 audit failure: the server holds the all-zero
  // blob written at mount time; the client uploads a real session (120 clicks,
  // an upgrade, achievements) with merge=true. The old code hardcoded the
  // client timestamp to null, so the zero blob always won and the session was
  // destroyed. The good data must win now.
  const zeroBlob = {
    cookies: 0,
    totalCookiesBaked: 0,
    totalClicks: 0,
    purchasedUpgrades: [] as string[],
    unlockedAchievements: [] as string[],
    lastModified: 1_000_000, // written at page-load time
  };
  const goodBlob = {
    cookies: 20,
    totalCookiesBaked: 120,
    totalClicks: 120,
    purchasedUpgrades: ["plastic-mouse"],
    unlockedAchievements: ["first-cookie", "cookie-novice", "clicker"],
    lastModified: 1_060_000, // one minute of play later
  };

  it("newer client session survives a stale zero blob on the server", () => {
    const result = mergeForSave(goodBlob, {
      data: zeroBlob,
      // row updatedAt is NEWER than both blobs (refreshed by a no-op write);
      // it must NOT override the blobs' own ordering
      updatedAt: new Date(2_000_000),
    });

    expect(result.data.totalCookiesBaked).toBe(120);
    expect(result.data.totalClicks).toBe(120);
    expect(result.data.purchasedUpgrades).toEqual(["plastic-mouse"]);
    expect(result.data.unlockedAchievements).toContain("first-cookie");
  });

  it("a stale zero blob POSTed late cannot erase newer server progress", () => {
    // The reverse race: a zero/default blob arrives AFTER good data was saved.
    const result = mergeForSave(
    { ...zeroBlob, lastModified: 1_030_000 },
      { data: goodBlob, updatedAt: new Date(1_060_000) }
    );

    expect(result.data.totalCookiesBaked).toBe(120);
    expect(result.data.purchasedUpgrades).toEqual(["plastic-mouse"]);
  });

  it("a genuinely newer default-state blob still cannot erase earned monotonic progress", () => {
    // Pre-hydration default state stamped with a NEWER Date.now() — the audit's
    // nastiest case. LWW picks it, but reconcile folds the earned progress in.
    const freshDefault = { ...zeroBlob, lastModified: 2_000_000 };
    const result = mergeForSave(freshDefault, {
      data: goodBlob,
      updatedAt: new Date(1_060_000),
    });

    expect(result.data.totalCookiesBaked).toBe(120);
    expect(result.data.totalClicks).toBe(120);
    expect(result.data.purchasedUpgrades).toEqual(["plastic-mouse"]);
    expect(result.data.unlockedAchievements).toEqual([
      "first-cookie",
      "cookie-novice",
      "clicker",
    ]);
  });

  it("first save with no existing row stores the incoming data", () => {
    const result = mergeForSave(goodBlob, null);
    expect(result.data).toEqual(goodBlob);
  });

  it("a forged far-future lastModified gets no lasting ordering advantage", () => {
    // Attacker saved a blob stamped 23h in the future (schema allows +24h) 10
    // minutes ago, trying to make their row un-overwritable. Its ordering
    // timestamp is bounded by the row's server-recorded updatedAt (+5min
    // skew), so an honest save stamped "now" wins non-monotonic fields.
    const forged = {
      cookies: 999,
      soundEnabled: false,
      totalCookiesBaked: 5,
      lastModified: Date.now() + 23 * 60 * 60 * 1000,
    };
    const honest = {
      cookies: 10,
      soundEnabled: true,
      totalCookiesBaked: 50,
      lastModified: Date.now(),
    };
    const result = mergeForSave(honest, {
      data: forged,
      updatedAt: new Date(Date.now() - 10 * 60_000), // row written 10 min ago
    });

    // Honest blob wins LWW for non-monotonic fields...
    expect(result.data.cookies).toBe(10);
    expect(result.data.soundEnabled).toBe(true);
    // ...while monotonic reconcile still keeps the max.
    expect(result.data.totalCookiesBaked).toBe(50);
  });
});

describe("extractTimestamp", () => {
  it("reads numeric lastModified", () => {
    expect(extractTimestamp({ lastModified: 123 })).toBe(123);
  });
  it("returns null when no timestamp field exists", () => {
    expect(extractTimestamp({ score: 1 })).toBeNull();
  });
});
