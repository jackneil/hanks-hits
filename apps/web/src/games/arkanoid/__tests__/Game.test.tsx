import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// useAuthSync pulls in next-auth's useSession, which needs a provider we don't
// mount in unit tests. Stub it with the shape the game destructures.
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

import { ArkanoidGame } from "../Game";
import { useArkanoidStore } from "../lib/store";

// The global setup stubs matchMedia to always return matches:false. Swap in a
// stub where "(pointer: coarse)" resolves to the requested value so we can
// simulate touch vs keyboard/mouse viewports (drives the GameStartOverlay hint
// switch, mirroring the other games' tests).
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("ArkanoidGame Component (GameShell-wrapped)", () => {
  beforeEach(() => {
    mockPointer(false);
    // Keep the animation loop from ticking during assertions (it would run the
    // sim and re-render outside act); DOM state is set at render time regardless.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // Reset store to menu state before each test.
    act(() => {
      useArkanoidStore.setState({
        gameState: "menu",
        score: 0,
        multiplier: 1,
        balls: [],
        wasNewHighScore: false,
        paddleX: 0,
        soundEnabled: true,
        progress: {
          highScore: 0,
          totalGamesPlayed: 0,
          totalBallsSpawned: 0,
          highestMultiplier: 1,
          lastModified: Date.now(),
        },
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockPointer(false);
  });

  it("shows the shared DOM start-overlay title exactly once in the menu", () => {
    render(<ArkanoidGame />);
    // GameStartOverlay renders the title once; the old bespoke menu <h1> is gone.
    expect(
      screen.getAllByRole("heading", { name: "Arkanoid" })
    ).toHaveLength(1);
    expect(screen.getByText("Chain Reaction Mayhem")).toBeInTheDocument();
  });

  it("no longer renders an in-module home link or pause button (the shell owns them)", () => {
    const { container } = render(<ArkanoidGame />);
    // The old bespoke bar had a <Link href="/"> home button — gone now.
    expect(container.querySelector("a")).toBeNull();
    // ...and a ⏸ / ▶ pause toggle — the ⏸ glyph must not appear in the module
    // (▶ is allowed: it is the shared start button's default label).
    expect(screen.queryByText("⏸")).not.toBeInTheDocument();
  });

  it("keeps the score HUD (live multiplier/high line + sound toggle)", () => {
    render(<ArkanoidGame />);
    expect(screen.getByText(/Multiplier/)).toBeInTheDocument();
    expect(screen.getByText(/High:/)).toBeInTheDocument();
    // Sound toggle survives with a descriptive, >=44px accessible target.
    expect(
      screen.getByRole("button", { name: /sound/i })
    ).toBeInTheDocument();
  });

  it("names the real controls in the start-overlay hints per pointer type", () => {
    mockPointer(true);
    render(<ArkanoidGame />);
    expect(
      screen.getByText("Slide your finger to move the paddle")
    ).toBeInTheDocument();
    expect(screen.getByText("Tap to launch the ball")).toBeInTheDocument();
    // Mouse copy must not show to touch users.
    expect(
      screen.queryByText("Move the paddle with your mouse")
    ).not.toBeInTheDocument();
  });

  it("shows the mouse hints on fine (desktop) pointers", () => {
    mockPointer(false);
    render(<ArkanoidGame />);
    expect(
      screen.getByText("Move the paddle with your mouse")
    ).toBeInTheDocument();
    expect(screen.getByText("Click to launch the ball")).toBeInTheDocument();
  });

  it("shows game over screen with correct content", () => {
    act(() => {
      useArkanoidStore.setState({
        gameState: "gameOver",
        score: 1500,
        wasNewHighScore: false,
        progress: {
          highScore: 2000,
          totalGamesPlayed: 5,
          totalBallsSpawned: 100,
          highestMultiplier: 3,
          lastModified: Date.now(),
        },
      });
    });

    render(<ArkanoidGame />);
    expect(screen.getByText("Game Over!")).toBeInTheDocument();
    expect(screen.getByText(/^Score:/)).toBeInTheDocument();
    expect(screen.getByText(/^High Score:/)).toBeInTheDocument();
    expect(screen.getByText(/Play Again/)).toBeInTheDocument();
  });

  it("shows 'New High Score!' message when wasNewHighScore is true", () => {
    act(() => {
      useArkanoidStore.setState({
        gameState: "gameOver",
        score: 3000,
        wasNewHighScore: true,
        progress: {
          highScore: 3000,
          totalGamesPlayed: 1,
          totalBallsSpawned: 50,
          highestMultiplier: 2,
          lastModified: Date.now(),
        },
      });
    });

    render(<ArkanoidGame />);
    expect(screen.getByText(/New High Score!/)).toBeInTheDocument();
  });

  it("does NOT show 'New High Score!' when wasNewHighScore is false", () => {
    act(() => {
      useArkanoidStore.setState({
        gameState: "gameOver",
        score: 500,
        wasNewHighScore: false,
        progress: {
          highScore: 2000,
          totalGamesPlayed: 5,
          totalBallsSpawned: 100,
          highestMultiplier: 3,
          lastModified: Date.now(),
        },
      });
    });

    render(<ArkanoidGame />);
    expect(screen.queryByText("New High Score!")).not.toBeInTheDocument();
  });
});
