import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import { AchievementCelebrations } from "../AchievementCelebrations";
import { useAchievementsStore } from "@/shared/lib/achievements";

function resetAchievements(queue: string[] = []) {
  useAchievementsStore.setState({
    progress: { unlocked: {}, lastModified: 0 },
    watermarks: { apps: {}, playedApps: [], bestIncreases: 0 },
    celebrationQueue: queue,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetAchievements();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AchievementCelebrations", () => {
  it("renders nothing while the queue is empty", () => {
    render(<AchievementCelebrations />);
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
  });

  it("shows the next unlock with kid copy, never eating taps outside the dismiss button", () => {
    resetAchievements(["first-play:snake"]);
    render(<AchievementCelebrations />);

    const layer = screen.getByTestId("achievement-celebration");
    // The layer (and everything except the dismiss button) must not
    // intercept gameplay taps.
    expect(layer.className).toContain("pointer-events-none");
    expect(screen.getByText(/First Play!/)).toBeInTheDocument();

    const dismiss = screen.getByRole("button", { name: "Dismiss celebration" });
    expect(dismiss.className).toContain("pointer-events-auto");
    expect(dismiss.className).toContain("min-w-[44px]");
    expect(dismiss.className).toContain("min-h-[44px]");
  });

  it("advances through a multi-unlock queue: dismiss, then auto-advance", () => {
    resetAchievements(["first-play:snake", "plays:snake:5", "explorer:3"]);
    render(<AchievementCelebrations />);

    expect(screen.getByText(/First Play!/)).toBeInTheDocument();

    // Tap Yay! -> next unlock appears (after the idle-pull effect runs).
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
    });
    expect(screen.getByText(/Regular!/)).toBeInTheDocument();

    // Auto-advance after the show window.
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByText(/Explorer!/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(useAchievementsStore.getState().celebrationQueue).toEqual([]);
  });
});
