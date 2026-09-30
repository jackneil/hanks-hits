/**
 * Snake on a phone (phone UX audit 2026-09-29, arcade-grid):
 * - the board fits the play box on both axes and leaves room for the d-pad
 *   under it (upright) or beside it (sideways), so the board and an arrow
 *   are always on screen together;
 * - the game runs on the shared fixed-step loop: one step per snake move,
 *   no catch-up burst after a hidden tab;
 * - game over mounts the shared result chip with a direct Play again, and
 *   the old PLAY AGAIN and in-play PAUSE buttons are gone (the shell owns
 *   pause);
 * - the start card offers Arrows or Swipe on a touch screen.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

import SnakeGame, { gameOverText } from "../Game";
import { layoutSnake, padSize, PAD_KEY_SIDEWAYS, PAD_KEY_UPRIGHT } from "../lib/layout";
import { useSnakeStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

/** The play box of an iPhone screen: the inner size less the 48 px header (40 px sideways). */
function playBox(width: number, height: number) {
  const header = height <= 480 ? 40 : 48;
  return { width, height: height - header };
}

function sizeWindow(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

const boardPx = () => parseFloat(screen.getByTestId("snake-board").style.width);

let raf: RafMock;
let clock = 1_000_000;
/** The store's real tick: a test that swaps in a spy puts it back. */
const realTick = useSnakeStore.getState().tick;

beforeEach(() => {
  localStorage.clear();
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  raf = installRafMock();
  act(() => {
    useSnakeStore.getState().reset();
    useSnakeStore.setState((s) => ({
      status: "idle",
      tick: realTick,
      progress: { ...s.progress, controlMode: "buttons", wraparoundWalls: true, highScore: 0 },
    }));
  });
});

afterEach(() => {
  uninstallRafMock();
  resetPointerMock();
  vi.restoreAllMocks();
  sizeWindow(1024, 768);
  act(() => {
    useSnakeStore.setState({ status: "idle", tick: realTick });
  });
});

describe("the board and the controls share the play box", () => {
  it("upright on a 375x549 phone: the board fits above the d-pad, both inside the box", () => {
    const box = playBox(375, 549);
    const layout = layoutSnake(box, "pad");
    expect(layout.sideways).toBe(false);
    expect(layout.padKey).toBe(PAD_KEY_UPRIGHT);
    // The board, the score row (44) and the d-pad (two rows of keys) all fit.
    expect(layout.fit.height + 44 + padSize(PAD_KEY_UPRIGHT).height).toBeLessThanOrEqual(box.height);
    expect(layout.fit.width).toBeGreaterThan(200);
  });

  it("sideways on a 667x311 phone: the board fits the height, with the d-pad in a gutter", () => {
    const box = playBox(667, 311);
    const layout = layoutSnake(box, "pad");
    expect(layout.sideways).toBe(true);
    expect(layout.padKey).toBe(PAD_KEY_SIDEWAYS);
    expect(layout.fit.height).toBeLessThanOrEqual(box.height);
    expect(layout.fit.width + 112 + padSize(PAD_KEY_SIDEWAYS).width).toBeLessThanOrEqual(box.width);
    expect(layout.fit.width).toBeGreaterThan(200);
  });

  it("renders the fitted board and the d-pad on a 375x549 touch screen (it drew a 359 px board with the arrows under the fold)", () => {
    mockPointer(true);
    sizeWindow(375, 501);
    act(() => {
      useSnakeStore.getState().startGame();
    });
    render(<SnakeGame />);
    expect(screen.getByTestId("snake-game").className).toContain("flex-col");
    expect(screen.getByTestId("snake-dpad")).toBeInTheDocument();
    // The board leaves the d-pad its two rows of 64 px keys and the score row.
    expect(boardPx()).toBeLessThanOrEqual(501 - 44 - padSize(PAD_KEY_UPRIGHT).height);
    expect(boardPx()).toBeGreaterThan(200);
    for (const name of ["Move up", "Move left", "Move down", "Move right"]) {
      const key = screen.getByRole("button", { name });
      expect(parseFloat(key.style.width)).toBe(PAD_KEY_UPRIGHT);
      expect(parseFloat(key.style.height)).toBe(PAD_KEY_UPRIGHT);
    }
  });

  it("lays the score column, the board and the d-pad in a row on a phone held sideways", () => {
    mockPointer(true);
    sizeWindow(667, 271);
    act(() => {
      useSnakeStore.getState().startGame();
    });
    render(<SnakeGame />);
    expect(screen.getByTestId("snake-game").className).toContain("flex-row");
    expect(boardPx()).toBeLessThanOrEqual(271);
    expect(screen.getByTestId("snake-hud").className).toContain("flex-col");
    expect(screen.getByTestId("snake-dpad")).toBeInTheDocument();
  });

  it("swipe mode gives the board the room and shows the swipe hint instead of the d-pad", () => {
    mockPointer(true);
    sizeWindow(375, 501);
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState((s) => ({ progress: { ...s.progress, controlMode: "swipe" } }));
    });
    render(<SnakeGame />);
    expect(screen.queryByTestId("snake-dpad")).not.toBeInTheDocument();
    expect(screen.getByTestId("snake-swipe-hint")).toBeInTheDocument();
    expect(boardPx()).toBeGreaterThan(501 - 44 - padSize(PAD_KEY_UPRIGHT).height);
  });

  it("has no in-play PAUSE button, no Settings panel and no stats panel on the play screen (the shell and the pause menu own them)", () => {
    mockPointer(true);
    act(() => {
      useSnakeStore.getState().startGame();
    });
    render(<SnakeGame />);
    expect(screen.queryByRole("button", { name: /^PAUSE$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Your Stats")).not.toBeInTheDocument();
  });
});

describe("the shared game loop moves the snake", () => {
  it("one step per tick interval on a 60 Hz and a 120 Hz screen alike", () => {
    const tick = vi.fn();
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState({ tick });
    });
    render(<SnakeGame />);
    // The first frame only seeds the clock (no time passes).
    raf.nextFrame(60);
    // Slow is 200 ms per move: five moves in a second, at either refresh rate.
    raf.runFor(1000, 60, act);
    expect(tick).toHaveBeenCalledTimes(5);
    raf.runFor(1000, 120, act);
    expect(tick).toHaveBeenCalledTimes(10);
  });

  it("no catch-up burst after a stall or a hidden tab", () => {
    const tick = vi.fn();
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState({ tick });
    });
    render(<SnakeGame />);
    raf.runFor(400, 60, act);
    const before = tick.mock.calls.length;
    // The kid switched apps for five seconds: the snake must not run 25 moves at once.
    raf.stall(5000);
    raf.runFor(100, 60, act);
    expect(tick.mock.calls.length - before).toBeLessThanOrEqual(1);
  });

  it("stops while paused and starts again on resume", () => {
    const tick = vi.fn();
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState({ tick });
    });
    render(<SnakeGame />);
    act(() => {
      useSnakeStore.getState().pauseGame();
    });
    raf.runFor(1000, 60, act);
    expect(tick).not.toHaveBeenCalled();
    act(() => {
      useSnakeStore.getState().resumeGame();
    });
    // The resume frame seeds the clock again: no paused time is caught up.
    raf.nextFrame(60);
    raf.runFor(1000, 60, act);
    expect(tick).toHaveBeenCalledTimes(5);
  });
});

