import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { GameSheet } from "../GameSheet";
import { GameShell } from "../GameShell";

vi.mock("../../hooks/useFullscreen", () => ({
  useFullscreen: () => ({
    isSupported: true,
    isFullscreen: false,
    isIPhone: false,
    isIPad: false,
    isPWA: false,
    toggle: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * Main-loop decision 3 (phone UX audit 2026-09-29, S14): on a phone with
 * a touch screen, during play, Sign In and Leaderboard leave the header
 * and live in the pause menu. Between runs they stay in the header.
 */

const DEFAULT_WIDTH = window.innerWidth;
const DEFAULT_HEIGHT = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

function header() {
  return screen.getByTestId("game-shell-header");
}

function renderSnake(props: Partial<React.ComponentProps<typeof GameShell>> = {}) {
  return render(
    <GameShell gameName="Snake" appId="snake" onRestart={vi.fn()} {...props}>
      <div>game</div>
    </GameShell>
  );
}

afterEach(() => {
  act(() => setViewport(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  resetPointerMock();
  removeSpeechMock();
});

describe("GameShell on a phone during play", () => {
  it.each([
    [375, 549],
    [667, 311],
    [390, 664],
    [844, 340],
  ])("at %ix%i moves Sign In and Leaderboard into the pause menu, and reads them out", async (w, h) => {
    const synth = installSpeechMock();
    mockPointer(true);
    setViewport(w, h);
    renderSnake({ canPause: true });

    expect(within(header()).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /leaderboard/i })).toBeNull();
    // Home, Pause and Restart are still there.
    expect(within(header()).getByRole("button", { name: "Pause game" })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: "Back to games" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    const menu = screen.getByTestId("pause-menu");
    const signIn = within(menu).getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute("href", "/login");
    expect(signIn).toHaveClass("w-full");
    expect(within(menu).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();

    fireEvent.click(await within(menu).findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Paused. Snake. Resume. Leaderboard. Sign In. Restart. Go Home"
    );
  });

  it("keeps both in the header between runs (no run is live)", () => {
    mockPointer(true);
    setViewport(375, 549);
    renderSnake({ canPause: false, onPause: vi.fn() });
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("moves them when the run starts, and brings them back when it ends", () => {
    mockPointer(true);
    setViewport(375, 549);
    const onPause = vi.fn();
    const { rerender } = render(
      <GameShell gameName="Snake" appId="snake" canPause={false} onPause={onPause} onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();

    rerender(
      <GameShell gameName="Snake" appId="snake" canPause onPause={onPause} onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    expect(within(header()).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /leaderboard/i })).toBeNull();

    rerender(
      <GameShell gameName="Snake" appId="snake" canPause={false} onPause={onPause} onRestart={vi.fn()}>
        <div>game</div>
      </GameShell>
    );
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("keeps both in the header on a mouse or trackpad at a phone size", () => {
    mockPointer(false);
    setViewport(375, 549);
    renderSnake({ canPause: true });
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("keeps both in the header on a touch tablet (short side over 480 px)", () => {
    mockPointer(true);
    setViewport(1024, 768);
    renderSnake({ canPause: true });
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("keeps both in the header for a game whose pause menu is not one tap away", () => {
    mockPointer(true);
    setViewport(375, 549);
    renderSnake({ canPause: true, showPauseButton: false });
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("shows no Sign In anywhere when the page hides the login control", () => {
    mockPointer(true);
    setViewport(375, 549);
    renderSnake({ canPause: true, showLoginButton: false });
    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});

describe("GameShell on a phone during play, for a game with its own pause sheet", () => {
  // Hill Climb and other own-loop games pause with their own GameSheet (no
  // shell pause menu). Sign In and Leaderboard used to stay in the header
  // during play there; now that sheet holds them, like the shell menu does.
  function renderOwnSheet(inPlay: boolean, shellActions = true) {
    return render(
      <GameShell gameName="Hill Climb" appId="hill-climb" canPause={false} ownPauseSheet inPlay={inPlay} onRestart={vi.fn()}>
        <GameSheet
          title="Paused"
          spokenText="Paused. Keep driving."
          shellActions={shellActions}
          actions={<button type="button">Keep driving</button>}
        />
      </GameShell>
    );
  }

  it.each([
    [375, 549],
    [667, 311],
  ])("at %ix%i moves them off the header into the game's sheet, and reads them out", async (w, h) => {
    const synth = installSpeechMock();
    mockPointer(true);
    setViewport(w, h);
    renderOwnSheet(true);

    expect(within(header()).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(within(header()).queryByRole("button", { name: /leaderboard/i })).toBeNull();
    const moved = screen.getByTestId("game-sheet-shell-actions");
    expect(within(moved).getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    expect(within(moved).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe("Paused. Keep driving. Leaderboard. Sign In.");
  });

  it("keeps them in the header between runs, and a sheet without shellActions shows none", () => {
    mockPointer(true);
    setViewport(375, 549);
    const { unmount } = renderOwnSheet(false);
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId("game-sheet-shell-actions")).toBeNull();
    unmount();

    renderOwnSheet(true, false);
    expect(within(header()).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(screen.queryByTestId("game-sheet-shell-actions")).toBeNull();
  });

  it("keeps them in the header on a mouse at a phone size", () => {
    mockPointer(false);
    setViewport(375, 549);
    renderOwnSheet(true);
    expect(within(header()).getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId("game-sheet-shell-actions")).toBeNull();
  });
});
