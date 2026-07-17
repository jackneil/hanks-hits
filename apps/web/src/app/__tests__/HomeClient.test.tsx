import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomeClient } from "../HomeClient";
import type { DisplayCategory } from "@/shared/lib/game-registry";

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
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
        "donut-catch-state",
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
  });
});