describe("game over", () => {
  it("mounts the shared result chip with a direct Play again, and the old PLAY AGAIN button is gone", () => {
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState({ score: 40, snake: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] });
      useSnakeStore.setState({ status: "game-over", lastRunNewBest: true });
    });
    render(<SnakeGame />);
    expect(screen.queryByRole("button", { name: /PLAY AGAIN!/ })).not.toBeInTheDocument();
    const chip = screen.getByTestId("result-chip");
    const playAgain = within(chip).getByRole("button", { name: /play again/i });
    expect(within(chip).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    clock += DEFAULT_RESTART_GRACE_MS;
    fireEvent.click(playAgain);
    expect(useSnakeStore.getState().status).toBe("playing");
    expect(screen.queryByTestId("result-chip")).not.toBeInTheDocument();
  });

  it("says the score, the length and whether it is a new best", () => {
    expect(gameOverText({ score: 40, length: 7, best: 40, newBest: true })).toBe(
      "Game over! You got 40 points. Your snake was 7 long. That is a new best!"
    );
    expect(gameOverText({ score: 10, length: 4, best: 40, newBest: false })).toBe(
      "Game over! You got 10 points. Your snake was 4 long. Your best is 40."
    );
  });

  it("knows a new best from the best before the run, not from the raised high score", () => {
    act(() => {
      useSnakeStore.setState((s) => ({ progress: { ...s.progress, highScore: 30 } }));
      useSnakeStore.getState().startGame();
    });
    expect(useSnakeStore.getState().bestBeforeRun).toBe(30);
    // The store raises highScore during the run; a tie at game over is not a record.
    act(() => {
      useSnakeStore.setState((s) => ({ score: 30, progress: { ...s.progress, highScore: 30 } }));
      useSnakeStore.setState({ snake: [{ x: 0, y: 0 }], nextDirection: "left", direction: "left" });
      useSnakeStore.setState((s) => ({ progress: { ...s.progress, wraparoundWalls: false } }));
      useSnakeStore.getState().tick();
    });
    expect(useSnakeStore.getState().status).toBe("game-over");
    expect(useSnakeStore.getState().lastRunNewBest).toBe(false);
  });

  it("Space restarts from game over only after the result grace", () => {
    act(() => {
      useSnakeStore.getState().startGame();
      useSnakeStore.setState({ status: "game-over" });
    });
    render(<SnakeGame />);
    fireEvent.keyDown(window, { key: " " });
    expect(useSnakeStore.getState().status).toBe("game-over");
    clock += DEFAULT_RESTART_GRACE_MS;
    fireEvent.keyDown(window, { key: " " });
    expect(useSnakeStore.getState().status).toBe("playing");
  });
});

describe("the start card", () => {
  it("offers Arrows or Swipe on a touch screen, and not on a keyboard", () => {
    mockPointer(true);
    const { unmount } = render(<SnakeGame />);
    const picker = screen.getByTestId("snake-controls-picker");
    expect(within(picker).getByRole("button", { name: /Arrows/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(picker).getByRole("button", { name: /Swipe/ }));
    expect(useSnakeStore.getState().progress.controlMode).toBe("swipe");
    expect(within(picker).getByRole("button", { name: /Swipe/ })).toHaveAttribute("aria-pressed", "true");
    unmount();

    mockPointer(false);
    render(<SnakeGame />);
    expect(screen.queryByTestId("snake-controls-picker")).not.toBeInTheDocument();
  });
});
