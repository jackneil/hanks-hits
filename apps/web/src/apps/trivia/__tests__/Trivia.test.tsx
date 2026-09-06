import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { Trivia } from "../Trivia";
import { useTriviaStore } from "../lib/store";
import { DIFFICULTY_SETTINGS } from "../lib/constants";

/** Swap the global always-false matchMedia stub for a pointer-aware one. */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

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
    const button = screen.getByRole("button", {
      name: new RegExp(target, "i"),
    });
    fireEvent.click(button);

    expect(useTriviaStore.getState().settings.difficulty).toBe(target);
    expect(
      screen.getByRole("button", { name: new RegExp(target, "i") })
    ).toHaveAttribute("aria-pressed", "true");
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
