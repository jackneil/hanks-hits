import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { TrophyCase } from "../components/TrophyCase";
import { useAchievementsStore } from "@/shared/lib/achievements";

function setUnlocked(unlocked: Record<string, number>) {
  useAchievementsStore.setState({
    progress: { unlocked, lastModified: Date.now() },
    watermarks: { apps: {}, playedApps: [], bestIncreases: 0 },
    celebrationQueue: [],
  });
}

beforeEach(() => {
  localStorage.clear();
  setUnlocked({});
});

describe("TrophyCase", () => {
  it("shows a kid-warm empty state before any trophy", () => {
    render(<TrophyCase />);
    expect(
      screen.getByText(/No trophies yet — play any game to earn your first one!/)
    ).toBeInTheDocument();
  });

  it("groups unlocked trophies per played game with locked ones dimmed", () => {
    setUnlocked({
      "first-play:snake": 1000,
      "plays:snake:5": 2000,
    });
    render(<TrophyCase />);

    // Count badge
    expect(screen.getByText("2")).toBeInTheDocument();
    // Unlocked entries show their copy
    expect(screen.getByText("First Play!")).toBeInTheDocument();
    expect(screen.getByText("Regular!")).toBeInTheDocument();
    // Locked next tiers appear dimmed with a lock
    expect(screen.getByText("Super Fan!")).toBeInTheDocument();
    const lockedRow = screen.getByText("Super Fan!").closest("li");
    expect(lockedRow?.className).toContain("opacity-60");
    expect(screen.getAllByText("🔒").length).toBeGreaterThan(0);
  });

  it("always shows the cross-game group, locked or not", () => {
    setUnlocked({ "first-play:snake": 1000 });
    render(<TrophyCase />);
    expect(screen.getByText("All Games")).toBeInTheDocument();
    expect(screen.getByText("Explorer!")).toBeInTheDocument();
    expect(screen.getByText("Record Breaker!")).toBeInTheDocument();
  });

  it("does not invent groups for unplayed games", () => {
    setUnlocked({ "first-play:snake": 1000 });
    render(<TrophyCase />);
    // Only snake + the global group render
    const groups = screen.getByTestId("trophy-case").querySelectorAll("h3");
    expect(groups.length).toBe(2);
  });
});
