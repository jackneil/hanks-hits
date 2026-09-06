import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { CheckersGame } from "../Game";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  resetPointerMock();
});

describe("Checkers start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<CheckersGame />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Checkers" })).toHaveLength(1);
    expect(screen.getAllByText("Checkers")).toHaveLength(1);
  });

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<CheckersGame />);

    expect(
      screen.getByText("👆 Tap a piece, then tap where it goes")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("🖱️ Click a piece, then click where it goes")
    ).not.toBeInTheDocument();
  });

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<CheckersGame />);

    expect(
      screen.getByText("🖱️ Click a piece, then click where it goes")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap a piece, then tap where it goes")
    ).not.toBeInTheDocument();
  });

  it("starts exactly once even when Play is mashed, and the overlay goes away", () => {
    render(<CheckersGame />);

    const play = screen.getByRole("button", { name: "▶ Play!" });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checkers" })
    ).not.toBeInTheDocument();
  });
});

describe("checkers controls under the start card", () => {
  it("makes the covered game controls inert until Play is pressed", () => {
    // Regression: the board and its New Game button mount UNDER the start
    // card, so Tab reached them before Play and a tap could land on them.
    render(<CheckersGame />);

    const newGame = screen.getByRole("button", { name: /New Game/i });
    const covered = newGame.closest("[inert]");
    expect(covered).not.toBeNull();
    expect(covered!.contains(screen.getByTestId("game-start-overlay"))).toBe(
      false
    );

    fireEvent.click(screen.getByRole("button", { name: /Play/i }));

    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New Game/i }).closest("[inert]")
    ).toBeNull();
  });
});
