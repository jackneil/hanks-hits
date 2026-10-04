/**
 * Checkers on a phone (PR-G6): a board sized from the play box both ways
 * up (held sideways it was 512 px in a 263 px box), the choices on the
 * start card, the dark squares as real buttons, a computer that waits for
 * Play and for the pause menu, rules and mode that survive a reload, and
 * the result as a card with the shared chip.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { CheckersGame, checkersOutcome, resultText } from "../Game";
import { AI_CONFIG, RULE_SETS, createInitialBoard, type PieceType } from "../lib/constants";
import { EDGE, GAP, SIDE_COLUMN, TOP_ROW, checkersLayout } from "../lib/layout";
import { useCheckersStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const BOXES = {
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

describe("Checkers layout", () => {
  it("fits the whole board and the turn strip in the play box on every iPhone screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const { sideways, board } = checkersLayout(box);
      expect(board % 8, name).toBe(0);
      if (sideways) {
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(board + GAP + SIDE_COLUMN + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(board / (box.height - 2 * EDGE), name).toBeGreaterThan(0.95);
        expect(board / 8, name).toBeGreaterThanOrEqual(24);
      } else {
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(TOP_ROW + GAP + board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        // 42.9 px squares on a 375 px phone before; a full 44 now.
        expect(board / 8, name).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

describe("Checkers results", () => {
  it("reads the outcome from the kid's side, and says it in whole sentences", () => {
    expect(checkersOutcome("red-wins", "vs-ai")).toBe("won");
    expect(checkersOutcome("black-wins", "vs-ai")).toBe("lost");
    expect(checkersOutcome("black-wins", "vs-friend")).toBe("black-won");
    expect(checkersOutcome("playing", "vs-ai")).toBeNull();
    expect(resultText("won", false, 2)).toBe("You won! That is 2 wins in a row.");
    expect(resultText("won", true, 0)).toBe("You won! Every piece is gone!");
  });
});

describe("Checkers saved choices", () => {
  it("a reload starts the board with the saved rules and mode", async () => {
    vi.resetModules();
    localStorage.clear();
    const original = JSON.stringify({ state: { progress: { variant: "casual", gameMode: "vs-friend" }, difficulty: "hard" }, version: 2 });
    localStorage.setItem(
      "checkers-progress",
      original,
    );
    // A fresh document captures legacy evidence before confirming its owner.
    const { ownerBoundProgress } = await import("@/lib/owner-bound-progress");
    const { useCheckersStore: reloaded } = await import("../lib/store");
    await act(async () => {
      await ownerBoundProgress.updateSession("unauthenticated");
      await ownerBoundProgress.whenHydrated("checkers-progress");
    });
    const s = reloaded.getState();
    expect(s.rules.variant).toBe("casual");
    expect(s.gameMode).toBe("vs-friend");
    expect(s.difficulty).toBe("hard");
    expect(localStorage.getItem("checkers-progress")).toBe(original);
    localStorage.clear();
  });
});

describe("Checkers on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => useCheckersStore.getState().newGame({ mode: "vs-ai", difficulty: "easy", variant: "american" }));
  });

  afterEach(() => {
    resetPointerMock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function startPlaying() {
    render(<CheckersGame />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: "▶ Play!" }));
  }
  const square = (row: number, col: number) =>
    screen.getByTestId("checkers-board").querySelector<HTMLButtonElement>(`[data-square="${row}-${col}"]`)!;

  it("has the choices on the start card, and the play screen is the board", () => {
    render(<CheckersGame />);
    const card = screen.getByTestId("game-start-overlay");
    expect(within(card).getByRole("button", { name: /computer/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: RULE_SETS.american.displayName })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(card).getByRole("button", { name: RULE_SETS.casual.displayName }));
    expect(useCheckersStore.getState().rules.variant).toBe("casual");
    expect(within(card).getByTestId("rules-words")).toHaveTextContent(RULE_SETS.casual.description);
    expect(screen.queryByRole("button", { name: /new game|stats|vs AI/i })).toBeNull();
  });

  it("a finger taps a piece, then a green square; only the dark squares are buttons", () => {
    startPlaying();
    const buttons = screen.getByTestId("checkers-board").querySelectorAll("button");
    expect(buttons).toHaveLength(32);
    fireEvent.click(square(5, 0));
    expect(square(4, 1)).toHaveAccessibleName("Move here");
    fireEvent.click(square(4, 1));
    expect(useCheckersStore.getState().board[4][1]).toBe("red");
    expect(screen.getByTestId("checkers-status")).toHaveTextContent("Thinking");
  });

  it("the computer waits for Play and under the pause menu, and a new game cancels its move", () => {
    vi.useFakeTimers();
    render(<CheckersGame />);
    act(() => {
      useCheckersStore.getState().selectPiece({ row: 5, col: 0 });
      useCheckersStore.getState().makeMove({ row: 4, col: 1 });
    });
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useCheckersStore.getState().currentPlayer).toBe("black");
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: "▶ Play!" }));
    act(() => useCheckersStore.getState().pauseGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useCheckersStore.getState().currentPlayer).toBe("black");
    act(() => useCheckersStore.getState().resumeGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS + 10));
    expect(useCheckersStore.getState().currentPlayer).toBe("red");

    act(() => {
      useCheckersStore.getState().selectPiece({ row: 5, col: 2 });
      useCheckersStore.getState().makeMove({ row: 4, col: 3 });
    });
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS / 2));
    act(() => useCheckersStore.getState().newGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useCheckersStore.getState().board).toEqual(createInitialBoard());
  });

  it("a win shows a card and the chip; Play again is a new game at once, with no start card", () => {
    startPlaying();
    // One black piece left, and red jumps it.
    const board: PieceType[][] = Array.from({ length: 8 }, () => Array<PieceType>(8).fill(null));
    board[3][2] = "black";
    board[4][1] = "red";
    act(() => useCheckersStore.setState({ board, currentPlayer: "red" }));
    fireEvent.click(square(4, 1));
    fireEvent.click(square(2, 3));
    expect(useCheckersStore.getState().status).toBe("red-wins");
    expect(screen.getByTestId("checkers-result-card")).toHaveTextContent("You won!");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useCheckersStore.getState().status).toBe("playing");
    expect(useCheckersStore.getState().board).toEqual(createInitialBoard());
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });
});
