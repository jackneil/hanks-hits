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

  it("collapses a deep queue into ONE summary toast instead of a toast parade", () => {
    // Retroactive burst: an existing player's first evaluation can award
    // first-play + several tiers at once — 4+ queued unlocks would stack
    // 16s+ of toasts over gameplay.
    resetAchievements([
      "first-play:snake",
      "plays:snake:5",
      "plays:snake:25",
      "streak:snake:3",
      "explorer:3",
    ]);
    render(<AchievementCelebrations />);

    expect(screen.getByText("You earned 5 trophies!")).toBeInTheDocument();
    // The pointer must work for a GUEST too — the Trophy Case is the
    // guest-visible /trophies page, never a login-walled destination.
    expect(
      screen.getByText("See them all in your Trophy Case!")
    ).toBeInTheDocument();

    // Dismissing the summary drains the whole batch at once.
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(useAchievementsStore.getState().celebrationQueue).toEqual([]);
  });

  it("summarizes at exactly one past the threshold (queue of 4) and the summary's own timer drains everything", () => {
    resetAchievements([
      "first-play:snake",
      "plays:snake:5",
      "plays:snake:25",
      "explorer:3",
    ]);
    render(<AchievementCelebrations />);

    // boundary: 4 > SUMMARY_THRESHOLD(3) -> summary, not individual toasts
    expect(screen.getByText("You earned 4 trophies!")).toBeInTheDocument();

    // the AUTO-ADVANCE path (not the button) must clear the whole batch too
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByTestId("achievement-celebration")).toBeNull();
    expect(useAchievementsStore.getState().celebrationQueue).toEqual([]);
  });

  it("a stale auto-advance timer racing a tap cannot swallow the next toast", () => {
    resetAchievements(["first-play:snake", "plays:snake:5"]);
    render(<AchievementCelebrations />);
    expect(screen.getByText(/First Play!/)).toBeInTheDocument();

    // Simulate the race: the timer's dequeue fires for an id that is no
    // longer the head (the tap already advanced it) — it must no-op.
    act(() => {
      screen.getByRole("button", { name: "Dismiss celebration" }).click();
      // stale timer callback for the ALREADY-DISMISSED head
      useAchievementsStore.getState().dequeueCelebration("first-play:snake");
    });
    // The second toast still gets its window instead of being skipped.
    expect(screen.getByText(/Regular!/)).toBeInTheDocument();
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
