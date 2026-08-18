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

  it("resets the active session without erasing durable progress", () => {
    const lastModified = 123456789;
    const buildings = { ...createBuildings(), cursor: 4 };
    useCookieClickerStore.setState({
      cookies: 9876,
      totalCookiesBaked: 12345,
      totalClicks: 321,
      buildings,
      purchasedUpgrades: ["reinforced-finger"] as UpgradeId[],
      unlockedAchievements: ["first-cookie"] as AchievementId[],
      soundEnabled: false,
      lastTick: 100,
      lastModified,
      frenzyMultiplier: GAME_CONFIG.FRENZY_MULTIPLIER,
      frenzyEndTime: Date.now() + 10_000,
      clickFrenzyMultiplier: GAME_CONFIG.CLICK_FRENZY_MULTIPLIER,
      clickFrenzyEndTime: Date.now() + 10_000,
      newAchievements: ["first-cookie"] as AchievementId[],
      floatingTexts: [{ id: "float", x: 50, y: 50, text: "+1" }],
      goldenCookie: {
        id: "golden",
        x: 20,
        y: 30,
        effect: "frenzy",
        expiresAt: Date.now() + 10_000,
      },
    });

    useCookieClickerStore.getState().resetSession();
    const state = useCookieClickerStore.getState();

    expect(state.cookies).toBe(9876);
    expect(state.totalCookiesBaked).toBe(12345);
    expect(state.totalClicks).toBe(321);
    expect(state.buildings).toEqual(buildings);
    expect(state.purchasedUpgrades).toEqual(["reinforced-finger"]);
    expect(state.unlockedAchievements).toEqual(["first-cookie"]);
    expect(state.soundEnabled).toBe(false);
    expect(state.lastModified).toBe(lastModified);
    expect(state.frenzyMultiplier).toBe(1);
    expect(state.frenzyEndTime).toBe(0);
    expect(state.clickFrenzyMultiplier).toBe(1);
    expect(state.clickFrenzyEndTime).toBe(0);
    expect(state.newAchievements).toEqual([]);
    expect(state.floatingTexts).toEqual([]);
    expect(state.goldenCookie).toBeNull();
    expect(state.cookiesPerClick).toBe(GAME_CONFIG.BASE_CLICK_VALUE + 1);
  });
});
