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
});

describe("extractTimestamp", () => {
  it("reads numeric lastModified", () => {
    expect(extractTimestamp({ lastModified: 123 })).toBe(123);
  });
  it("returns null when no timestamp field exists", () => {
    expect(extractTimestamp({ score: 1 })).toBeNull();
  });
});
