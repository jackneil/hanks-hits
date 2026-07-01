import { beforeEach, describe, expect, it } from "vitest";
import { useMathAttackStore } from "../lib/store";

describe("Math Attack store", () => {
  beforeEach(() => {
    useMathAttackStore.setState({
      highScore: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      longestCombo: 0,
      problemsSolved: { "+": 0, "-": 0, "×": 0, "÷": 0 },
      gamesPlayed: 0,
      settings: { soundEnabled: true, difficulty: "8yo" },
      lastModified: 0,
      gameState: "ready",
      score: 0,
      lives: 3,
      combo: 0,
      wave: 1,
    });
  });

  it("counts correct answers as answered", () => {
    useMathAttackStore.getState().addScore(100, "+");

    const state = useMathAttackStore.getState();
    expect(state.totalCorrect).toBe(1);
    expect(state.totalAnswered).toBe(1);
  });

  it("can count wrong or missed answers without incrementing totalCorrect", () => {
    useMathAttackStore.getState().recordAnswerAttempt();

    const state = useMathAttackStore.getState();
    expect(state.totalCorrect).toBe(0);
    expect(state.totalAnswered).toBe(1);
  });
});
