/**
 * Bomberman on a phone (phone UX audit 2026-09-29, arcade-grid):
 * - the arena fits the play box on both axes with room for the controls,
 *   under it upright and in the gutters sideways, so every key and the
 *   bomb button are on screen with the whole arena;
 * - the HUD is one row over the arena;
 * - game over and a cleared level mount the shared result chip (a direct
 *   Play again, a Next level), and the store tells a real new best.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

import BombermanGame, { gameOverText, levelDoneText } from "../Game";
import { BOMB_BUTTON_UPRIGHT, layoutBomberman, MIN_PAD_KEY, padSize, PAD_KEY_SIDEWAYS, PAD_KEY_UPRIGHT } from "../lib/layout";
import { useBombermanStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

function playBox(width: number, height: number) {
  const header = height <= 480 ? 40 : 48;
  return { width, height: height - header };
}

function sizeWindow(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

const canvasHeight = () => parseFloat((document.querySelector("canvas") as HTMLCanvasElement).style.height);

let clock = 1_000_000;

beforeEach(() => {
  localStorage.clear();
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPointerMock();
  sizeWindow(1024, 768);
  act(() => {
    useBombermanStore.getState().resetGame();
  });
});

describe("the arena and the controls share the play box", () => {
  it("upright on a 375x549 phone: the arena, the HUD row and the controls fit the box", () => {
    const box = playBox(375, 549);
    const layout = layoutBomberman(box, true);
    expect(layout.sideways).toBe(false);
    expect(layout.padKey).toBe(PAD_KEY_UPRIGHT);
    expect(layout.fit.height + 32 + Math.max(padSize(PAD_KEY_UPRIGHT), BOMB_BUTTON_UPRIGHT)).toBeLessThanOrEqual(box.height);
    expect(layout.fit.width).toBeGreaterThan(250);
  });

  it("sideways on a 667x311 phone: the arena fits the height with the d-pad and the bomb in the gutters", () => {
    const box = playBox(667, 311);
    const layout = layoutBomberman(box, true);
    expect(layout.sideways).toBe(true);
    expect(layout.padKey).toBe(PAD_KEY_SIDEWAYS);
    expect(layout.fit.height + 32).toBeLessThanOrEqual(box.height);
    expect(layout.fit.width + padSize(PAD_KEY_SIDEWAYS) + layout.bombButton).toBeLessThanOrEqual(box.width);
    expect(layout.fit.width).toBeGreaterThan(200);
  });

  it("fits the d-pad and the bomb in one row on a narrow phone, keys never under 44 px (the bomb was off the right edge)", () => {
    for (const width of [311, 320, 375, 390]) {
      const layout = layoutBomberman({ width, height: 600 }, true);
      // The control row: the root's 8 px padding on each side, the row's own
      // 8 px padding on each side, the d-pad, 8 px between, and the bomb button.
      expect(8 + 8 + padSize(layout.padKey) + 8 + layout.bombButton + 8 + 8, `${width} px`).toBeLessThanOrEqual(width);
      expect(layout.padKey, `${width} px`).toBeGreaterThanOrEqual(MIN_PAD_KEY);
    }
    expect(layoutBomberman({ width: 390, height: 600 }, true).padKey).toBe(64);
  });

  it("renders the fitted arena over a control row on a 375x549 touch screen (the Down key was cut off)", () => {
    mockPointer(true);
    sizeWindow(375, 501);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);
    expect(screen.getByTestId("bomberman-game").className).toContain("flex-col");
    const row = screen.getByTestId("bomberman-control-row");
    expect(row).toContainElement(screen.getByTestId("bomberman-dpad"));
    expect(row).toContainElement(screen.getByTestId("bomberman-bomb"));
    expect(canvasHeight()).toBeLessThanOrEqual(501 - 32 - padSize(PAD_KEY_UPRIGHT));
    for (const name of ["Move up", "Move left", "Move down", "Move right"]) {
      expect(parseFloat(screen.getByRole("button", { name }).style.height)).toBe(PAD_KEY_UPRIGHT);
    }
  });

  it("puts the d-pad in the left gutter and the bomb in the right one on a phone held sideways (every control was off screen)", () => {
    mockPointer(true);
    sizeWindow(667, 271);
    act(() => {
      useBombermanStore.getState().startGame();
    });
    render(<BombermanGame />);
    expect(screen.getByTestId("bomberman-game").className).toContain("flex-row");
    expect(screen.getByTestId("bomberman-left-gutter")).toContainElement(screen.getByTestId("bomberman-dpad"));
    expect(screen.getByTestId("bomberman-right-gutter")).toContainElement(screen.getByTestId("bomberman-bomb"));
    expect(canvasHeight()).toBeLessThanOrEqual(271 - 32);
    expect(parseFloat(screen.getByRole("button", { name: "Move up" }).style.height)).toBe(PAD_KEY_SIDEWAYS);
  });

  it("shows one HUD row with the level, the score, the lives, the bombs and the range", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ level: 3, score: 450, lives: 2 });
    });
    render(<BombermanGame />);
    const hud = screen.getByTestId("bomberman-hud");
    expect(hud).toHaveTextContent("Lv 3");
    expect(hud).toHaveTextContent("450 pts");
    expect(within(hud).getByLabelText("2 lives")).toBeInTheDocument();
    expect(hud).toHaveTextContent("💣 1");
    expect(hud).toHaveTextContent("🔥 2");
    expect(screen.queryByText(/Level: /)).not.toBeInTheDocument();
  });
});

describe("the result chip", () => {
  it("Play again at game over starts a new run at once", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ gameState: "lost", score: 300, level: 2 });
    });
    render(<BombermanGame />);
    const chip = screen.getByTestId("result-chip");
    clock += DEFAULT_RESTART_GRACE_MS;
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    expect(useBombermanStore.getState().gameState).toBe("playing");
    expect(useBombermanStore.getState().level).toBe(1);
    expect(screen.queryByTestId("result-chip")).not.toBeInTheDocument();
  });

  it("Next level after a cleared level goes on with the same run", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ gameState: "won", score: 300, level: 1 });
    });
    render(<BombermanGame />);
    const chip = screen.getByTestId("result-chip");
    clock += DEFAULT_RESTART_GRACE_MS;
    fireEvent.click(within(chip).getByRole("button", { name: /next level/i }));
    const state = useBombermanStore.getState();
    expect(state.gameState).toBe("playing");
    expect(state.level).toBe(2);
    expect(state.score).toBe(300);
  });

  it("says the score, the level and whether it is a new best", () => {
    expect(gameOverText({ score: 300, level: 2, best: 300, newBest: true })).toBe(
      "Game over! You got 300 points and reached level 2. That is a new best!"
    );
    expect(gameOverText({ score: 100, level: 1, best: 300, newBest: false })).toBe(
      "Game over! You got 100 points and reached level 1. Your best is 300."
    );
    expect(levelDoneText({ score: 300, level: 2, newBest: false })).toBe("Level 2 done! You have 300 points.");
  });

  it("Space at game over restarts only after the result grace", () => {
    act(() => {
      useBombermanStore.getState().startGame();
      useBombermanStore.setState({ gameState: "lost" });
    });
    render(<BombermanGame />);
    fireEvent.keyDown(window, { key: " " });
    expect(useBombermanStore.getState().gameState).toBe("lost");
    clock += DEFAULT_RESTART_GRACE_MS;
    fireEvent.keyDown(window, { key: " " });
    expect(useBombermanStore.getState().gameState).toBe("playing");
  });
});

describe("the store", () => {
  it("banks the high score when the player walks onto the exit (the exit path never saved it)", () => {
    act(() => {
      useBombermanStore.setState((s) => ({ progress: { ...s.progress, highScore: 100 } }));
      useBombermanStore.getState().startGame();
    });
    const state = useBombermanStore.getState();
    const grid = state.grid.map((row) => row.map((t) => ({ ...t })));
    grid[1][2] = { type: "exit", revealed: true };
    act(() => {
      useBombermanStore.setState({ grid, score: 500, exitRevealed: true, enemies: [], bombs: [] });
      useBombermanStore.getState().movePlayer("RIGHT");
    });
    const after = useBombermanStore.getState();
    expect(after.gameState).toBe("won");
    expect(after.progress.highScore).toBe(500);
    expect(after.isNewHighScore).toBe(true);
  });

  it("a tie with the old best is not a new best, and the best from before the run is the one to beat", () => {
    act(() => {
      useBombermanStore.setState((s) => ({ progress: { ...s.progress, highScore: 500 } }));
      useBombermanStore.getState().startGame();
    });
    expect(useBombermanStore.getState().bestBeforeRun).toBe(500);
    const state = useBombermanStore.getState();
    const grid = state.grid.map((row) => row.map((t) => ({ ...t })));
    grid[1][2] = { type: "exit", revealed: true };
    act(() => {
      useBombermanStore.setState({ grid, score: 500, exitRevealed: true, enemies: [], bombs: [] });
      useBombermanStore.getState().movePlayer("RIGHT");
    });
    expect(useBombermanStore.getState().gameState).toBe("won");
    expect(useBombermanStore.getState().isNewHighScore).toBe(false);
  });

  it("does not stamp the saved progress on a frame where nothing counted changed", () => {
    act(() => {
      useBombermanStore.getState().startGame();
    });
    const before = useBombermanStore.getState().progress;
    act(() => {
      for (let i = 0; i < 30; i++) useBombermanStore.getState().update(16);
    });
    expect(useBombermanStore.getState().progress).toBe(before);
  });

  it("moves the enemies in copies, never in the objects the old state holds", () => {
    act(() => {
      useBombermanStore.getState().startGame();
    });
    const state = useBombermanStore.getState();
    const enemy = { id: "e", type: "balloon" as const, x: 5, y: 5, lastMove: 0, alive: true };
    act(() => {
      useBombermanStore.setState({ enemies: [enemy] });
      useBombermanStore.getState().update(600);
    });
    // The enemy moved (its interval is 500 ms) in the new state only.
    const moved = useBombermanStore.getState().enemies[0];
    expect(moved).not.toBe(enemy);
    expect(enemy.x).toBe(5);
    expect(enemy.y).toBe(5);
    expect(moved.lastMove).not.toBe(0);
    void state;
  });
});
