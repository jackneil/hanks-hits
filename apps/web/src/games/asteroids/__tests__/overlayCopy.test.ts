import { describe, it, expect } from "vitest";
import { gameOverText, getOverlayCopy, NEW_BEST_LINE } from "../lib/overlayCopy";

describe("asteroids overlay copy", () => {
  it("touch viewports never see keyboard-only copy", () => {
    const copy = getOverlayCopy(true);
    for (const text of Object.values(copy)) {
      expect(text).not.toMatch(/space|escape|click|press/i);
      expect(text).toMatch(/tap/i);
    }
  });

  it("keyboard viewports keep the key legend", () => {
    const copy = getOverlayCopy(false);
    expect(copy.nextWave).toContain("Space");
    expect(copy.resume).toContain("Escape");
  });

  it("game over has no play-again line: the result chip has the button", () => {
    expect(getOverlayCopy(true)).not.toHaveProperty("playAgain");
    expect(getOverlayCopy(false)).not.toHaveProperty("playAgain");
  });

  it("says the score, the wave and the best at game over, in short sentences", () => {
    expect(gameOverText({ score: 1060, wave: 3, best: 1060, newBest: true })).toBe(
      "Game over! Your score is 1060. You got to wave 3. That is a new best!"
    );
    expect(gameOverText({ score: 300, wave: 1, best: 2000, newBest: false })).toBe(
      "Game over! Your score is 300. You got to wave 1. Your best is 2000."
    );
    expect(gameOverText({ score: 0, wave: 1, best: 0, newBest: false })).toBe("Game over! Your score is 0. You got to wave 1.");
    for (const text of [gameOverText({ score: 5, wave: 2, best: 9, newBest: false }), NEW_BEST_LINE]) {
      expect(text).not.toMatch(/[—–]|--/);
    }
  });
});
