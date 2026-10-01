/**
 * 2048 on a phone (PR-G5): the board fitted to the play box both ways up
 * (held sideways only the top two rows used to show), a swipe anywhere in
 * the box that moves once and never scrolls the page, and the result as a
 * card with the shared chip (Play again is a new board at once, Keep going
 * after 2048).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerDown, fingerMove, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { Game2048, SWIPE_PX, resultText } from "../Game";
import { boardLayout, EDGE, GAP, SCORE_ROW, SIDE_COLUMN } from "../lib/layout";
import { use2048Store } from "../lib/store";

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

describe("2048 layout", () => {
  it("fits the whole board and the score in the play box on every iPhone screen", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      const { sideways, board } = boardLayout(box);
      if (sideways) {
        expect(SIDE_COLUMN + GAP + board + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
        expect(board / box.height, name).toBeGreaterThan(0.9);
      } else {
        expect(board + 2 * EDGE, name).toBeLessThanOrEqual(box.width);
        expect(SCORE_ROW + GAP + board + 2 * EDGE, name).toBeLessThanOrEqual(box.height);
      }
    }
  });
});

describe("2048 on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => use2048Store.getState().newGame());
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.restoreAllMocks();
  });

  function startPlaying() {
    render(<Game2048 />);
    fireEvent.click(within(screen.getByTestId("game-start-overlay")).getByRole("button", { name: /play/i }));
    return screen.getByTestId("game-2048-root");
  }

  it("a swipe anywhere moves the tiles once, as soon as the finger has gone far enough", () => {
    const root = startPlaying();
    const move = vi.fn();
    act(() => use2048Store.setState({ move }));
    fingerDown(root, { id: 1, x: 200, y: 300 });
    fingerMove(root, { id: 1, x: 200 + SWIPE_PX - 4, y: 302 });
    expect(move).not.toHaveBeenCalled();
    fingerMove(root, { id: 1, x: 200 + SWIPE_PX + 2, y: 302 });
    expect(move).toHaveBeenCalledWith("right");
    // The rest of the same swipe is not a second move.
    fingerMove(root, { id: 1, x: 200 + 3 * SWIPE_PX, y: 302 });
    fingerUp(root, { id: 1, x: 200 + 3 * SWIPE_PX, y: 302 });
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("no more moves: a card and the chip; Play again is a new board at once", () => {
    startPlaying();
    act(() => use2048Store.setState({ status: "game-over", score: 480 }));
    expect(screen.getByTestId("game-2048-result-card")).toHaveTextContent("No more moves!");
    expect(screen.getByTestId("game-2048-result-card")).toHaveTextContent("Score 480");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(use2048Store.getState().status).toBe("playing");
    expect(use2048Store.getState().score).toBe(0);
  });

  it("after 2048, Keep going goes on with the same board", () => {
    startPlaying();
    act(() => use2048Store.setState({ status: "won", keepPlaying: false, score: 20000 }));
    expect(screen.getByTestId("game-2048-result-card")).toHaveTextContent("You made 2048!");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(screen.getByTestId("game-2048-keep-going"));
    expect(use2048Store.getState().keepPlaying).toBe(true);
    expect(use2048Store.getState().score).toBe(20000);
    expect(screen.queryByTestId("result-chip")).toBeNull();
  });

  it("says the result in whole sentences", () => {
    expect(resultText({ won: false, score: 12, best: 90 })).toBe("No more moves! Your score is 12. Your best is 90.");
    expect(resultText({ won: true, score: 20000, best: 20000 })).toMatch(/^You made 2048!/);
  });
});
