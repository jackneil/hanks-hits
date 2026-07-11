import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ forceSync: vi.fn() }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { Trivia } from "../Trivia";
import { useTriviaStore } from "../lib/store";

beforeEach(() => {
  vi.useFakeTimers();
  act(() => {
    useTriviaStore.getState().reset();
  });
});

afterEach(() => {
  vi.useRealTimers();
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

    // Default difficulty is 8yo -> 20s timer; run it out.
    act(() => {
      vi.advanceTimersByTime(21_000);
    });

    expect(useTriviaStore.getState().totalAnswered).toBe(answeredBefore + 1);
    const renderWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("while rendering")
    );
    expect(renderWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });
});
