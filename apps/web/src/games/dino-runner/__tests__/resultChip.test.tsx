/**
 * Dino Runner at game over (plan 11.4): the shared result chip has Read it
 * to me, Play again and the leaderboard, and says the score and the best.
 * Play again starts the next run at once (every death used to cost two
 * taps: one to the start card, one on Play), and a tap on the surface at
 * the crash never wipes the result.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import { DinoRunnerGame, gameOverText } from "../Game";
import { useDinoRunnerStore } from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

let clock = 1_000_000;

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
  act(() => {
    useDinoRunnerStore.getState().reset();
  });
});

afterEach(() => {
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function endTheRun(score: number, best: number) {
  act(() => {
    useDinoRunnerStore.getState().startGame();
    useDinoRunnerStore.setState({
      score,
      progress: { ...useDinoRunnerStore.getState().progress, highScore: best },
    });
  });
  clock += 20_000;
  act(() => {
    useDinoRunnerStore.getState().gameOver();
  });
}

const passGrace = () => {
  clock += DEFAULT_RESTART_GRACE_MS;
};

describe("the Dino Runner result chip", () => {
  it("shows at game over with Play again and the leaderboard, and says the score and the new best", () => {
    const speech = installSpeechMock();
    render(<DinoRunnerGame />);
    expect(screen.queryByTestId("result-chip")).toBeNull();
    endTheRun(230, 200);
    const chip = screen.getByTestId("result-chip");
    expect(within(chip).getByRole("button", { name: /play again/i })).toBeInTheDocument();
    expect(within(chip).getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    const expected = gameOverText({ score: 230, best: 230, newBest: true });
    expect(speech.lastUtterance().text.startsWith(expected)).toBe(true);
    expect(useDinoRunnerStore.getState().lastRunNewBest).toBe(true);
    expect(screen.getByTestId("dino-result-card")).toHaveTextContent("New best!");
  });

  it("says the old best when the run did not beat it (a tie is not a new best)", () => {
    const speech = installSpeechMock();
    render(<DinoRunnerGame />);
    endTheRun(200, 200);
    passGrace();
    fireEvent.click(within(screen.getByTestId("result-chip")).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toContain("Your best is 200.");
    expect(useDinoRunnerStore.getState().lastRunNewBest).toBe(false);
    expect(screen.getByTestId("dino-result-card")).toHaveTextContent("Best 200");
  });

  it("Play again starts a new run at once and the chip goes away", () => {
    render(<DinoRunnerGame />);
    endTheRun(50, 90);
    passGrace();
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useDinoRunnerStore.getState().gameState).toBe("playing");
    expect(useDinoRunnerStore.getState().score).toBe(0);
    expect(screen.queryByTestId("result-chip")).toBeNull();
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });

  it("Space restarts only after the grace, and a held Space's repeats never do", () => {
    render(<DinoRunnerGame />);
    endTheRun(50, 90);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useDinoRunnerStore.getState().gameState).toBe("game-over");
    passGrace();
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(useDinoRunnerStore.getState().gameState).toBe("game-over");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useDinoRunnerStore.getState().gameState).toBe("playing");
  });
});
