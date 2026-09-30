/**
 * Quoridor on a phone (PR-G6): squares that take the room and grooves that
 * are thin lines, a board that fits the play box both ways up, a tap that
 * goes to the nearest green dot, a wall a finger drags into place and then
 * places with a button (never by the touch itself), the computer switched
 * on from the start card and never stuck, and the result as a card with
 * the shared chip.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerDown, fingerMove, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { AI_DELAY_MS, QuoridorGame, resultText, wallProblem } from "../Game";
import { BOARD_SIZE, type Wall } from "../lib/constants";
import {
  CONTROL_ROW,
  EDGE,
  GAP,
  HUD_ROW,
  SIDE_COLUMN,
  crossingOf,
  nearestCrossing,
  nearestMove,
  quoridorLayout,
  squareCentre,
  wallAt,
  wallRect,
} from "../lib/layout";
import { getValidWalls, isValidWallPlacement } from "../lib/quoridorLogic";
import { chooseAIMove, useQuoridorStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  narrowUpright: { width: 320, height: 568 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

describe("Quoridor layout", () => {
  it("fits the whole board, the turn strip and the controls in the play box on every iPhone screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const layout = quoridorLayout(box);
      expect(layout.board, name).toBe(BOARD_SIZE * layout.square + (BOARD_SIZE - 1) * layout.groove);
      if (layout.sideways) {
        expect(layout.board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(layout.board + GAP + SIDE_COLUMN + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        // The height sets the board: it takes nearly all of it.
        expect(layout.board / (box.height - 2 * EDGE), name).toBeGreaterThan(0.96);
      } else {
        expect(layout.board + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(HUD_ROW + GAP + layout.board + GAP + CONTROL_ROW + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(layout.board / (box.width - 2 * EDGE), name).toBeGreaterThan(0.96);
      }
    }
  });

  it("gives the squares the room: a groove is a thin line, not a track as big as a square", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const { square, groove } = quoridorLayout(box);
      expect(groove / square, name).toBeLessThan(0.4);
      // 18.9 px squares upright and 14.6 px sideways before.
      expect(square, name).toBeGreaterThanOrEqual(box.width > box.height ? 21 : 26);
    }
    expect(quoridorLayout(BOXES.seUpright).square).toBeGreaterThanOrEqual(30);
  });

  it("maps every wall to its groove crossing and back, and draws it centred there", () => {
    const g = { square: 31, groove: 9 };
    const pitch = g.square + g.groove;
    for (const orientation of ["horizontal", "vertical"] as const) {
      for (let i = 0; i < BOARD_SIZE - 1; i++) {
        for (let j = 0; j < BOARD_SIZE - 1; j++) {
          const wall = wallAt({ i, j }, orientation);
          expect(crossingOf(wall)).toEqual({ i, j });
          const r = wallRect(wall, g);
          const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          expect(centre).toEqual({ x: i * pitch + g.square + g.groove / 2, y: j * pitch + g.square + g.groove / 2 });
          expect(nearestCrossing(centre.x, centre.y, g)).toEqual({ i, j });
        }
      }
    }
    // Every wall the rules allow at the start has a crossing on the board.
    const logic = useQuoridorStore.getState().getLogicState();
    for (const wall of getValidWalls(logic, 1)) {
      const c = crossingOf(wall);
      expect(c.i).toBeGreaterThanOrEqual(0);
      expect(c.i).toBeLessThan(BOARD_SIZE - 1);
      expect(c.j).toBeGreaterThanOrEqual(0);
      expect(c.j).toBeLessThan(BOARD_SIZE - 1);
    }
  });

  it("sends a tap to the nearest green dot within reach, and a tap on the pawn itself to none", () => {
    const g = { square: 31, groove: 9 };
    const moves = [
      { row: 1, col: 4 },
      { row: 0, col: 3 },
      { row: 0, col: 5 },
    ];
    const up = squareCentre({ row: 1, col: 4 }, g);
    // A finger that lands on the groove under the dot still means the dot.
    expect(nearestMove(up.x + 3, up.y + g.square / 2 + 4, moves, g)).toEqual({ row: 1, col: 4 });
    const pawn = squareCentre({ row: 0, col: 4 }, g);
    expect(nearestMove(pawn.x, pawn.y, moves, g)).toBeNull();
    // Far from every dot: nothing.
    expect(nearestMove(0, 0, moves, g)).toBeNull();
  });
});

describe("Quoridor rules the phone check found", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useQuoridorStore.getState().newGame("ai", "easy"));
  });

  it("a 2-player game counts as a game played, never as a win for the leaderboard", () => {
    act(() => {
      useQuoridorStore.getState().newGame("local");
      useQuoridorStore.setState({ positions: { 1: { row: 7, col: 0 }, 2: { row: 8, col: 8 } } });
    });
    const before = useQuoridorStore.getState().progress;
    act(() => useQuoridorStore.getState().movePawn({ row: 8, col: 0 }));
    const after = useQuoridorStore.getState().progress;
    expect(useQuoridorStore.getState().status).toBe("player1-wins");
    expect(after.gamesPlayed).toBe(before.gamesPlayed + 1);
    expect(after.gamesWon).toBe(before.gamesWon);
    expect(after.currentWinStreak).toBe(before.currentWinStreak);
  });

  it("a choice on the start card is a new game, so the computer is never switched on mid-turn", () => {
    act(() => {
      useQuoridorStore.getState().newGame("local");
      useQuoridorStore.getState().movePawn({ row: 1, col: 4 });
    });
    expect(useQuoridorStore.getState().currentPlayer).toBe(2);
    act(() => useQuoridorStore.getState().setGameMode("ai"));
    const s = useQuoridorStore.getState();
    expect(s.gameMode).toBe("ai");
    expect(s.currentPlayer).toBe(1);
    expect(s.positions[1]).toEqual({ row: 0, col: 4 });
  });

  it("turns a wall about its own centre", () => {
    const wall = wallAt({ i: 3, j: 4 }, "horizontal");
    act(() => useQuoridorStore.setState({ wallMode: true, wallPreview: wall, wallOrientation: "horizontal" }));
    act(() => useQuoridorStore.getState().toggleWallOrientation());
    const turned = useQuoridorStore.getState().wallPreview!;
    expect(turned.orientation).toBe("vertical");
    expect(crossingOf(turned)).toEqual({ i: 3, j: 4 });
    act(() => useQuoridorStore.getState().toggleWallOrientation());
    expect(useQuoridorStore.getState().wallPreview).toEqual(wall);
  });

  it("the computer on Easy walks its shortest path and never places a wall", () => {
    const logic = useQuoridorStore.getState().getLogicState();
    for (let k = 0; k < 20; k++) {
      const choice = chooseAIMove(logic, "easy", () => 0);
      expect(choice).toEqual({ kind: "move", to: { row: 7, col: 4 } });
    }
  });

  it("says why a wall cannot go somewhere", () => {
    const walls: Wall[] = [{ row: 4, col: 3, orientation: "horizontal" }];
    expect(wallProblem(walls, { row: 4, col: 4, orientation: "horizontal" })).toBe("Walls can't cross");
    expect(wallProblem([], { row: 1, col: 3, orientation: "horizontal" })).toBe("Leave a way through!");
  });
});

describe("Quoridor on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => useQuoridorStore.getState().newGame("ai", "easy"));
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The geometry the game uses: with no GameShell, usePlayBox reports the window. */
  const geometry = () => {
    const { square, groove } = quoridorLayout({ width: window.innerWidth, height: window.innerHeight });
    return { square, groove };
  };

  function startPlaying() {
    render(<QuoridorGame />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: "▶ Play!" }));
    return screen.getByTestId("quoridor-board");
  }

  it("starts against the computer, easy, with the pickers on the start card", () => {
    render(<QuoridorGame />);
    const card = screen.getByTestId("game-start-overlay");
    expect(within(card).getByRole("button", { name: /computer/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "Easy" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(card).getByRole("button", { name: /2 players/i }));
    expect(useQuoridorStore.getState().gameMode).toBe("local");
    expect(within(card).queryByTestId("difficulty-picker")).toBeNull();
  });

  it("a finger that lands beside a green dot still moves the pawn there", () => {
    const board = startPlaying();
    const g = geometry();
    const target = squareCentre({ row: 1, col: 4 }, g);
    // On the groove between the dot and the pawn, a little off to the side.
    fingerTap(board, { x: target.x + 4, y: target.y + g.square / 2 + g.groove / 2 });
    expect(useQuoridorStore.getState().positions[1]).toEqual({ row: 1, col: 4 });
  });

  it("every green dot is a button of 44 px or more with a name", () => {
    startPlaying();
    const dots = screen.getAllByRole("button", { name: /^(Move|Jump) / });
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(parseFloat(dot.style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(dot.style.height)).toBeGreaterThanOrEqual(44);
    }
  });

  it("Wall shows a wall in front of the computer; a finger drags it; lifting never places it; Place does", () => {
    const board = startPlaying();
    fireEvent.click(screen.getByRole("button", { name: /wall/i }));
    const first = useQuoridorStore.getState().wallPreview!;
    // Across the computer's way down from row 8.
    expect(first.orientation).toBe("horizontal");
    expect(first.row).toBe(8);
    expect(screen.getByTestId("quoridor-wall-preview")).toBeInTheDocument();
    // No green dots in wall mode, so a finger on the board is the wall's.
    expect(screen.queryAllByRole("button", { name: /^(Move|Jump) / })).toHaveLength(0);

    const g = geometry();
    const pitch = g.square + g.groove;
    const crossing = (i: number, j: number) => ({ x: i * pitch + g.square + g.groove / 2, y: j * pitch + g.square + g.groove / 2 });
    const a = crossing(1, 5);
    const b = crossing(5, 3);
    fingerDown(board, { x: a.x + 5, y: a.y - 6 });
    expect(crossingOf(useQuoridorStore.getState().wallPreview!)).toEqual({ i: 1, j: 5 });
    fingerMove(board, { x: b.x - 7, y: b.y + 5 });
    expect(crossingOf(useQuoridorStore.getState().wallPreview!)).toEqual({ i: 5, j: 3 });
    fingerUp(board, { x: b.x - 7, y: b.y + 5 });
    expect(useQuoridorStore.getState().walls).toHaveLength(0);

    fireEvent.click(screen.getByTestId("quoridor-place"));
    const s = useQuoridorStore.getState();
    expect(s.walls).toEqual([wallAt({ i: 5, j: 3 }, "horizontal")]);
    expect(s.wallsRemaining[1]).toBe(9);
    expect(s.wallMode).toBe(false);
    expect(screen.getByTestId("quoridor-walls-1")).toHaveAttribute("aria-label", "You: 9 walls left");
  });

  it("a finger on a square in wall mode never places a wall", () => {
    const board = startPlaying();
    fireEvent.click(screen.getByRole("button", { name: /wall/i }));
    const c = squareCentre({ row: 4, col: 2 }, geometry());
    fingerTap(board, c);
    expect(useQuoridorStore.getState().walls).toHaveLength(0);
    expect(useQuoridorStore.getState().wallsRemaining[1]).toBe(10);
  });

  it("a wall that shuts a pawn in shows why, and Place stays off", () => {
    startPlaying();
    // A wall beside the corner pawn already; one across the top shuts it in.
    act(() =>
      useQuoridorStore.setState({
        positions: { 1: { row: 0, col: 0 }, 2: { row: 8, col: 4 } },
        walls: [{ row: 0, col: 1, orientation: "vertical" }],
      })
    );
    const blocking: Wall = { row: 2, col: 0, orientation: "horizontal" };
    expect(isValidWallPlacement(useQuoridorStore.getState().getLogicState(), blocking, 1)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /wall/i }));
    act(() => useQuoridorStore.getState().setWallPreview(blocking));
    expect(screen.getByTestId("quoridor-place")).toBeDisabled();
    expect(screen.getByTestId("quoridor-status")).toHaveTextContent("🚫 Leave a way through!");
    fireEvent.click(screen.getByTestId("quoridor-place"));
    expect(useQuoridorStore.getState().walls).toHaveLength(1);
  });

  it("a mouse click in wall mode places the wall at once, and that click never moves the next pawn", () => {
    mockPointer(false);
    act(() => useQuoridorStore.getState().newGame("local"));
    const board = startPlaying();
    fireEvent.click(screen.getByRole("button", { name: /wall/i }));
    const g = geometry();
    const pitch = g.square + g.groove;
    // The crossing right under Orange's pawn's first step down.
    const point = { clientX: 3 * pitch + g.square + g.groove / 2, clientY: 0 * pitch + g.square + g.groove / 2 };
    fireEvent.pointerDown(board, { pointerType: "mouse", pointerId: 1, buttons: 1, ...point });
    fireEvent.pointerUp(board, { pointerType: "mouse", pointerId: 1, ...point });
    fireEvent.click(board, { detail: 1, ...point });
    const s = useQuoridorStore.getState();
    expect(s.walls).toHaveLength(1);
    expect(s.currentPlayer).toBe(2);
    expect(s.positions[2]).toEqual({ row: 8, col: 4 });
  });

  it("the computer moves a moment after the player, and never under the pause menu", () => {
    vi.useFakeTimers();
    startPlaying();
    act(() => useQuoridorStore.getState().movePawn({ row: 1, col: 4 }));
    expect(screen.getByTestId("quoridor-status")).toHaveTextContent("Thinking");
    act(() => useQuoridorStore.getState().pauseGame());
    act(() => vi.advanceTimersByTime(AI_DELAY_MS * 3));
    expect(useQuoridorStore.getState().positions[2]).toEqual({ row: 8, col: 4 });
    act(() => useQuoridorStore.getState().resumeGame());
    act(() => vi.advanceTimersByTime(AI_DELAY_MS + 10));
    expect(useQuoridorStore.getState().positions[2]).toEqual({ row: 7, col: 4 });
    expect(useQuoridorStore.getState().currentPlayer).toBe(1);
  });

  it("a restart while the computer waits cancels its move (it never moves in the new game)", () => {
    vi.useFakeTimers();
    startPlaying();
    act(() => useQuoridorStore.getState().movePawn({ row: 1, col: 4 }));
    act(() => vi.advanceTimersByTime(AI_DELAY_MS / 2));
    act(() => useQuoridorStore.getState().newGame());
    act(() => vi.advanceTimersByTime(AI_DELAY_MS * 3));
    const s = useQuoridorStore.getState();
    expect(s.positions).toEqual({ 1: { row: 0, col: 4 }, 2: { row: 8, col: 4 } });
    expect(s.currentPlayer).toBe(1);
  });

  it("a win shows a card and the chip; Play again is a new game at once, with no start card", () => {
    startPlaying();
    act(() => {
      useQuoridorStore.setState({ positions: { 1: { row: 7, col: 0 }, 2: { row: 8, col: 8 } } });
      useQuoridorStore.getState().movePawn({ row: 8, col: 0 });
    });
    expect(screen.getByTestId("quoridor-result-card")).toHaveTextContent("You won!");
    expect(screen.queryByTestId("quoridor-controls")).toBeNull();
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useQuoridorStore.getState().status).toBe("playing");
    expect(useQuoridorStore.getState().positions[1]).toEqual({ row: 0, col: 4 });
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });

  it("says the result in whole sentences", () => {
    expect(resultText({ winner: 1, mode: "ai", moves: 9, streak: 3 })).toBe("You won! You got there in 9 moves. That is 3 wins in a row.");
    expect(resultText({ winner: 2, mode: "ai", moves: 9, streak: 0 })).toBe("The computer won. Good try!");
    expect(resultText({ winner: 2, mode: "local", moves: 4, streak: 0 })).toBe("Orange wins! Orange got to the other side first.");
  });
});
