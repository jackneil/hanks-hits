/**
 * Chess on a phone (PR-G6): a board sized from the play box both ways up
 * (44 px squares upright; held sideways it was 512 px in a 263 px box),
 * tap-to-move on touch with dragging for a mouse only (a scroll swipe
 * that began on a piece moved it), the pickers on the start card, a
 * computer that waits for Play and for the pause menu, Give up that asks
 * twice, and the result as a card with the shared chip.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { ChessGame, GIVE_UP_CONFIRM_MS, chessOutcome, resultText } from "../Game";
import { AI_CONFIG } from "../lib/constants";
import { BOTTOM_ROW, EDGE, GAP, SIDE_COLUMN, TOP_ROW, chessLayout } from "../lib/layout";
import { useChessStore } from "../lib/store";

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

describe("Chess layout", () => {
  it("fits the whole board and its rows in the play box on every iPhone screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const { sideways, board } = chessLayout(box);
      expect(board % 8, name).toBe(0);
      if (sideways) {
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(board + GAP + SIDE_COLUMN + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(board / (box.height - 2 * EDGE), name).toBeGreaterThan(0.95);
        // The WCAG 2.5.8 floor the phone gate holds a board cell to.
        expect(board / 8, name).toBeGreaterThanOrEqual(24);
      } else {
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(TOP_ROW + GAP + board + GAP + BOTTOM_ROW + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        // Upright a square stays a full 44 px finger target.
        expect(board / 8, name).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

describe("Chess results", () => {
  it("reads the outcome from the kid's side", () => {
    expect(chessOutcome("checkmate", "b", "ai", "white")).toBe("won");
    expect(chessOutcome("checkmate", "w", "ai", "white")).toBe("lost");
    expect(chessOutcome("checkmate", "w", "ai", "black")).toBe("won");
    expect(chessOutcome("checkmate", "w", "local", "white")).toBe("black-won");
    expect(chessOutcome("stalemate", "w", "ai", "white")).toBe("draw");
    expect(chessOutcome("resigned", "w", "ai", "white")).toBe("gave-up");
    expect(chessOutcome("playing", "w", "ai", "white")).toBeNull();
  });

  it("says the result in whole sentences", () => {
    expect(resultText("won", 3)).toBe("Checkmate! You won! That is 3 wins in a row.");
    expect(resultText("lost", 0)).toBe("Checkmate. The computer won. Good try!");
  });
});

describe("Chess on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // jsdom lays nothing out, and react-chessboard measures a square to
    // animate a move (it throws on a 0 px square). Give the squares a size.
    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.id.includes("-square-")) return DOMRect.fromRect({ x: 0, y: 0, width: 44, height: 44 });
      return rect.call(this);
    });
    act(() => useChessStore.getState().newGame({ mode: "ai", difficulty: "easy", playerColor: "white" }));
  });

  afterEach(() => {
    resetPointerMock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function startPlaying() {
    render(<ChessGame />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: "▶ Play!" }));
  }

  const square = (id: string) => document.getElementById(`hank-chess-square-${id}`)!;

  it("has the pickers on the start card: the computer, Easy and White by default", () => {
    render(<ChessGame />);
    const card = screen.getByTestId("game-start-overlay");
    expect(within(card).getByRole("button", { name: /computer/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "Easy" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: /white/i })).toHaveAttribute("aria-pressed", "true");
    // No mode, difficulty or colour buttons on the play screen.
    expect(screen.queryByRole("button", { name: /vs AI|Play as/i })).toBeNull();
  });

  it("a finger taps a piece, then its square (and a drag does nothing on touch)", () => {
    startPlaying();
    fireEvent.click(square("e2"));
    expect(useChessStore.getState().legalMoves).toEqual(expect.arrayContaining(["e3", "e4"]));
    fireEvent.click(square("e4"));
    expect(useChessStore.getState().game.get("e4")).toEqual(expect.objectContaining({ type: "p", color: "w" }));
    // The pieces are not draggable on a touch screen.
    const piece = document.getElementById("hank-chess-piece-wP-d2")!;
    expect(piece.style.cursor).not.toBe("grab");
  });

  it("with Black picked, the computer opens only after Play, a moment later", () => {
    vi.useFakeTimers();
    act(() => useChessStore.getState().setPlayerColor("black"));
    render(<ChessGame />);
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useChessStore.getState().game.history()).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: "▶ Play!" }));
    expect(screen.getByTestId("chess-status")).toHaveTextContent("Thinking");
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS + 10));
    expect(useChessStore.getState().game.history()).toHaveLength(1);
    expect(screen.getByTestId("chess-status")).toHaveTextContent("Your turn");
  });

  it("the computer waits under the pause menu, and a new game cancels its move", () => {
    vi.useFakeTimers();
    startPlaying();
    act(() => {
      useChessStore.getState().makeMove("e2", "e4");
    });
    act(() => useChessStore.getState().pauseGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useChessStore.getState().game.history()).toHaveLength(1);
    act(() => useChessStore.getState().resumeGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS / 2));
    act(() => useChessStore.getState().newGame());
    act(() => vi.advanceTimersByTime(AI_CONFIG.MOVE_DELAY_MS * 4));
    expect(useChessStore.getState().game.history()).toHaveLength(0);
  });

  it("Give up asks for a second tap, and forgets the first after a while", () => {
    vi.useFakeTimers();
    startPlaying();
    const giveUp = screen.getByTestId("chess-give-up");
    fireEvent.click(giveUp);
    expect(useChessStore.getState().status).toBe("playing");
    expect(giveUp).toHaveTextContent("Sure? Tap again");
    act(() => vi.advanceTimersByTime(GIVE_UP_CONFIRM_MS + 10));
    expect(giveUp).toHaveTextContent("Give up");
    fireEvent.click(giveUp);
    fireEvent.click(giveUp);
    expect(useChessStore.getState().status).toBe("resigned");
  });

  it("shows no empty captured-pieces box, and groups the pieces once there are some", () => {
    startPlaying();
    expect(screen.queryByTestId("chess-captured-top")).toBeNull();
    expect(screen.queryByTestId("chess-captured-bottom")).toBeNull();
    act(() => useChessStore.setState({ capturedPieces: { white: ["p", "p", "n"], black: [] } }));
    const mine = screen.getByTestId("chess-captured-bottom");
    expect(mine).toHaveAttribute("aria-label", "Took 1 knight, 2 pawns");
    expect(mine).toHaveTextContent("×2");
  });

  it("checkmate shows a card and the chip; Play again is a new game at once, with no start card", () => {
    startPlaying();
    // Fool's mate, with the kid as Black against a 2-player board.
    act(() => useChessStore.getState().newGame({ mode: "local" }));
    act(() => {
      const s = useChessStore.getState();
      s.makeMove("f2", "f3");
      s.makeMove("e7", "e5");
      s.makeMove("g2", "g4");
      s.makeMove("d8", "h4");
    });
    expect(useChessStore.getState().status).toBe("checkmate");
    expect(screen.getByTestId("chess-result-card")).toHaveTextContent("Black wins!");
    expect(screen.queryByTestId("chess-actions")).toBeNull();
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useChessStore.getState().status).toBe("playing");
    expect(useChessStore.getState().game.history()).toHaveLength(0);
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });
});
