import { describe, it, expect, beforeEach, vi } from "vitest";

// Game.tsx pulls in useAuthSync -> next-auth; stub it so the module imports
// cleanly in the test env (we only need the pure touchXToCanvasX helper).
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import { useBreakoutStore } from "../lib/store";
import { touchXToCanvasX } from "../Game";
import { CANVAS_WIDTH } from "../lib/constants";

describe("Breakout Store", () => {
  beforeEach(() => {
    const store = useBreakoutStore.getState();
    store.setProgress({
      highScore: 0,
      levelsCompleted: 0,
      highestLevel: 1,
      totalBricksDestroyed: 0,
      gamesPlayed: 0,
      powerUpsCollected: 0,
      soundEnabled: true,
      lastModified: Date.now(),
    });
    useBreakoutStore.setState({ status: "idle" });
  });

  describe("movePaddle", () => {
    // The paddle is driven by window-level pointer events, so it receives
    // coordinates from far outside the canvas. These pin it to an edge
    // instead of moving it off the board or throwing.
    it("clamps the paddle to the left edge for far-left mouse positions", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      store.movePaddle(-5000);

      expect(useBreakoutStore.getState().paddle.x).toBe(0);
    });

    it("clamps the paddle to the right edge for far-right mouse positions", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      store.movePaddle(CANVAS_WIDTH + 5000);

      const { paddle } = useBreakoutStore.getState();
      expect(paddle.x).toBe(CANVAS_WIDTH - paddle.width);
    });

    it("centers the paddle on an in-bounds position", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      store.movePaddle(CANVAS_WIDTH / 2);

      const { paddle } = useBreakoutStore.getState();
      expect(paddle.x).toBe(CANVAS_WIDTH / 2 - paddle.width / 2);
    });

    it("moves stuck balls along with the paddle", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      store.movePaddle(CANVAS_WIDTH / 2);

      const state = useBreakoutStore.getState();
      const stuckBalls = state.balls.filter((b) => b.stuck);
      expect(stuckBalls.length).toBeGreaterThan(0);
      for (const ball of stuckBalls) {
        expect(ball.x).toBe(state.paddle.x + state.paddle.width / 2);
      }
    });

    it("does not move the paddle when the game is over", () => {
      const store = useBreakoutStore.getState();
      store.startGame();
      store.movePaddle(0);
      useBreakoutStore.setState({ status: "game-over" });

      store.movePaddle(CANVAS_WIDTH);

      expect(useBreakoutStore.getState().paddle.x).toBe(0);
    });
  });

  describe("touch drag -> paddle position", () => {
    // The native (non-passive) touchmove handler maps a raw touch X in page
    // pixels into canvas space via touchXToCanvasX, then feeds it to
    // movePaddle. These lock down that end-to-end mapping.
    it("undoes the canvas offset and scale for a touch coordinate", () => {
      // Canvas drawn at 2x, left edge at page x=100. A touch at page x=300
      // is (300 - 100) / 2 = 100 canvas pixels from the left.
      expect(touchXToCanvasX(300, 100, 2)).toBe(100);
    });

    it("returns the raw offset when the canvas is unscaled and at origin", () => {
      expect(touchXToCanvasX(240, 0, 1)).toBe(240);
    });

    it("centers the paddle under the finger when dragging to canvas center", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      // A touch that maps to canvas center (rectLeft 0, scale 1).
      const canvasX = touchXToCanvasX(CANVAS_WIDTH / 2, 0, 1);
      store.movePaddle(canvasX);

      const { paddle } = useBreakoutStore.getState();
      expect(paddle.x).toBe(CANVAS_WIDTH / 2 - paddle.width / 2);
    });

    it("clamps to the right edge when a scaled touch lands past the wall", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      // Page x far to the right, canvas drawn at 1.5x scale.
      const canvasX = touchXToCanvasX(5000, 0, 1.5);
      store.movePaddle(canvasX);

      const { paddle } = useBreakoutStore.getState();
      expect(paddle.x).toBe(CANVAS_WIDTH - paddle.width);
    });
  });

  describe("game lifecycle", () => {
    it("starts a game in playing state with lives and a stuck ball", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      const state = useBreakoutStore.getState();
      expect(state.status).toBe("playing");
      expect(state.lives).toBeGreaterThan(0);
      expect(state.balls.some((b) => b.stuck)).toBe(true);
    });

    it("pauses and resumes", () => {
      const store = useBreakoutStore.getState();
      store.startGame();

      store.pauseGame();
      expect(useBreakoutStore.getState().status).toBe("paused");

      store.resumeGame();
      expect(useBreakoutStore.getState().status).toBe("playing");
    });
  });
});
