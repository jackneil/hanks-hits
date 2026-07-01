import { beforeEach, describe, expect, it } from "vitest";
import { useCookieClickerStore } from "../lib/store";
import {
  GAME_CONFIG,
  type BuildingId,
  type UpgradeId,
  type AchievementId,
} from "../lib/constants";

const buildingIds: BuildingId[] = [
  "cursor",
  "grandma",
  "bakery",
  "factory",
  "mine",
  "bank",
  "temple",
  "wizardTower",
  "spaceship",
  "alchemyLab",
];

function createBuildings(value = 0): Record<BuildingId, number> {
  return Object.fromEntries(
    buildingIds.map((buildingId) => [buildingId, value])
  ) as Record<BuildingId, number>;
}

function resetStore() {
  localStorage.clear();
  useCookieClickerStore.setState({
    cookies: 0,
    totalCookiesBaked: 0,
    totalClicks: 0,
    buildings: createBuildings(),
    purchasedUpgrades: [] as UpgradeId[],
    unlockedAchievements: [] as AchievementId[],
    soundEnabled: false,
    lastTick: Date.now(),
    lastModified: Date.now(),
    cookiesPerClick: GAME_CONFIG.BASE_CLICK_VALUE,
    cookiesPerSecond: 0,
    frenzyMultiplier: 1,
    frenzyEndTime: 0,
    clickFrenzyMultiplier: 1,
    clickFrenzyEndTime: 0,
    newAchievements: [],
    floatingTexts: [],
    goldenCookie: null,
  });
}

describe("Cookie Clicker golden cookies", () => {
  beforeEach(() => {
    resetStore();
  });

  it("spawns and applies a frenzy golden cookie", () => {
    useCookieClickerStore.getState().spawnGoldenCookie("frenzy");

    expect(useCookieClickerStore.getState().goldenCookie?.effect).toBe("frenzy");

    const effect = useCookieClickerStore.getState().clickGoldenCookie();

    expect(effect).toBe("frenzy");
    expect(useCookieClickerStore.getState().goldenCookie).toBeNull();
    expect(useCookieClickerStore.getState().frenzyMultiplier).toBe(
      GAME_CONFIG.FRENZY_MULTIPLIER
    );
  });

  it("applies lucky golden cookie bank rewards", () => {
    useCookieClickerStore.setState({
      cookies: 1000,
      totalCookiesBaked: 1000,
      buildings: {
        ...createBuildings(),
        cursor: 10,
      },
    });
    useCookieClickerStore.getState().spawnGoldenCookie("lucky");

    useCookieClickerStore.getState().clickGoldenCookie();

    expect(useCookieClickerStore.getState().cookies).toBe(1100);
    expect(useCookieClickerStore.getState().totalCookiesBaked).toBe(1100);
  });
});
