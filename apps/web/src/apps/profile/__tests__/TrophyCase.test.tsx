import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { TrophyCase } from "../components/TrophyCase";
import { useAchievementsStore } from "@/shared/lib/achievements";
import type { Watermarks } from "@/shared/lib/achievements/evaluate";

function setStore(
  unlocked: Record<string, number>,
  watermarks: Watermarks = { apps: {}, playedApps: [], bestIncreases: 0 }
) {
  useAchievementsStore.setState({
    progress: { unlocked, lastModified: Date.now() },
    watermarks,
    celebrationQueue: [],
  });
}

const snakeCaps = {
  apps: {
    snake: {
      plays: 6,
      best: 40,
      streak: 0,
      seeded: true,
      hasPlays: true,
      hasStreak: false,
    },
  },
  playedApps: ["snake"],
  bestIncreases: 0,
};

beforeEach(() => {
  localStorage.clear();
  setStore({});
});

describe("TrophyCase", () => {
  it("shows a kid-warm empty state before any trophy", () => {
    render(<TrophyCase />);
    expect(
      screen.getByText("No trophies yet! Play any game to earn your first one!")
    ).toBeInTheDocument();
  });

  it("groups trophies per played game; locked teasers state the GOAL, not the accomplishment", () => {
    setStore({ "first-play:snake": 1000, "plays:snake:5": 2000 }, snakeCaps);
    render(<TrophyCase />);

    // Count badge
    expect(screen.getByText("2")).toBeInTheDocument();
    // Unlocked entries carry the past-tense copy
    expect(screen.getByText("First Play!")).toBeInTheDocument();
    expect(screen.getByText("Played Snake 5 times!")).toBeInTheDocument();
    // Locked next tier teases with goal phrasing, never a past-tense claim
    expect(screen.getByText("Play Snake 25 times to unlock!")).toBeInTheDocument();
    expect(screen.queryByText("Played Snake 25 times!")).toBeNull();
    expect(screen.getAllByText("🔒").length).toBeGreaterThan(0);
  });

  it("keeps locked-row TEXT readable: the lock, not the copy, is dimmed", () => {
    setStore({ "first-play:snake": 1000 }, snakeCaps);
    render(<TrophyCase />);

    const lockedRow = screen.getByText("Play Snake 5 times to unlock!").closest("li");
    // The row itself must NOT be opacity-dimmed (that made the goal copy
    // ~2.2:1 on the purple gradient — the exact text a kid needs to read)
    expect(lockedRow?.className).not.toContain("opacity-60");
    const lock = lockedRow?.querySelector("span");
    expect(lock?.className).toContain("opacity-60");
  });

  it("never teases tiers the app cannot award (capability filter)", () => {
    // snake's watermark says hasStreak: false -> no streak teasers;
    // an app with NO watermark (fresh device) teases nothing beyond first-play.
    setStore(
      { "first-play:snake": 1000, "first-play:cookie-clicker": 1500 },
      snakeCaps
    );
    render(<TrophyCase />);

    // snake has plays capability -> plays teasers show
    expect(screen.getByText("Play Snake 5 times to unlock!")).toBeInTheDocument();
    // snake has NO streak field -> no streak teaser
    expect(screen.queryByText(/in a row in Snake/)).toBeNull();
    // cookie-clicker has no watermark on this device -> no play-count teaser
    expect(screen.queryByText(/Play Cookie Clicker 5 times/)).toBeNull();
  });

  it("always shows an unlocked trophy even when the capability filter would hide its tier", () => {
    // Earned on another device whose blob carried a streak field; this
    // device's watermark says hasStreak: false. Data wins.
    setStore({ "first-play:snake": 1000, "streak:snake:3": 2000 }, snakeCaps);
    render(<TrophyCase />);
    expect(screen.getByText("A 3-in-a-row streak in Snake!")).toBeInTheDocument();
  });

  it("renders junk/hostile achievement ids as safe generic entries", () => {
    setStore({ "first-play:constructor": 1000, "<img src=x>": 2000 });
    render(<TrophyCase />);
    // No crash; the unknown-shape id falls back to the generic trophy and
    // the "constructor" appId gets the generated-metadata fallback (its own
    // name rendered as literal text), never an inherited Object property.
    expect(screen.getByTestId("trophy-case")).toBeInTheDocument();
    expect(screen.getByText("Trophy!")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("always shows the cross-game group, locked or not", () => {
    setStore({ "first-play:snake": 1000 }, snakeCaps);
    render(<TrophyCase />);
    expect(screen.getByText("All Games")).toBeInTheDocument();
    expect(screen.getByText("Explorer!")).toBeInTheDocument();
    expect(screen.getByText("Try 3 different games to unlock!")).toBeInTheDocument();
  });

  it("does not invent groups for unplayed games", () => {
    setStore({ "first-play:snake": 1000 }, snakeCaps);
    render(<TrophyCase />);
    const groups = screen.getByTestId("trophy-case").querySelectorAll("h3");
    expect(groups.length).toBe(2);
  });
});
