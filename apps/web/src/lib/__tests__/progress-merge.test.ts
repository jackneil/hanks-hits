import { describe, expect, it } from "vitest";
import { mergeProgress, mergeForSave, extractTimestamp, resolveMergedSave } from "../progress-merge";
import { validateProgress } from "../progress-schemas";

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

  it("never min-merges purchased/upgrade-named numeric maps (count maps, not timestamps)", () => {
    // The record-union takes the MINIMUM per key — right for unlock
    // timestamps, corrupting for a count/level map. purchased/upgrade names
    // stay last-write-wins by design.
    const result = mergeProgress(
      { upgradeLevels: { turbo: 3 }, lastModified: 2000 },
      { upgradeLevels: { turbo: 1, wheels: 2 }, lastModified: 1000 },
      2000,
      1000
    );
    expect(result.data.upgradeLevels).toEqual({ turbo: 3 });
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

// ---------------------------------------------------------------------------
// The app's reviewed direction table (progress-field-rules.ts)
// ---------------------------------------------------------------------------
// Wave 3 F1: the name rules (high/best/max/longest/games + capital, and a
// short allowlist) missed every highest... field, most total... counters,
// records inside objects, and best times. A last-write merge then lost the
// older save's better values. Each case is a real field of a real game.

describe("mergeForSave with the app's table: the records the name rules lost", () => {
  /** The account row (older) has the better records; the device save is newer. */
  function merge(appId: string, accountOlder: Record<string, unknown>, deviceNewer: Record<string, unknown>) {
    return mergeForSave(
      { ...deviceNewer, lastModified: 2_000 },
      { data: { ...accountOlder, lastModified: 1_000 }, updatedAt: new Date(1_000) },
      appId
    ).data;
  }

  it("hill-climb: totalCoinsEarned, per-stage bests and upgrade levels survive; the wallet is the newer save's", () => {
    const data = merge(
      "hill-climb",
      {
        coins: 5_000,
        totalCoinsEarned: 9_000,
        bestDistance: 900,
        bestDistancePerStage: { countryside: 900, desert: 650 },
        vehicleUpgrades: { jeep: { engine: 3, suspension: 1, tires: 0, fuelTank: 2, nitro: 0 } },
      },
      {
        coins: 110,
        totalCoinsEarned: 110,
        bestDistance: 50,
        bestDistancePerStage: { countryside: 50 },
        vehicleUpgrades: { jeep: { engine: 0, suspension: 2, tires: 0, fuelTank: 0, nitro: 0 } },
      }
    );
    expect(data.totalCoinsEarned).toBe(9_000); // 110 with the name rules
    expect(data.coins).toBe(110);
    expect(data.bestDistancePerStage).toEqual({ countryside: 900, desert: 650 });
    expect(data.vehicleUpgrades).toEqual({ jeep: { engine: 3, suspension: 2, tires: 0, fuelTank: 2, nitro: 0 } });
  });

  it("space-invaders, bomberman, breakout, 2048: highest... and ...Completed survive", () => {
    expect(merge("space-invaders", { highestWave: 9, wavesCompleted: 40 }, { highestWave: 2, wavesCompleted: 0 })).toEqual(
      expect.objectContaining({ highestWave: 9, wavesCompleted: 40 })
    );
    expect(merge("bomberman", { highestLevel: 6, levelsCompleted: 25 }, { highestLevel: 1, levelsCompleted: 0 })).toEqual(
      expect.objectContaining({ highestLevel: 6, levelsCompleted: 25 })
    );
    expect(merge("breakout", { highestLevel: 7, totalBricksDestroyed: 800 }, { highestLevel: 1, totalBricksDestroyed: 3 })).toEqual(
      expect.objectContaining({ highestLevel: 7, totalBricksDestroyed: 800 })
    );
    expect(merge("2048", { highestTile: 512 }, { highestTile: 0 }).highestTile).toBe(512);
  });

  it("chess: totalCheckmates survives; the current streak is the newer save's", () => {
    const data = merge("chess", { totalCheckmates: 18, currentWinStreak: 5 }, { totalCheckmates: 0, currentWinStreak: 0 });
    expect(data.totalCheckmates).toBe(18);
    expect(data.currentWinStreak).toBe(0);
  });

  it("platformer: a level completed only in the older save is kept whole, and a shared level takes the better of each record", () => {
    const data = merge(
      "platformer",
      {
        levels: {
          "1-1": { completed: true, starsCollected: 3, bestTime: 40_000, coinsCollected: 12 },
          "1-2": { completed: true, starsCollected: 1, bestTime: 90_000, coinsCollected: 4 },
        },
      },
      { levels: { "1-2": { completed: false, starsCollected: 2, bestTime: null, coinsCollected: 1 } } }
    );
    expect(data.levels).toEqual({
      "1-2": { completed: true, starsCollected: 2, bestTime: 90_000, coinsCollected: 4 },
      "1-1": { completed: true, starsCollected: 3, bestTime: 40_000, coinsCollected: 12 },
    });
  });

  it("memory-match and quoridor: the better (lower) best time and fewest-moves win survive", () => {
    const memory = merge(
      "memory-match",
      { bestTimes: { easy: 21_000, medium: 48_000, hard: null, expert: null }, totalMatches: 160 },
      { bestTimes: { easy: 30_000, medium: null, hard: null, expert: null }, totalMatches: 0 }
    );
    expect(memory.bestTimes).toEqual({ easy: 21_000, medium: 48_000, hard: null, expert: null });
    expect(memory.totalMatches).toBe(160);
    // The name rules kept the newer 40 (a worse result) or took a max.
    expect(merge("quoridor", { fastestWin: 12 }, { fastestWin: 40 }).fastestWin).toBe(12);
    expect(merge("quoridor", { fastestWin: 12 }, { fastestWin: null }).fastestWin).toBe(12);
  });

  it("wordle: the wins at each number of guesses take the larger count at each place", () => {
    const data = merge(
      "wordle",
      { gamesWon: 25, guessDistribution: [0, 3, 10, 8, 4, 0, 0, 0, 0] },
      { gamesWon: 1, guessDistribution: [0, 0, 1, 0, 0, 0, 0, 0, 0] }
    );
    expect(data.gamesWon).toBe(25);
    expect(data.guessDistribution).toEqual([0, 3, 10, 8, 4, 0, 0, 0, 0]);
  });

  it("cookie-clicker and monster-truck: buildings and upgrade levels bought earlier survive; the wallets stand", () => {
    const cookie = merge(
      "cookie-clicker",
      { cookies: 6_834, buildings: { cursor: 10, grandma: 6, bakery: 2 } },
      { cookies: 777, buildings: { cursor: 2, grandma: 0, bakery: 0 } }
    );
    expect(cookie.buildings).toEqual({ cursor: 10, grandma: 6, bakery: 2 });
    expect(cookie.cookies).toBe(777);

    const level = (n: number) => ({ level: n, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] });
    const truck = merge(
      "monster-truck",
      { coins: 10_653, totalCoinsEarned: 22_327, upgrades: { monster: { engine: level(3), suspension: level(2), tires: level(0), nos: level(1) } } },
      { coins: 0, totalCoinsEarned: 0, upgrades: { monster: { engine: level(0), suspension: level(0), tires: level(1), nos: level(0) } } }
    );
    expect(truck.coins).toBe(0);
    expect(truck.totalCoinsEarned).toBe(22_327);
    expect(truck.upgrades).toEqual({ monster: { engine: level(3), suspension: level(2), tires: level(1), nos: level(1) } });
  });

  it("four-wheeler-3d: totalEarned and racesWon survive; trophies and money (reset by starvation, spent) stand", () => {
    const data = merge(
      "four-wheeler-3d",
      { money: 21_150, totalEarned: 40_000, trophies: 27, racesWon: 6, bestRaceTimeMs: 61_000 },
      { money: 19_990, totalEarned: 20_000, trophies: 0, racesWon: 1, bestRaceTimeMs: 0 }
    );
    expect(data).toEqual(
      expect.objectContaining({ money: 19_990, totalEarned: 40_000, trophies: 0, racesWon: 6, bestRaceTimeMs: 61_000 })
    );
  });

  it("endless-runner: totalCoins is a wallet (spent on characters), so the newer save's stands", () => {
    expect(merge("endless-runner", { totalCoins: 500, coinsCollected: 900 }, { totalCoins: 100, coinsCollected: 950 })).toEqual(
      expect.objectContaining({ totalCoins: 100, coinsCollected: 950 })
    );
  });

  it("reports which side is the base", () => {
    expect(mergeForSave({ a: 1, lastModified: 2 }, { data: { a: 1, lastModified: 1 }, updatedAt: new Date(1) }, "2048").base).toBe("local");
    expect(mergeForSave({ a: 1, lastModified: 1 }, { data: { a: 1, lastModified: 2 }, updatedAt: new Date(2) }, "2048").base).toBe("server");
  });
});

describe("resolveMergedSave: a merge that breaks the schema", () => {
  const validate = (data: unknown) => validateProgress("cookie-clicker", data);
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const cookie = (fields: Record<string, unknown>) => ({
    cookies: 0,
    totalCookiesBaked: 0,
    totalClicks: 0,
    buildings: {},
    purchasedUpgrades: [],
    unlockedAchievements: [],
    lastModified: 0,
    ...fields,
  });

  it("a valid merge is stored as it is", () => {
    const out = resolveMergedSave(
      cookie({ totalClicks: 5, lastModified: 1_000 }),
      { data: cookie({ totalClicks: 9, lastModified: 2_000 }), updatedAt: new Date(2_000) },
      "cookie-clicker",
      validate
    );
    expect(out).toEqual(expect.objectContaining({ kind: "write", base: "server", leftOut: [], mergeError: "" }));
  });

  it("keeps the newer row as the base and leaves out only the field that breaks the schema", () => {
    const out = resolveMergedSave(
      cookie({ cookies: 1, totalClicks: 900, unlockedAchievements: ids("d", 300), lastModified: 1_000 }),
      { data: cookie({ cookies: 50, totalClicks: 9, unlockedAchievements: ids("r", 300), lastModified: 2_000 }), updatedAt: new Date(2_000) },
      "cookie-clicker",
      validate
    );
    expect(out.kind).toBe("write");
    if (out.kind !== "write") return;
    expect(out.base).toBe("server");
    expect(out.leftOut).toEqual(["unlockedAchievements"]);
    expect(out.mergeError).toContain("unlockedAchievements");
    expect(out.data).toEqual(expect.objectContaining({ cookies: 50, totalClicks: 900, unlockedAchievements: ids("r", 300) }));
  });

  it("stores nothing when the newer row itself fails the schema of today", () => {
    const out = resolveMergedSave(
      cookie({ totalClicks: 900, lastModified: 1_000 }),
      { data: cookie({ cookies: -5, lastModified: 2_000 }), updatedAt: new Date(2_000) },
      "cookie-clicker",
      validate
    );
    expect(out).toEqual({ kind: "keepExisting", error: expect.stringContaining("cookies") });
  });

  it("never refuses a newer incoming save: a broken older row only loses its folds", () => {
    const out = resolveMergedSave(
      cookie({ totalClicks: 9, unlockedAchievements: ids("d", 300), lastModified: 2_000 }),
      { data: cookie({ totalClicks: 900, unlockedAchievements: ids("r", 300), cookies: -1, lastModified: 1_000 }), updatedAt: new Date(1_000) },
      "cookie-clicker",
      validate
    );
    expect(out.kind).toBe("write");
    if (out.kind !== "write") return;
    expect(out.base).toBe("local");
    expect(out.data).toEqual(expect.objectContaining({ totalClicks: 900, unlockedAchievements: ids("d", 300) }));
  });
});
