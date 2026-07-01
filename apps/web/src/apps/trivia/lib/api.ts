// Open Trivia Database API - Free, no key required

const BASE_URL = "https://opentdb.com/api.php";

export interface TriviaQuestion {
  category: string;
  type: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface ApiResponse {
  response_code: number;
  results: TriviaQuestion[];
}

/**
 * Fetch trivia questions from Open Trivia DB
 * @param amount Number of questions (max 50)
 * @param difficulty "easy" | "medium" | "hard"
 * @param category Optional category ID
 */
export async function fetchQuestions(
  amount: number,
  difficulty: "easy" | "medium" | "hard",
  category?: number
): Promise<TriviaQuestion[]> {
  const params = new URLSearchParams({
    amount: String(Math.min(amount, 50)),
    difficulty,
    type: "multiple",
  });

  if (category) {
    params.set("category", String(category));
  }

  const res = await fetch(`${BASE_URL}?${params}`);
  const data: ApiResponse = await res.json();

  if (data.response_code !== 0) {
    throw new Error(`Trivia API error code: ${data.response_code}`);
  }

  if (data.results.length === 0) {
    throw new Error("Trivia API returned no questions");
  }

  return data.results;
}

/**
 * Decode HTML entities in question/answer text
 */
export function decodeHTML(html: string): string {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

/**
 * Shuffle array using Fisher-Yates
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
 * Prepare a question with shuffled answers
 */
export function prepareQuestion(q: TriviaQuestion) {
  const allAnswers = shuffleArray([q.correct_answer, ...q.incorrect_answers]);
  return {
    question: decodeHTML(q.question),
    category: decodeHTML(q.category),
    difficulty: q.difficulty,
    answers: allAnswers.map(decodeHTML),
    correctAnswer: decodeHTML(q.correct_answer),
  };
}

export type PreparedQuestion = ReturnType<typeof prepareQuestion>;
