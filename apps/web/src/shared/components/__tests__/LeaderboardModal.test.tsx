import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeaderboardModal } from "../LeaderboardModal";

vi.mock("../Leaderboard", () => ({
  Leaderboard: () => <div>Leaderboard content</div>,
}));

describe("LeaderboardModal", () => {
  it("portals the dialog to document.body so fixed positioning uses the viewport", () => {
    render(
      <div className="fixed top-0 h-14">
        <LeaderboardModal
          isOpen
          onClose={vi.fn()}
          appId="dino-runner"
          gameName="Dino Runner"
          icon="🦖"
        />
      </div>
    );

    expect(screen.getByRole("dialog").parentElement).toBe(document.body);
  });
});
