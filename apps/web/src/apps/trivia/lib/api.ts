// Local trivia question provider.
//
// Questions are bundled with the app (see ./questions) so the game works fully
// offline and never calls an external service. This replaces the old Open
// Trivia DB fetch, which was serving adult questions to kids.

import {
  QUESTION_BANK,
  type TriviaQuestion,
  type QuestionDifficulty,
} from "./questions";

export type { TriviaQuestion, QuestionDifficulty } from "./questions";

/**
 * Shuffle an array using Fisher-Yates (returns a new array).
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Pick trivia questions from the bundled bank for one game.
 * Filters by difficulty, shuffles, and returns up to `amount` questions.
 * The returned questions are all unique, so none repeats within a single game.
 * If fewer than `amount` exist for the difficulty, returns all of them.
 */
export function getQuestions(
  amount: number,
  difficulty: QuestionDifficulty
): TriviaQuestion[] {
  const pool = QUESTION_BANK.filter((q) => q.difficulty === difficulty);
  const count = Math.max(0, Math.min(amount, pool.length));
  return shuffleArray(pool).slice(0, count);
}

/**
 * Prepare a question for display: shuffles the answer positions so the correct
 * answer is not always in the same spot.
 */
export function prepareQuestion(q: TriviaQuestion) {
  const answers = shuffleArray([q.correct_answer, ...q.incorrect_answers]);
  return {
    question: q.question,
    category: q.category,
    difficulty: q.difficulty,
    answers,
    correctAnswer: q.correct_answer,
  };
}

export type PreparedQuestion = ReturnType<typeof prepareQuestion>;
