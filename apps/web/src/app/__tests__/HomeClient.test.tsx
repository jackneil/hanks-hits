import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomeClient } from "../HomeClient";
import type { DisplayCategory } from "@/shared/lib/game-registry";

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
}));

// Mutable session double: tests flip this to model signed-in/out states.
let mockSession: { user: { id: string } } | null = null;
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: mockSession,
    status: mockSession ? "authenticated" : "unauthenticated",
  }),
}));

const categories: DisplayCategory[] = [
  {
    id: "arcade",
    title: "Arcade Classics",
    emoji: "🕹️",
    gradient: "from-green-400 to-teal-500",
    bgClass: "bg-slate-900",
    items: [
      { id: "snake", name: "Snake", emoji: "🐍", href: "/games/snake" },
      { id: "2048", name: "2048", emoji: "🔢", href: "/games/2048" },
    ],
  },
  {
    id: "apps",
    title: "Fun Apps",
    emoji: "📱",
    gradient: "from-pink-400 to-red-500",
    bgClass: "bg-slate-800",
    items: [
      { id: "trivia", name: "Trivia Quiz", emoji: "🧠", href: "/apps/trivia" },
    ],
  },
];

// Same catalog, but the kid built one of the games themselves.
const categoriesWithCreation: DisplayCategory[] = [
  {
    ...categories[0],
    items: [
      ...categories[0].items,
      {
        id: "donut-catch",
        name: "Donut Catch",
        emoji: "🍩",
        href: "/games/donut-catch",
        madeByKid: true,
      },
    ],
  },
  categories[1],
];

