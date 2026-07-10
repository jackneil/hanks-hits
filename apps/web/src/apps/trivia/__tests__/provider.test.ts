import { describe, expect, it } from "vitest";
import { getQuestions, prepareQuestion } from "../lib/api";
import { QUESTION_BANK, type QuestionDifficulty } from "../lib/questions";

const TIERS: QuestionDifficulty[] = ["easy", "medium", "hard"];
const HTML_ENTITY = /&(#\d+|[a-zA-Z]+);/;

describe("getQuestions", () => {
  it("returns the requested number of questions for each difficulty", () => {
    for (const tier of TIERS) {
      expect(getQuestions(10, tier)).toHaveLength(10);
    }
  });

  it("returns only questions matching the requested difficulty", () => {
    for (const tier of TIERS) {
      for (const q of getQuestions(10, tier)) {
        expect(q.difficulty).toBe(tier);
      }
    }
  });

  it("never repeats a question within one game", () => {
    for (const tier of TIERS) {
      const picked = getQuestions(15, tier);
      const texts = new Set(picked.map((q) => q.question));
      expect(texts.size).toBe(picked.length);
    }
  });

  it("caps the count at the pool size when asked for more than exist", () => {
    for (const tier of TIERS) {
      const poolSize = QUESTION_BANK.filter((q) => q.difficulty === tier).length;
      const picked = getQuestions(9999, tier);
      expect(picked).toHaveLength(poolSize);
      // Still all unique even when returning the whole pool.
      expect(new Set(picked.map((q) => q.question)).size).toBe(poolSize);
    }
  });

  it("returns an empty array for a zero or negative count", () => {
    expect(getQuestions(0, "easy")).toEqual([]);
    expect(getQuestions(-5, "easy")).toEqual([]);
  });
});

describe("prepareQuestion", () => {
  it("returns all four answers including the correct one", () => {
    const q = QUESTION_BANK[0];
    const prepared = prepareQuestion(q);
    expect(prepared.answers).toHaveLength(4);
    expect(prepared.answers).toContain(prepared.correctAnswer);
    expect(prepared.correctAnswer).toBe(q.correct_answer);
    // Every original answer is present, just reordered.
    const expected = new Set([q.correct_answer, ...q.incorrect_answers]);
    expect(new Set(prepared.answers)).toEqual(expected);
  });

  it("shuffles the answer positions across repeated calls", () => {
    const q = QUESTION_BANK[0];
    const seenIndexes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const prepared = prepareQuestion(q);
      seenIndexes.add(prepared.answers.indexOf(prepared.correctAnswer));
    }
    // With 50 shuffles across 4 slots, the correct answer must land in
    // more than one position.
    expect(seenIndexes.size).toBeGreaterThan(1);
  });

  it("carries no HTML entities through to the prepared question", () => {
    for (const q of QUESTION_BANK.slice(0, 20)) {
      const prepared = prepareQuestion(q);
      expect(prepared.question).not.toMatch(HTML_ENTITY);
      for (const answer of prepared.answers) {
        expect(answer).not.toMatch(HTML_ENTITY);
      }
    }
  });
});
