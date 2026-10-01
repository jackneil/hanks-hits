import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ forceSync: vi.fn() }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

// Lets one test simulate the question bank coming back empty (the silent-start
// failure the overlay has to recover from) without touching the real bank.
const questionBank = vi.hoisted(() => ({ empty: false }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getQuestions: (...args: Parameters<typeof actual.getQuestions>) =>
      questionBank.empty ? [] : actual.getQuestions(...args),
  };
});

import { Trivia, quizResultText } from "../Trivia";
import { useTriviaStore } from "../lib/store";
import { DIFFICULTY_SETTINGS } from "../lib/constants";
import { mockPointer } from "@/__tests__/pointer-mock";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { ShellHoldContext } from "@/shared/hooks/useShellHold";

beforeEach(() => {
  questionBank.empty = false;
  vi.useFakeTimers();
  act(() => {
    useTriviaStore.getState().reset();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockPointer(false);
});

describe("trivia start overlay", () => {
  it("shows the shared overlay with the title exactly once", () => {
    render(<Trivia />);

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Trivia Quiz" })
    ).toHaveLength(1);
    expect(screen.getAllByText("Trivia Quiz")).toHaveLength(1);
  });

  it("shows touch hints (not mouse copy) on coarse pointers", () => {
    mockPointer(true);
    render(<Trivia />);

    expect(screen.getByText("👆 Tap the right answer")).toBeInTheDocument();
    expect(
      screen.queryByText("🖱️ Click the right answer")
    ).not.toBeInTheDocument();
  });

  it("shows mouse hints (not touch copy) on fine pointers", () => {
    mockPointer(false);
    render(<Trivia />);

    expect(screen.getByText("🖱️ Click the right answer")).toBeInTheDocument();
    expect(
      screen.queryByText("👆 Tap the right answer")
    ).not.toBeInTheDocument();
  });

  it("starts exactly once even when Play is mashed, and the overlay goes away", () => {
    render(<Trivia />);

    const play = screen.getByRole("button", { name: /start quiz/i });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(useTriviaStore.getState().gameState).toBe("playing");
    expect(useTriviaStore.getState().questionIndex).toBe(0);
    expect(screen.queryByTestId("game-start-overlay")).not.toBeInTheDocument();
  });

  it("picks an age with the overlay picker and marks it pressed", () => {
    render(<Trivia />);

    const target = "12yo";
    // The choice reads as words ("12 years old"), not the key ("12yo").
    const name = new RegExp(DIFFICULTY_SETTINGS[target].label, "i");
    fireEvent.click(screen.getByRole("button", { name }));

    expect(useTriviaStore.getState().settings.difficulty).toBe(target);
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a kid-friendly message when the questions fail to load, and Play works again", () => {
    // The overlay's start guard is a per-mount ref: without the re-key on a
    // failed attempt, Play would be dead for the rest of the mount.
    questionBank.empty = true;
    render(<Trivia />);

    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));

    expect(useTriviaStore.getState().gameState).toBe("ready");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The questions did not load."
    );

    // Questions come back; the retry must actually start the quiz.
    questionBank.empty = false;
    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));

    expect(useTriviaStore.getState().gameState).toBe("playing");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("trivia timer expiry", () => {
  it("registers a wrong answer when the clock runs out, without setState-in-render", () => {
    // Regression: the countdown called handleAnswer(null) INSIDE the
    // setTimeLeft updater. State updaters must be pure — every timeout
    // fired React's "Cannot update a component while rendering" warning.
    // The expiry side-effect now lives in its own effect watching timeLeft.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Trivia />);

    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    expect(useTriviaStore.getState().gameState).toBe("playing");
    const answeredBefore = useTriviaStore.getState().totalAnswered;

    // Run out the default difficulty's clock (plus one spare tick) — derived
    // from the settings so a tuned timer can't silently break this test.
    act(() => {
      vi.advanceTimersByTime(
        DIFFICULTY_SETTINGS[useTriviaStore.getState().settings.difficulty]
          .timerSec * 1000 + 1000
      );
    });

    expect(useTriviaStore.getState().totalAnswered).toBe(answeredBefore + 1);
    const renderWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("while rendering")
    );
    expect(renderWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });
});

