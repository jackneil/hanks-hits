import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LeaderboardButton } from "../LeaderboardButton";

describe("LeaderboardButton", () => {
  it("uses dark text on the yellow pause-menu button (readable contrast)", () => {
    // Regression: the "full" variant (the pause menu's Leaderboard button)
    // drew white text on yellow-500, measured at 1.91:1 in Chromium. WCAG AA
    // needs 4.5:1 for 16 px bold text. Slate-900 on yellow-500 is about 10:1.
    render(<LeaderboardButton appId="snake" variant="full" />);

    const button = screen.getByRole("button", { name: /leaderboard/i });
    expect(button.className).toMatch(/(^|\s)bg-yellow-500(\s|$)/);
    expect(button.className).toMatch(/(^|\s)text-slate-900(\s|$)/);
    expect(button.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("keeps the header icon variant unchanged (no yellow fill)", () => {
    render(<LeaderboardButton appId="snake" variant="icon" />);
    const button = screen.getByRole("button", { name: /leaderboard/i });
    expect(button.className).not.toMatch(/bg-yellow-500/);
  });
});