describe("HomeClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockSession = null;
  });

  it("filters the catalog by search query", () => {
    render(<HomeClient categories={categories} />);

    fireEvent.change(screen.getByLabelText("Search games and apps"), {
      target: { value: "snake" },
    });

    expect(screen.getByText("Snake")).toBeInTheDocument();
    expect(screen.queryByText("Trivia Quiz")).not.toBeInTheDocument();
  });

  it("shows a recently played shortcut after a game card is opened", () => {
    render(<HomeClient categories={categories} />);

    fireEvent.click(screen.getByRole("link", { name: /Snake/i }));

    expect(screen.getByText("Recently Played")).toBeInTheDocument();
    expect(screen.getAllByText("Snake").length).toBeGreaterThan(1);
  });

  describe("My Games shelf", () => {
    it("shows kid-made games on the shelf, and built-ins stay off it", () => {
      render(<HomeClient categories={categoriesWithCreation} />);

      const shelf = screen.getByTestId("my-games-shelf");
      expect(shelf).toHaveTextContent("My Games");
      expect(shelf).toHaveTextContent("Donut Catch");
      expect(shelf).not.toHaveTextContent("Snake");
      // The creation ALSO stays in its normal category (dual listing).
      expect(screen.getAllByText("Donut Catch").length).toBe(2);
    });

    it("shows a personal-best stat from locally saved progress", () => {
      window.localStorage.setItem(
        "donut-catch-storage",
        JSON.stringify({
          state: { progress: { highScore: 950, lastModified: 1 } },
          version: 0,
        })
      );

      render(<HomeClient categories={categoriesWithCreation} />);

      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent("950");
    });

    it("invites a play instead of showing a stat when no local save is readable", () => {
      render(<HomeClient categories={categoriesWithCreation} />);

      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent(
        "Jump in and play!"
      );
    });

    it("invites the kid to make their first game when nothing is on the shelf", () => {
      render(<HomeClient categories={categories} />);

      const shelf = screen.getByTestId("my-games-shelf");
      expect(shelf).toHaveTextContent(/waiting for YOUR first game/i);
    });

    it("hides the shelf while searching but keeps creations findable", () => {
      render(<HomeClient categories={categoriesWithCreation} />);

      fireEvent.change(screen.getByLabelText("Search games and apps"), {
        target: { value: "donut" },
      });

      expect(screen.queryByTestId("my-games-shelf")).not.toBeInTheDocument();
      expect(screen.getByText("Donut Catch")).toBeInTheDocument();
    });

    it("hides another kid's stats when the progress-owner marker mismatches", () => {
      // Defeated-sign-out-clear scenario: kid A's save survived and the
      // owner marker still names A, but nobody (or someone else) is
      // signed in. The upload path refuses this state; display must too.
      window.localStorage.setItem("hanks-hits-progress-owner", "kid-a");
      window.localStorage.setItem(
        "donut-catch-storage",
        JSON.stringify({
          state: { progress: { highScore: 950, lastModified: 1 } },
          version: 0,
        })
      );

      render(<HomeClient categories={categoriesWithCreation} />);

      const shelf = screen.getByTestId("my-games-shelf");
      expect(shelf).not.toHaveTextContent("950");
      expect(shelf).toHaveTextContent("Jump in and play!");
    });

    it("shows the owner's own stats when the marker matches their session", () => {
      window.localStorage.setItem("hanks-hits-progress-owner", "kid-a");
      window.localStorage.setItem(
        "donut-catch-storage",
        JSON.stringify({
          state: { progress: { highScore: 950, lastModified: 1 } },
          version: 0,
        })
      );
      mockSession = { user: { id: "kid-a" } };

      render(<HomeClient categories={categoriesWithCreation} />);

      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent("950");
    });

    it("survives a poisoned-but-parseable blob without crashing the page", () => {
      window.localStorage.setItem(
        "donut-catch-storage",
        JSON.stringify({
          state: { progress: { highScore: 5, lastModified: 1e999 } },
          version: 0,
        })
      );

      render(<HomeClient categories={categoriesWithCreation} />);

      // Renders (no throw); either the stat or the fallback copy is fine.
      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent(
        /High Score: 5|Jump in and play!/
      );
    });

    it("shows a real My Land stat for four-wheeler-adventure, the real creation", () => {
      // The one game that actually ships with madeByKid: true saves under
      // its own device-owned key. This pins the alias -> extractor path
      // with the REAL id so the flagship card provably shows progress.
      window.localStorage.setItem(
        "fwa_myland_v1",
        JSON.stringify([
          { id: 1, owned: true, sizeLevel: 1, buildings: [{ type: "garage" }] },
          { id: 2, owned: true, sizeLevel: 0, buildings: [] },
          { id: 3, owned: false, sizeLevel: 0, buildings: [] },
        ])
      );
      const withFourWheeler: DisplayCategory[] = [
        {
          ...categories[0],
          items: [
            {
              id: "four-wheeler-adventure",
              name: "Four-Wheeler Adventure",
              emoji: "🐕",
              href: "/games/four-wheeler-adventure",
              madeByKid: true,
            },
          ],
        },
      ];

      render(<HomeClient categories={withFourWheeler} />);

      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent(
        "My Land: 2 plots"
      );
    });

    it("keeps the device-owned My Land stat visible even when signed out with a marker present", () => {
      // Device-owned saves never sync to an account; the game itself
      // would show this state to anyone at the computer, so the owner
      // guard does not apply.
      window.localStorage.setItem("hanks-hits-progress-owner", "kid-a");
      window.localStorage.setItem(
        "fwa_myland_v1",
        JSON.stringify([
          { id: 1, owned: true, sizeLevel: 1, buildings: [] },
        ])
      );
      const withFourWheeler: DisplayCategory[] = [
        {
          ...categories[0],
          items: [
            {
              id: "four-wheeler-adventure",
              name: "Four-Wheeler Adventure",
              emoji: "🐕",
              href: "/games/four-wheeler-adventure",
              madeByKid: true,
            },
          ],
        },
      ];

      render(<HomeClient categories={withFourWheeler} />);

      expect(screen.getByTestId("my-games-shelf")).toHaveTextContent(
        "My Land: 1 plot"
      );
    });
  });
});
