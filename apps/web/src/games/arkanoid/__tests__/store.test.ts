import { describe, it, expect, beforeEach } from "vitest";
import { useArkanoidStore } from "../lib/store";
import { getSpawnedBallType } from "../lib/constants";

describe("Arkanoid Store", () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    const store = useArkanoidStore.getState();
    store.setProgress({
      highScore: 0,
      totalGamesPlayed: 0,
      totalBallsSpawned: 0,
      highestMultiplier: 1,
      lastModified: Date.now(),
    });
    // Reset other state by accessing internal setState
    useArkanoidStore.setState({
      gameState: "menu",
      score: 0,
      multiplier: 1,
      balls: [],
      wasNewHighScore: false,
      paddleX: 0,
    });
  });

  describe("startGame", () => {
    it("initializes game with 3 balls", () => {
      const store = useArkanoidStore.getState();
      store.startGame();

      const state = useArkanoidStore.getState();
      expect(state.gameState).toBe("playing");
      expect(state.balls).toHaveLength(3);
      expect(state.score).toBe(0);
      expect(state.multiplier).toBe(1);
      expect(state.wasNewHighScore).toBe(false);
    });

    it("resets wasNewHighScore on new game", () => {
      const store = useArkanoidStore.getState();

      // Simulate a previous game with high score
      useArkanoidStore.setState({ wasNewHighScore: true });
      expect(useArkanoidStore.getState().wasNewHighScore).toBe(true);

      // Start new game
      store.startGame();
      expect(useArkanoidStore.getState().wasNewHighScore).toBe(false);
    });
  });

  describe("endGame", () => {
    it("sets wasNewHighScore to true when beating high score", () => {
      const store = useArkanoidStore.getState();

      // Start game and set a score higher than current high score (0)
      store.startGame();
      useArkanoidStore.setState({ score: 1000 });

      store.endGame();

      const state = useArkanoidStore.getState();
      expect(state.wasNewHighScore).toBe(true);
      expect(state.progress.highScore).toBe(1000);
      expect(state.gameState).toBe("gameOver");
    });

    it("sets wasNewHighScore to false when NOT beating high score", () => {
      const store = useArkanoidStore.getState();

      // Set existing high score
      store.setProgress({
        highScore: 5000,
        totalGamesPlayed: 5,
        totalBallsSpawned: 100,
        highestMultiplier: 3,
        lastModified: Date.now(),
      });

      // Start game with lower score
      store.startGame();
      useArkanoidStore.setState({ score: 500 });

      store.endGame();

      const state = useArkanoidStore.getState();
      expect(state.wasNewHighScore).toBe(false);
      expect(state.progress.highScore).toBe(5000); // Unchanged
    });

    it("increments totalGamesPlayed", () => {
      const store = useArkanoidStore.getState();

      expect(store.progress.totalGamesPlayed).toBe(0);

      store.startGame();
      store.endGame();

      expect(useArkanoidStore.getState().progress.totalGamesPlayed).toBe(1);

      // Play another game
      store.startGame();
      store.endGame();

      expect(useArkanoidStore.getState().progress.totalGamesPlayed).toBe(2);
    });

    it("updates highestMultiplier when current multiplier is higher", () => {
      const store = useArkanoidStore.getState();

      store.startGame();
      useArkanoidStore.setState({ multiplier: 5 });
      store.endGame();

      expect(useArkanoidStore.getState().progress.highestMultiplier).toBe(5);
    });

    it("updates lastModified timestamp", () => {
      const store = useArkanoidStore.getState();
      const beforeTime = Date.now();

      store.startGame();
      store.endGame();

      const state = useArkanoidStore.getState();
      expect(state.progress.lastModified).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe("pauseGame and resumeGame", () => {
    it("pauses and resumes game correctly", () => {
      const store = useArkanoidStore.getState();

      store.startGame();
      expect(useArkanoidStore.getState().gameState).toBe("playing");

      store.pauseGame();
      expect(useArkanoidStore.getState().gameState).toBe("paused");

      store.resumeGame();
      expect(useArkanoidStore.getState().gameState).toBe("playing");
    });

    it("only pauses when playing", () => {
      const store = useArkanoidStore.getState();

      // Can't pause from menu
      store.pauseGame();
      expect(useArkanoidStore.getState().gameState).toBe("menu");
    });

    it("only resumes when paused", () => {
      const store = useArkanoidStore.getState();

      store.startGame();
      // Can't resume when already playing
      store.resumeGame();
      expect(useArkanoidStore.getState().gameState).toBe("playing");
    });
  });

  describe("addBall", () => {
    it("adds ball and increments totalBallsSpawned", () => {
      const store = useArkanoidStore.getState();
      store.startGame();

      const initialCount = useArkanoidStore.getState().progress.totalBallsSpawned;

      store.addBall({ type: "blue", x: 0, y: 0, vx: 0.01, vy: 0.01 });

      const state = useArkanoidStore.getState();
      expect(state.balls).toHaveLength(4); // 3 initial + 1 added
      expect(state.progress.totalBallsSpawned).toBe(initialCount + 1);
    });
  });

  describe("getSpawnedBallType", () => {
    it("keeps blue balls blue for the normal spawn path", () => {
      expect(getSpawnedBallType("blue", 0.5)).toBe("blue");
    });

    it("can upgrade blue wall-hit spawns to orange balls", () => {
      expect(getSpawnedBallType("blue", 0.1)).toBe("orange");
    });

    it("can upgrade blue wall-hit spawns to yellow-dot bonus balls", () => {
      expect(getSpawnedBallType("blue", 0.01)).toBe("yellow-dot");
    });

    it("preserves non-blue spawned ball types", () => {
      expect(getSpawnedBallType("orange", 0.01)).toBe("orange");
      expect(getSpawnedBallType("yellow-dot", 0.5)).toBe("yellow-dot");
    });
  });

  describe("addScore", () => {
    it("adds score with multiplier", () => {
      const store = useArkanoidStore.getState();
      store.startGame();

      useArkanoidStore.setState({ multiplier: 2 });
      store.addScore(100);

      expect(useArkanoidStore.getState().score).toBe(200);
    });
  });

  describe("updateMultiplier", () => {
    it("sets multiplier based on ball count thresholds", () => {
      const store = useArkanoidStore.getState();

      store.updateMultiplier(5);
      expect(useArkanoidStore.getState().multiplier).toBe(1);

      store.updateMultiplier(10);
      expect(useArkanoidStore.getState().multiplier).toBe(2);

      store.updateMultiplier(20);
      expect(useArkanoidStore.getState().multiplier).toBe(5);

      store.updateMultiplier(50);
      expect(useArkanoidStore.getState().multiplier).toBe(10);
    });
  });

  describe("getProgress and setProgress", () => {
    it("returns and sets progress correctly for cloud sync", () => {
      const store = useArkanoidStore.getState();

      const newProgress = {
        highScore: 9999,
        totalGamesPlayed: 50,
        totalBallsSpawned: 500,
        highestMultiplier: 10,
        lastModified: Date.now(),
      };

      store.setProgress(newProgress);

      expect(store.getProgress()).toEqual(newProgress);
    });
  });
});
