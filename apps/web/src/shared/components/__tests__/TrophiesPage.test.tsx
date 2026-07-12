import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Guest by default — the page's whole reason to exist is signed-out kids.
const sessionMock = vi.hoisted(() => ({
  status: "unauthenticated" as string,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: sessionMock.status }),
}));

import { TrophiesPage } from "../TrophiesPage";
import { useAchievementsStore } from "@/shared/lib/achievements";

beforeEach(() => {
  sessionMock.status = "unauthenticated";
  localStorage.clear();
  useAchievementsStore.setState({
    progress: { unlocked: { "first-play:snake": 1000 }, lastModified: 1000 },
    watermarks: {
      apps: {
        snake: { plays: 1, best: 0, streak: 0, seeded: true, hasPlays: true, hasStreak: false },
      },
      playedApps: ["snake"],
      bestIncreases: 0,
    },
    celebrationQueue: [],
  });
});

describe("TrophiesPage (guest-visible /trophies)", () => {
  it("shows a guest their locally earned trophies — no login wall", () => {
    render(<TrophiesPage />);
    expect(screen.getByTestId("trophy-case")).toBeInTheDocument();
    expect(screen.getByText("First Play!")).toBeInTheDocument();
    // gentle, optional sign-in nudge with a 44px target
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.className).toContain("min-h-[44px]");
  });

  it("is one tap away everywhere: the shared header links 🏅 Trophies to /trophies", () => {
    // Discoverability regression: /trophies shipped as an orphan route once —
    // nothing in the UI navigated there, and the header 🏆 misdirected to
    // Leaderboards. The shared header now carries a distinct Trophies link.
    render(<TrophiesPage />);
    const trophies = screen.getByRole("link", { name: /Trophy Case/ });
    expect(trophies.getAttribute("href")).toBe("/trophies");
    const leaderboards = screen.getByRole("link", { name: "Leaderboards" });
    expect(leaderboards.getAttribute("href")).toBe("/leaderboards");
  });

  it("hides the sign-in nudge for signed-in kids", () => {
    sessionMock.status = "authenticated";
    render(<TrophiesPage />);
    expect(screen.getByTestId("trophy-case")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});
