import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GamesIMade } from "../components/GamesIMade";
import type { GameMetadata } from "@/shared/lib/gameMetadata.generated";

// A controlled catalog: one kid-made game, one kid-made app (routes to
// /apps/), and one built-in that must stay off the list.
const catalog: Record<string, GameMetadata> = {
  "donut-catch": {
    name: "Donut Catch",
    icon: "🍩",
    color: "orange",
    description: "Catch the donuts",
    category: "arcade",
    madeByKid: true,
  },
  "puppy-pal": {
    name: "Puppy Pal",
    icon: "🐶",
    color: "pink",
    description: "Take care of a puppy",
    category: "apps",
    madeByKid: true,
  },
  snake: {
    name: "Snake",
    icon: "🐍",
    color: "orange",
    description: "Classic snake",
    category: "arcade",
    madeByKid: false,
  },
};

describe("GamesIMade", () => {
  it("lists only the kid's creations, with a count", () => {
    render(<GamesIMade catalog={catalog} />);

    const section = screen.getByTestId("games-i-made");
    expect(section).toHaveTextContent("Games I Made");
    expect(section).toHaveTextContent("2");
    expect(section).toHaveTextContent("Donut Catch");
    expect(section).toHaveTextContent("Puppy Pal");
    expect(section).not.toHaveTextContent("Snake");
  });

  it("routes a creation to its playable page, apps included", () => {
    render(<GamesIMade catalog={catalog} />);

    expect(
      screen.getByRole("link", { name: /Donut Catch/i })
    ).toHaveAttribute("href", "/games/donut-catch");
    expect(screen.getByRole("link", { name: /Puppy Pal/i })).toHaveAttribute(
      "href",
      "/apps/puppy-pal"
    );
  });

  it("renders nothing at all before the kid has made a game", () => {
    render(<GamesIMade catalog={{ snake: catalog.snake }} />);
    expect(screen.queryByTestId("games-i-made")).not.toBeInTheDocument();
  });
});
