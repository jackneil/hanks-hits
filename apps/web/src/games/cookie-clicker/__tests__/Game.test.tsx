import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CookieClickerGame } from "../Game";
import { useCookieClickerStore } from "../lib/store";
import {
  GAME_CONFIG,
  type AchievementId,
  type BuildingId,
  type UpgradeId,
} from "../lib/constants";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: vi.fn(),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

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

function createBuildings(): Record<BuildingId, number> {
  return Object.fromEntries(
    buildingIds.map((buildingId) => [buildingId, 0])
  ) as Record<BuildingId, number>;
}

describe("CookieClickerGame golden cookie", () => {
  beforeEach(() => {
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
      goldenCookie: {
        id: "golden-test",
        x: 50,
        y: 50,
        effect: "clickFrenzy",
        expiresAt: Date.now() + GAME_CONFIG.GOLDEN_COOKIE_DURATION,
      },
    });
  });

  it("lets users click a visible golden cookie to activate its effect", () => {
    render(<CookieClickerGame />);

    fireEvent.click(screen.getByRole("button", { name: "Golden cookie" }));

    expect(useCookieClickerStore.getState().goldenCookie).toBeNull();
    expect(useCookieClickerStore.getState().clickFrenzyMultiplier).toBe(
      GAME_CONFIG.CLICK_FRENZY_MULTIPLIER
    );
    expect(
      screen.queryByRole("button", { name: "Golden cookie" })
    ).not.toBeInTheDocument();
  });
});
