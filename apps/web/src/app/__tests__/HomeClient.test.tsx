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
});
