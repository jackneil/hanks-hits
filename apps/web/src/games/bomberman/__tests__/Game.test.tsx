import { render, screen, act, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useAuthSync -> useSession needs a SessionProvider we don't mount in tests.
// Stub it to guest mode so the game renders without a provider or network.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

import BombermanGame from "../Game";
import { useBombermanStore } from "../lib/store";
import { mockPointer } from "@/__tests__/pointer-mock";

// The global setup stubs matchMedia to always return matches:false. Swap in a
// stub where "(pointer: coarse)" resolves to the requested value so we can
// simulate touch vs keyboard/mouse viewports (mirrors GameStartOverlay tests).

beforeEach(() => {
  mockPointer(false);
  // Keep the animation loop from ticking during assertions (it would run the
  // sim and re-render outside act); DOM state is set at render time regardless.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockPointer(false);
});

describe("Bomberman start overlay", () => {
  it("shows the shared DOM start overlay title exactly once in the menu", () => {
    render(<BombermanGame />);
    expect(
      screen.getAllByRole("heading", { name: "Bomberman" })
    ).toHaveLength(1);
  });

  it("renders the Play button in the menu (not clipped inside the canvas box)", () => {
    // Regression: the start overlay used to be pinned to the small canvas-sized
    // wrapper, so on a 390x844 phone the Play button fell below the fold and was
    // only reachable by scrolling a tiny inner box. The shared overlay now
    // portals to document.body and covers the viewport, with Play in the
    // card's pinned action row, so no game box can clip it.
    const { container } = render(<BombermanGame />);
    const playButton = screen.getByRole("button", { name: "▶ Play!" });
    expect(playButton).toBeInTheDocument();

    const overlay = screen.getByTestId("game-start-overlay");
    expect(overlay).toContainElement(playButton);
    expect(overlay.parentElement).toBe(document.body);
    expect(container).not.toContainElement(overlay);
    expect(screen.getByTestId("start-card-actions")).toContainElement(playButton);
  });

  it("names the on-screen controls in the touch hints on coarse pointers", () => {
    mockPointer(true);
    render(<BombermanGame />);

    expect(screen.getByText("👉 Hold an arrow to move")).toBeInTheDocument();
    expect(screen.getByText("💣 Tap the bomb to drop one")).toBeInTheDocument();
    // Keyboard copy must not show to touch users.
    expect(
      screen.queryByText("WASD or Arrows to move")
    ).not.toBeInTheDocument();
  });

  it("has no modal of its own while paused (the shell's pause menu is the one pause surface)", () => {
    // Regression: the game drew its own fixed PAUSED modal with a second
    // Resume, beside the shell's pause menu, and an in-game pause button
    // under the fold (phone UX audit 2026-09-29).
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.getState().pauseGame();
    });
    render(<BombermanGame />);
    expect(screen.queryByRole("heading", { name: /PAUSED/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /RESUME/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⏸️" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "🎮" })).not.toBeInTheDocument();
  });

  it("mounts the shared result chip at game over and at a cleared level, and never its own modal", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ gameState: "lost" });
    });
    const { unmount } = render(<BombermanGame />);
    expect(screen.queryByRole("button", { name: /TRY AGAIN/ })).not.toBeInTheDocument();
    let chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /play again/i })).toBeInTheDocument();
    expect(within(chip).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    expect(within(chip).getByTestId("result-chip-sound")).toBeInTheDocument();
    unmount();

    act(() => {
      useBombermanStore.setState({ gameState: "won" });
    });
    render(<BombermanGame />);
    expect(screen.queryByRole("button", { name: /NEXT LEVEL/ })).not.toBeInTheDocument();
    chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /next level/i })).toBeInTheDocument();
    expect(within(chip).queryByRole("button", { name: /play again/i })).not.toBeInTheDocument();
  });

  it("hides the D-pad on fine (desktop) pointers while playing", () => {
    mockPointer(false);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);

    expect(useBombermanStore.getState().gameState).toBe("playing");
    expect(screen.queryByTestId("bomberman-dpad")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bomberman-bomb")).not.toBeInTheDocument();
  });

  it("shows the D-pad and the bomb button on coarse (touch) pointers while playing", () => {
    mockPointer(true);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);

    expect(useBombermanStore.getState().gameState).toBe("playing");
    expect(screen.getByTestId("bomberman-dpad")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop a bomb" })).toBeInTheDocument();
  });
});
