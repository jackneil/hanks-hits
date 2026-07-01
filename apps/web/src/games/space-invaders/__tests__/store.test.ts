import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceInvadersStore, type SpaceInvadersProgress } from "../lib/store";
import {
  ALIEN,
  CANVAS_WIDTH,
  DIFFICULTY_SETTINGS,
  INITIAL_LIVES,
  PLAYER,
  type Difficulty,
} from "../lib/constants";

function createProgress(difficulty: Difficulty): SpaceInvadersProgress {
  return {
    highScore: 0,
    wavesCompleted: 0,
    highestWave: 1,
    totalAliensKilled: 0,
    mysteryShipsHit: 0,
    gamesPlayed: 0,
    settings: {
      soundEnabled: false,
      difficulty,
    },
    lastModified: Date.now(),
  };
}

function resetStore(difficulty: Difficulty) {
  localStorage.clear();
  useSpaceInvadersStore.setState({
    gameState: "ready",
    score: 0,
    lives: INITIAL_LIVES,
    wave: 1,
    playerX: CANVAS_WIDTH / 2 - PLAYER.WIDTH / 2,
    aliens: [],
    alienDirection: 1,
    alienMoveTimer: 0,
    alienAnimationFrame: 0,
    playerBullets: [],
    alienBullets: [],
    bulletIdCounter: 0,
    mysteryShip: null,
    mysteryShipTimer: 0,
    shields: [],
    explosions: [],
    explosionIdCounter: 0,
    playerInvincible: false,
    invincibilityTimer: 0,
    progress: createProgress(difficulty),
  });
}

describe("Space Invaders difficulty scaling", () => {
  beforeEach(() => {
    resetStore("8yo");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses actual reduced-row alien count for movement speed scaling", () => {
    useSpaceInvadersStore.getState().startGame();

    const before = useSpaceInvadersStore.getState().aliens[0];
    useSpaceInvadersStore.setState({ alienMoveTimer: 0 });
    vi.spyOn(Date, "now").mockReturnValue(1000);

    useSpaceInvadersStore.getState().update(16);

    const after = useSpaceInvadersStore.getState().aliens[0];
    const expectedStep =
      ALIEN.BASE_MOVE_SPEED *
      DIFFICULTY_SETTINGS["8yo"].enemySpeedMultiplier *
      5;

    expect(useSpaceInvadersStore.getState().aliens).toHaveLength(33);
    expect(after.x).toBeCloseTo(before.x + expectedStep);
  });

  it("applies the 99yo size multiplier to generated aliens", () => {
    resetStore("99yo");

    useSpaceInvadersStore.getState().startGame();

    const aliens = useSpaceInvadersStore.getState().aliens;
    expect(aliens).toHaveLength(22);
    expect(aliens[0].sizeMultiplier).toBe(DIFFICULTY_SETTINGS["99yo"].sizeMultiplier);
    expect(aliens[0].width).toBe(ALIEN.WIDTH * DIFFICULTY_SETTINGS["99yo"].sizeMultiplier);
    expect(aliens[0].height).toBe(ALIEN.HEIGHT * DIFFICULTY_SETTINGS["99yo"].sizeMultiplier);
  });
});
