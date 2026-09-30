/**
 * Wordle on a phone (PR-G5): an A to Z keyboard with keys a thumb can hit
 * (44 px or more) on every iPhone screen, tiles that take the height the
 * keyboard leaves, a grid beside the keyboard held sideways, and the result
 * as a card with the shared chip (Play again is a new word at once).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { KEY_LABELS, WordleGame, resultText } from "../Game";
import { DIFFICULTY_SETTINGS, KEYBOARD_ROWS, type Difficulty } from "../lib/constants";
import { EDGE, GAP, HINT_ROW, MIN_KEY, wordleLayout } from "../lib/layout";
import { useWordleStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const BOXES = {
  // The narrowest sideways box: the 375 x 549 phone turned (549 x 375 less the header).
  seTurned: { width: 549, height: 375 - 44 },
  // The narrowest upright box the phone checks reach: the 667 x 311 phone turned (311 x 667).
  narrowUpright: { width: 311, height: 667 - 48 },
  seUpright: { width: 375, height: 549 - 48 },
  bigUpright: { width: 390, height: 664 - 48 },
  seSideways: { width: 667, height: 311 - 44 },
  bigSideways: { width: 844, height: 340 - 44 },
};

describe("Wordle layout", () => {
  it("fits the keyboard, the hint row and the whole grid on every iPhone screen, for every age, keys 44 px or more", () => {
    for (const [name, box] of Object.entries(BOXES)) {
      for (const diff of Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]) {
        const { wordLength: cols, maxGuesses: rows } = DIFFICULTY_SETTINGS[diff];
        const layout = wordleLayout(box, { rows, cols }, false);
        const where = `${name} ${diff}`;
        expect(layout.key, where).toBeGreaterThanOrEqual(MIN_KEY);
        const gridHeight = rows * layout.tile + (rows - 1) * 4;
        const gridWidth = cols * layout.tile + (cols - 1) * 4;
        if (layout.sideways) {
          expect(gridWidth + GAP + layout.keyboard.width + 2 * EDGE, where).toBeLessThanOrEqual(box.width);
          expect(Math.max(gridHeight, layout.keyboard.height + GAP + HINT_ROW) + 2 * EDGE, where).toBeLessThanOrEqual(box.height);
        } else {
          expect(layout.keyboard.width + 2 * EDGE, where).toBeLessThanOrEqual(box.width);
          expect(gridHeight + GAP + HINT_ROW + GAP + layout.keyboard.height + 2 * EDGE, where).toBeLessThanOrEqual(box.height);
        }
        // A letter a kid can read.
        expect(layout.tile, where).toBeGreaterThanOrEqual(24);
        // Sideways the grid and the keyboard share the width (56 px keys once
        // left the grid half the height). The limit is the six-letter words
        // (24yo) on the narrowest screen: at 44 px keys the keyboard needs
        // 332 px, and six 28 px tiles fill 57% of the height. The default age
        // (8yo, four letters) gets most of it.
        if (layout.sideways) {
          const share = (rows * layout.tile + (rows - 1) * 4) / box.height;
          expect(share, where).toBeGreaterThan(0.55);
          if (diff === "8yo") expect(share, where).toBeGreaterThan(0.8);
        }
      }
    }
  });

  it("has every letter once, seven keys a row, with delete and enter", () => {
    const keys = KEYBOARD_ROWS.flat();
    expect(keys.filter((k) => /^[A-Z]$/.test(k)).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(keys).toContain("⌫");
    expect(keys).toContain("ENTER");
    for (const row of KEYBOARD_ROWS) expect(row).toHaveLength(7);
  });
});

describe("Wordle on screen", () => {
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    localStorage.clear();
    mockPointer(true);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    act(() => {
      useWordleStore.getState().reset();
      useWordleStore.getState().setDifficulty("8yo");
      useWordleStore.getState().startGame();
    });
  });

  afterEach(() => {
    liftAllFingers();
    resetPointerMock();
    vi.restoreAllMocks();
    act(() => useWordleStore.getState().reset());
  });

  it("types by touch, one letter a tap, deletes and sends", () => {
    render(<WordleGame />);
    const word = useWordleStore.getState().targetWord;
    for (const letter of word) fingerTap(screen.getByRole("button", { name: letter.toUpperCase() }));
    expect(useWordleStore.getState().currentGuess.toUpperCase()).toBe(word.toUpperCase());
    fingerTap(screen.getByRole("button", { name: KEY_LABELS.delete }));
    expect(useWordleStore.getState().currentGuess).toHaveLength(word.length - 1);
    fingerTap(screen.getByRole("button", { name: word[word.length - 1].toUpperCase() }));
    fingerTap(screen.getByRole("button", { name: KEY_LABELS.enter }));
    expect(useWordleStore.getState().gameState).toBe("won");
  });

  it("shows no Quit button (the header's restart does it) and no system keyboard input", () => {
    const { container } = render(<WordleGame />);
    expect(screen.queryByRole("button", { name: /quit/i })).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("a win shows a card and the chip; Play again is a new word at the same age, with no start card", () => {
    render(<WordleGame />);
    const word = useWordleStore.getState().targetWord;
    act(() => {
      for (const letter of word) useWordleStore.getState().addLetter(letter);
      useWordleStore.getState().submitGuess();
    });
    expect(screen.getByTestId("wordle-result-card")).toHaveTextContent("You won!");
    expect(screen.queryByTestId("wordle-keyboard")).toBeNull();
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useWordleStore.getState().gameState).toBe("playing");
    expect(useWordleStore.getState().settings.difficulty).toBe("8yo");
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });

  it("Enter at a result plays again only after the grace (the Enter that sent the word must not skip it)", () => {
    render(<WordleGame />);
    const word = useWordleStore.getState().targetWord;
    act(() => {
      for (const letter of word) useWordleStore.getState().addLetter(letter);
      useWordleStore.getState().submitGuess();
    });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useWordleStore.getState().gameState).toBe("won");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useWordleStore.getState().gameState).toBe("playing");
  });

  it("says the result in whole sentences", () => {
    expect(resultText({ won: true, word: "CAT", guesses: 1, streak: 2 })).toBe("You won! You found CAT in 1 guess. Your streak is 2.");
    expect(resultText({ won: false, word: "DOG", guesses: 6, streak: 0 })).toBe("Good try! The word was DOG.");
  });
});
