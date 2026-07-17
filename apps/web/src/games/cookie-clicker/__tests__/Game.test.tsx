import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // Mounting the full game (ticker + floating-text machinery) legitimately
  // exceeds vitest's 5s default under full-suite parallel load — this was
  // the suite's other documented flake (with monster-truck's import), so it
  // gets a generous timeout. The assertions themselves are synchronous.
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
  }, 30_000);
});

describe("CookieClickerGame achievement toast tap-through", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
      newAchievements: ["first-cookie"] as AchievementId[],
      floatingTexts: [],
      goldenCookie: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the achievement toast with pointer-events-none so taps pass through to the cookie", () => {
    render(<CookieClickerGame />);

    // The AchievementPopups effect promotes newAchievements on a setTimeout(0).
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const toast = screen.getByText("🏆 Achievement Unlocked!").closest("div")
      ?.parentElement;
    // Walk up to the fixed positioned wrapper.
    const wrapper = screen
      .getByText("🏆 Achievement Unlocked!")
      .closest(".fixed");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("pointer-events-none");
    expect(toast).toBeTruthy();
  });

  it("still increments the click counter when the cookie is tapped while a toast shows", () => {
    render(<CookieClickerGame />);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Toast is visible.
    expect(screen.getByText("🏆 Achievement Unlocked!")).toBeInTheDocument();

    const before = useCookieClickerStore.getState().totalClicks;
    fireEvent.click(screen.getByRole("button", { name: "cookie" }));

    expect(useCookieClickerStore.getState().totalClicks).toBe(before + 1);
  });
});
