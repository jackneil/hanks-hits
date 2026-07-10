import { describe, expect, it } from "vitest";
import { QUESTION_BANK, type QuestionDifficulty } from "../lib/questions";

const VALID_TIERS: QuestionDifficulty[] = ["easy", "medium", "hard"];

// An HTML entity looks like &quot; &amp; &#039; etc. Bundled questions are
// plain text, so none of this should ever appear.
const HTML_ENTITY = /&(#\d+|[a-zA-Z]+);/;

describe("trivia question bank", () => {
  it("has at least 120 questions", () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(120);
  });

  it("gives every question exactly one correct and three incorrect answers", () => {
    for (const q of QUESTION_BANK) {
      expect(typeof q.correct_answer).toBe("string");
      expect(q.correct_answer.trim().length).toBeGreaterThan(0);
      expect(q.incorrect_answers).toHaveLength(3);
      for (const wrong of q.incorrect_answers) {
        expect(typeof wrong).toBe("string");
        expect(wrong.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps all four answers distinct within a question", () => {
    for (const q of QUESTION_BANK) {
      const answers = [q.correct_answer, ...q.incorrect_answers];
      const unique = new Set(answers);
      expect(unique.size).toBe(answers.length);
    }
  });

  it("tags every question with a valid difficulty tier", () => {
    for (const q of QUESTION_BANK) {
      expect(VALID_TIERS).toContain(q.difficulty);
    }
  });

  it("gives every question non-empty text and a category", () => {
    for (const q of QUESTION_BANK) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.category.trim().length).toBeGreaterThan(0);
    }
  });

  it("populates every difficulty tier with enough questions for the largest round", () => {
    // The hardest age mode (24yo) asks for 15 questions per round, so each tier
    // must hold at least that many to guarantee a full, non-repeating game.
    for (const tier of VALID_TIERS) {
      const count = QUESTION_BANK.filter((q) => q.difficulty === tier).length;
      expect(count).toBeGreaterThanOrEqual(15);
    }
  });

  it("spreads questions across many kid-friendly categories", () => {
    const categories = new Set(QUESTION_BANK.map((q) => q.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });

  it("contains no HTML entities in question or answer text", () => {
    for (const q of QUESTION_BANK) {
      expect(q.question).not.toMatch(HTML_ENTITY);
      expect(q.correct_answer).not.toMatch(HTML_ENTITY);
      for (const wrong of q.incorrect_answers) {
        expect(wrong).not.toMatch(HTML_ENTITY);
      }
    }
  });
});
