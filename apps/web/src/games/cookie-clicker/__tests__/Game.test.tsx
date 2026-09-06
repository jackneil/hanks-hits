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

/**
 * The global setup installs a matchMedia stub that always returns
 * matches: false. This swaps in one where "(pointer: coarse)" resolves to the
 * requested value so we can simulate touch vs mouse viewports.
 */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

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

    // The bakery is gated behind the shared start overlay.
    fireEvent.click(screen.getByRole("button", { name: /play/i }));

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

describe("CookieClickerGame start overlay", () => {
  beforeEach(() => {
    localStorage.clear();
    useCookieClickerStore.setState({
      cookies: 0,
      totalCookiesBaked: 0,
      totalClicks: 0,
      buildings: createBuildings(),
      purchasedUpgrades: [] as UpgradeId[],
      unlockedAchievements: [] as AchievementId[],
      newAchievements: [],
      floatingTexts: [],
      goldenCookie: null,
    });
  });

  afterEach(() => {
    mockPointer(false);
  });

  it("shows the shared overlay with the title exactly once", () => {
    render(<CookieClickerGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Cookie Clicker" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Cookie Clicker")).toHaveLength(1);
  }, 30_000);

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<CookieClickerGame />);

    expect(screen.getByText("🍪 Tap the cookie to bake")).toBeInTheDocument();
    expect(
      screen.queryByText("🍪 Click the cookie to bake")
    ).not.toBeInTheDocument();
  }, 30_000);

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<CookieClickerGame />);

    expect(screen.getByText("🍪 Click the cookie to bake")).toBeInTheDocument();
    expect(
      screen.queryByText("🍪 Tap the cookie to bake")
    ).not.toBeInTheDocument();
  }, 30_000);

  it("bakes nothing before Play, and starts exactly once when Play is mashed", () => {
    render(<CookieClickerGame />);

    // The cookie is dead under the overlay.
    fireEvent.click(screen.getByRole("button", { name: "cookie" }));
    expect(useCookieClickerStore.getState().totalClicks).toBe(0);

    const play = screen.getByRole("button", { name: /play/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();

    // One start, and the cookie is live exactly once per real tap.
    fireEvent.click(screen.getByRole("button", { name: "cookie" }));
    expect(useCookieClickerStore.getState().totalClicks).toBe(1);
  }, 30_000);
});
