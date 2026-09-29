import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Leaderboard } from "../Leaderboard";

/** Five players; the kid ("Hank") is third, an even row index (2) in the table. */
const DATA = {
  leaderboard: [
    { rank: 1, handle: "RocketFox", score: 9800 },
    { rank: 2, handle: "TruckKid", score: 7400 },
    { rank: 3, handle: "Hank", score: 6100 },
    { rank: 4, handle: "GolfAce", score: 5200 },
    { rank: 5, handle: "SoccerStar", score: 4100 },
  ],
  myEntry: { rank: 3, handle: "Hank", score: 6100 },
  totalPlayers: 5,
  period: "all",
  scoreType: "high_score",
};

describe("Leaderboard: the kid's own row", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(DATA), { headers: { "content-type": "application/json" } }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function rows() {
    render(<Leaderboard appId="snake" gameName="Snake" />);
    await screen.findByText("SoccerStar");
    const all = screen.getAllByRole("row").filter((row) => row.querySelector('[role="cell"]'));
    const mine = all.find((row) => within(row).queryByText("Hank"))!;
    return { all, mine };
  }

  it("is marked by one selected-row background, not a colored edge stripe", async () => {
    const { mine } = await rows();
    expect(mine).toHaveAttribute("data-current-player", "true");
    expect(mine.className).not.toMatch(/border-l-/);
    expect(mine).toHaveClass("bg-primary/25");
  });

  it("does not get the zebra background too (it beat the selected-row color before)", async () => {
    const { mine, all } = await rows();
    // Rows 0, 2 and 4 are zebra rows. The kid's row is row 2: it must have
    // only its own background, or the CSS order decides which one shows.
    expect(all.indexOf(mine)).toBe(2);
    expect(mine.className).not.toMatch(/bg-slate-800\/30/);
    expect(mine.className).not.toMatch(/hover:bg-/);
    expect(all[0]).toHaveClass("bg-slate-800/30");
    expect(all[4]).toHaveClass("bg-slate-800/30");
    expect(all[1].className).not.toMatch(/bg-primary/);
  });

  it("puts weight on the kid's name, and the YOU tag is readable", async () => {
    const { mine, all } = await rows();
    expect(within(mine).getByText("Hank")).toHaveClass("font-bold");
    expect(within(all[0]).getByText("RocketFox")).toHaveClass("font-medium");
    // The old tag was blue words on a pale blue tint over a dark row.
    expect(within(mine).getByText("YOU")).toHaveClass("bg-primary", "text-primary-content");
  });
});
