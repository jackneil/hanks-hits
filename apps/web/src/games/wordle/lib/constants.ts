// Wordle for Kids - Age-based difficulty settings

export type Difficulty = "4yo" | "8yo" | "12yo" | "24yo" | "99yo";

export interface DifficultySettings {
  wordLength: number;
  maxGuesses: number;
  emoji: string;
  color: string;
  label: string;
}

export const DIFFICULTY_SETTINGS: Record<Difficulty, DifficultySettings> = {
  "4yo": {
    wordLength: 3,
    maxGuesses: 8,
    emoji: "👶",
    color: "bg-blue-400",
    label: "4 years old",
  },
  "8yo": {
    wordLength: 4,
    maxGuesses: 6,
    emoji: "🧒",
    color: "bg-green-500",
    label: "8 years old",
  },
  "12yo": {
    wordLength: 5,
    maxGuesses: 6,
    emoji: "👦",
    color: "bg-yellow-500",
    label: "12 years old",
  },
  "24yo": {
    wordLength: 6,
    maxGuesses: 6,
    emoji: "🧑",
    color: "bg-orange-500",
    label: "24 years old",
  },
  "99yo": {
    wordLength: 4,
    maxGuesses: 8,
    emoji: "👴",
    color: "bg-purple-500",
    label: "99 years old",
  },
};

export function getDifficultySettings(difficulty: Difficulty): DifficultySettings {
  return DIFFICULTY_SETTINGS[difficulty];
}

// Letter status colors
export const LETTER_COLORS = {
  correct: "bg-green-500 border-green-500 text-white",
  present: "bg-yellow-500 border-yellow-500 text-white",
  absent: "bg-gray-600 border-gray-600 text-white",
  empty: "bg-transparent border-gray-500",
  tbd: "bg-transparent border-gray-400 text-white",
};

/**
 * The on-screen keyboard: A to Z in order, seven keys a row, with delete
 * and enter at the end of the last row.
 *
 * Why not QWERTY: a phone is 375 px wide, and ten keys a row can be only
 * about 32 px wide, under the 44 px a kid's finger needs (phone UX audit
 * 2026-09-29). Seven keys a row are 44 to 56 px wide. The order of the
 * alphabet is also the one a 4 to 8 year old knows.
 */
export const KEYBOARD_ROWS = [
  ["A", "B", "C", "D", "E", "F", "G"],
  ["H", "I", "J", "K", "L", "M", "N"],
  ["O", "P", "Q", "R", "S", "T", "U"],
  ["V", "W", "X", "Y", "Z", "⌫", "ENTER"],
];

/** Keys in a keyboard row. */
export const KEYS_PER_ROW = 7;