describe("trivia restart during the answer pause", () => {
  it("does not end the fresh game when the pending 1.5s pause fires", () => {
    // Regression: the "show the answer" setTimeout kept running after the
    // header restart put the store back to "ready", so endGame() fired over
    // the new start card and counted a game the kid never played.
    render(<Trivia />);

    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    // Jump to the last question so the pending timeout would call endGame().
    // The question count lives in component state; read it off the header.
    const total = Number(
      screen.getByText(/^Question \d+\/\d+$/).textContent!.split("/")[1]
    );
    act(() => {
      useTriviaStore.setState({ questionIndex: total - 1 });
    });

    const answer = document.querySelector<HTMLButtonElement>(
      ".grid.grid-cols-1 button"
    )!;
    fireEvent.click(answer);

    const playedBefore = useTriviaStore.getState().gamesPlayed;

    // The kid taps restart before the pause is up.
    act(() => {
      useTriviaStore.getState().reset();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId("game-start-overlay")).toBeInTheDocument();
    expect(useTriviaStore.getState().gameState).toBe("ready");
    expect(useTriviaStore.getState().gamesPlayed).toBe(playedBefore);
  });
});

describe("trivia spoken choices", () => {
  it("says the picker choices out loud, so a kid who cannot read hears them", () => {
    const speech = installSpeechMock();
    render(<Trivia  />);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain("4 years old");
    expect(spoken).toContain("8 years old");
    expect(spoken).toContain("12 years old");
    expect(spoken).toContain("24 years old");
    expect(spoken).toContain("99 years old");
    removeSpeechMock();
  });
});

describe("trivia age picker layout", () => {
  it("gives the odd last age the full width, so no half cell dangles", () => {
    render(<Trivia  />);

    const buttons = screen
      .getAllByRole("button")
      .filter((b) => /years old|^\S+ \d+yo$|\d+yo/.test(b.textContent ?? ""));
    const grid = screen.getByText("How old are you?").nextElementSibling!;
    expect(grid.className).toContain("grid-cols-2");

    const cells = Array.from(grid.children);
    expect(cells.length % 2).toBe(1);
    expect(cells[cells.length - 1].className).toContain("col-span-2");
    cells.slice(0, -1).forEach((cell) => {
      expect(cell.className).not.toContain("col-span-2");
    });
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe("trivia clock under the shell's hold", () => {
  it("does not count while the shell holds the quiz, and counts again when the hold ends", () => {
    // The shell holds the quiz under the restart question and the install
    // steps, and in a hidden tab; the 20 s clock used to run on there.
    function Quiz({ held }: { held: boolean }) {
      return (
        <ShellHoldContext.Provider value={held}>
          <Trivia />
        </ShellHoldContext.Provider>
      );
    }
    const { rerender } = render(<Quiz held={false} />);
    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    expect(useTriviaStore.getState().gameState).toBe("playing");
    const timerSec = DIFFICULTY_SETTINGS[useTriviaStore.getState().settings.difficulty].timerSec;
    const clock = () => screen.getByLabelText(/seconds left/).textContent;
    expect(clock()).toBe(`⏱ ${timerSec}s`);

    rerender(<Quiz held />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(clock()).toBe(`⏱ ${timerSec}s`);

    rerender(<Quiz held={false} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(clock()).toBe(`⏱ ${timerSec - 2}s`);
  });
});

describe("trivia result on a phone", () => {
  it("ends on the shared result chip, and Play again is a new quiz at once, with no start card", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000_000);
    render(<Trivia />);
    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    act(() => useTriviaStore.setState({ gameState: "finished", currentScore: 30 }));
    const chip = screen.getByTestId("result-chip");
    now.mockReturnValue(1_000_000 + 2_000);
    fireEvent.click(within(chip).getByRole("button", { name: /play again/i }));
    expect(useTriviaStore.getState().gameState).toBe("playing");
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
    expect(screen.getByTestId("trivia-answers")).toBeInTheDocument();
  });

  it("says the result in whole sentences", () => {
    expect(quizResultText({ score: 30, answered: 10, newBest: true })).toBe(
      "Quiz complete! You got 30 points in 10 questions. That is a new high score!"
    );
  });
});
