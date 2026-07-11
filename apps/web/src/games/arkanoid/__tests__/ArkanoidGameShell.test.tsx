import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// GameShell -> useGameShell reads next/navigation's useRouter, which throws
// without the App Router context we never mount in unit tests. Stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// The inner ArkanoidGame mounts useAuthSync (next-auth's useSession under the
// hood), which needs a provider we don't mount. Stub it to guest, mirroring
// Game.test.tsx.
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

import { ArkanoidGameShell } from "../ArkanoidGameShell";
import { useArkanoidStore } from "../lib/store";

describe("ArkanoidGameShell (shell <-> store pause wiring)", () => {
  beforeEach(() => {
    // getContext("2d") returns null in jsdom, so the arkanoid loop bails before
    // ever scheduling a frame — but stub rAF anyway so a stray schedule can't
    // tick the sim outside act (matches Game.test.tsx).
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // Start every test on the menu, where canPause is false.
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
  });

  it("renders the shared shell around the game (title + home button + game content)", () => {
    render(<ArkanoidGameShell />);

    // The home button is unique to GameShell — proof the shell rendered.
    expect(
      screen.getByRole("button", { name: "Back to games" })
    ).toBeInTheDocument();

    // The shell header prints the game name. The menu overlay also prints the
    // title once as an <h1>, so "Arkanoid" shows in both the header div and the
    // overlay heading.
    expect(screen.getAllByText("Arkanoid").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("heading", { name: "Arkanoid" })
    ).toBeInTheDocument();

    // The game itself is mounted inside the shell (its start-overlay subtitle).
    expect(screen.getByText("Chain Reaction Mayhem")).toBeInTheDocument();
  });

  it("hides the shell pause button on the menu (canPause is false there)", () => {
    render(<ArkanoidGameShell />);

    // gameState "menu" -> canPause false -> GameShell renders no pause button
    // and no pause menu can open over the start screen.
    expect(
      screen.queryByRole("button", { name: /pause game/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });

  it("shows the pause button while playing and wires pause/resume to the store", () => {
    render(<ArkanoidGameShell />);

    // Enter a live round via the real action; canPause flips true so the shell
    // reveals its pause button.
    act(() => {
      useArkanoidStore.getState().startGame();
    });
    expect(useArkanoidStore.getState().gameState).toBe("playing");

    const pauseBtn = screen.getByRole("button", { name: "Pause game" });

    // Click pause: the shell's PauseMenu opens AND onPause flips the store to
    // "paused".
    fireEvent.click(pauseBtn);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(useArkanoidStore.getState().gameState).toBe("paused");

    // Click Resume inside the PauseMenu: onResume returns the store to "playing"
    // and the menu closes. (getByText("Resume") targets the menu button; the
    // header toggle's visible text is the ⏸️ glyph, not "Resume".)
    fireEvent.click(screen.getByText("Resume"));
    expect(useArkanoidStore.getState().gameState).toBe("playing");
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });
});
