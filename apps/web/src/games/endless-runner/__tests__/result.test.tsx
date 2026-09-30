/**
 * Endless Runner on a phone (PR-G2): big JUMP and DUCK thumb buttons, the
 * result in legible DOM text with the shared chip, Play again straight into
 * a new run, and clips on.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";
import { clipsEnabledFor } from "@/shared/clips";

import { EndlessRunnerGame, runnerResultText } from "../Game";
import { useEndlessRunnerStore } from "../lib/store";
import { metadata } from "../metadata";
import { runClipPhase } from "../lib/useEndlessClips";

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
  act(() => useEndlessRunnerStore.getState().reset());
});

afterEach(() => {
  removeSpeechMock();
  resetPointerMock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run `distance` metres for `coins` coins, with the saved best at `best`, then crash. */
function crash(distance: number, coins: number, best: number) {
  act(() => {
    const s = useEndlessRunnerStore.getState();
    useEndlessRunnerStore.setState({ progress: { ...s.progress, highScore: best } });
    useEndlessRunnerStore.getState().startGame();
    useEndlessRunnerStore.setState({ distance, score: distance, coinsThisRun: coins });
    useEndlessRunnerStore.getState().endGame();
  });
}

const passGrace = () => {
  clock += DEFAULT_RESTART_GRACE_MS + 50;
};

describe("Endless Runner thumb buttons", () => {
  it("JUMP jumps on the press, DUCK ducks while held and stands up on release", () => {
    mockPointer(true);
    const jump = vi.fn();
    const startDuck = vi.fn();
    const stopDuck = vi.fn();
    act(() => useEndlessRunnerStore.setState({ gameState: "playing", jump, startDuck, stopDuck }));
    render(<EndlessRunnerGame />);
    fireEvent.pointerDown(screen.getByTestId("runner-jump"), { pointerId: 1, pointerType: "touch", button: 0 });
    expect(jump).toHaveBeenCalledTimes(1);
    const duck = screen.getByTestId("runner-duck");
    fireEvent.pointerDown(duck, { pointerId: 2, pointerType: "touch", button: 0 });
    expect(startDuck).toHaveBeenCalledTimes(1);
    expect(stopDuck).not.toHaveBeenCalled();
    fireEvent.pointerUp(duck, { pointerId: 2, pointerType: "touch", button: 0 });
    expect(stopDuck).toHaveBeenCalled();
  });
});

describe("Endless Runner result", () => {
  it("shows the result card and the chip at the crash, and reads the distance, coins and new best", () => {
    const speech = installSpeechMock();
    render(<EndlessRunnerGame />);
    crash(320, 7, 250);
    expect(screen.getByTestId("runner-result-card")).toHaveTextContent("320 m");
    expect(screen.getByTestId("runner-result-card")).toHaveTextContent("New best!");
    const chip = screen.getByTestId("result-chip");
    passGrace();
    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    expect(
      speech.lastUtterance().text.startsWith(runnerResultText({ distance: 320, coins: 7, best: 320, newBest: true })),
    ).toBe(true);
  });

  it("says one coin and the old best in kid words", () => {
    expect(runnerResultText({ distance: 40, coins: 1, best: 90, newBest: false })).toBe(
      "Game over! You ran 40 meters and got 1 coin. Your best is 90 meters.",
    );
  });

  it("Play again starts a new run at once; Space waits out the grace and ignores repeats", () => {
    render(<EndlessRunnerGame />);
    crash(50, 0, 90);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(useEndlessRunnerStore.getState().gameState).toBe("gameOver");
    passGrace();
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(useEndlessRunnerStore.getState().gameState).toBe("gameOver");
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(useEndlessRunnerStore.getState().gameState).toBe("playing");
    expect(screen.queryByTestId("game-start-overlay")).toBeNull();
  });
});

describe("Endless Runner clips", () => {
  it("turns clips on and captures only while the runner runs", () => {
    expect(metadata.clips).toBe(true);
    expect(runClipPhase("playing")).toBe("playing");
    expect(runClipPhase("ready")).toBe("idle");
    expect(runClipPhase("gameOver")).toBe("idle");
  });
});
